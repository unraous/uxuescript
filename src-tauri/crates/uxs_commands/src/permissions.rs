use super::command::{CommandEntry, WebviewScope};
use super::project::ProjectCommands;
use std::fs;
use std::path::Path;

fn permission_names<'a>(commands: impl Iterator<Item = &'a CommandEntry>) -> Vec<String> {
    let mut names: Vec<String> = commands.map(|command| command.name.clone()).collect();
    names.sort();
    names.dedup();
    names
}

fn webview_permission_names(commands: &[CommandEntry], webview: WebviewScope) -> Vec<String> {
    permission_names(
        commands
            .iter()
            .filter(|command| command.webviews.contains(&webview)),
    )
}

fn sync_permission_file(path: &Path, names: Vec<String>) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let mut json = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    let allow = json
        .pointer_mut("/permission/0/commands/allow")
        .ok_or_else(|| format!("missing permission command allowlist in {}", path.display()))?;
    *allow = serde_json::json!(names);
    let mut updated = serde_json::to_string_pretty(&json)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    updated.push('\n');
    if updated != content {
        fs::write(path, updated)
            .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
    }
    Ok(())
}

pub(super) fn sync(project: &ProjectCommands) -> Result<(), String> {
    sync_permission_file(
        &project.permissions_dir.join("commands-main.json"),
        permission_names(project.commands.iter()),
    )?;
    for webview in WebviewScope::ALL {
        let names = webview_permission_names(&project.commands, webview);
        sync_permission_file(
            &project
                .permissions_dir
                .join(format!("commands-{}.json", webview.name())),
            names,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{permission_names, sync_permission_file, webview_permission_names};
    use crate::command::CommandEntry;
    use crate::command::WebviewScope;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_path() -> PathBuf {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "uxs_commands_permissions_{}_{}.json",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn sorts_and_deduplicates_permission_names() {
        let commands = vec![
            CommandEntry {
                module_name: "a".to_string(),
                name: "zeta".to_string(),
                cfgs: Vec::new(),
                webviews: Vec::new(),
            },
            CommandEntry {
                module_name: "b".to_string(),
                name: "alpha".to_string(),
                cfgs: Vec::new(),
                webviews: Vec::new(),
            },
            CommandEntry {
                module_name: "c".to_string(),
                name: "zeta".to_string(),
                cfgs: Vec::new(),
                webviews: Vec::new(),
            },
        ];

        assert_eq!(permission_names(commands.iter()), vec!["alpha", "zeta"]);
    }

    #[test]
    fn builds_independent_allowlists_from_webview_annotations() {
        let commands = vec![
            CommandEntry {
                module_name: "commands".to_string(),
                name: "main_only".to_string(),
                cfgs: Vec::new(),
                webviews: Vec::new(),
            },
            CommandEntry {
                module_name: "commands".to_string(),
                name: "course_status".to_string(),
                cfgs: Vec::new(),
                webviews: vec![WebviewScope::Chaoxing],
            },
            CommandEntry {
                module_name: "commands".to_string(),
                name: "mask_start".to_string(),
                cfgs: Vec::new(),
                webviews: vec![WebviewScope::Mask],
            },
        ];

        assert_eq!(
            webview_permission_names(&commands, WebviewScope::Chaoxing),
            vec!["course_status"]
        );
        assert_eq!(
            webview_permission_names(&commands, WebviewScope::Mask),
            vec!["mask_start"]
        );
    }

    #[test]
    fn syncs_allowlist_and_preserves_other_permission_fields() {
        let path = temp_path();
        fs::write(
            &path,
            r#"{"permission":[{"commands":{"allow":["stale"],"deny":[]},"description":"test","identifier":"commands-test"}]}"#,
        )
        .unwrap();

        sync_permission_file(&path, vec!["confirm".into(), "options".into()]).unwrap();
        let actual: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(
            actual.pointer("/permission/0/commands/allow"),
            Some(&serde_json::json!(["confirm", "options"]))
        );
        assert_eq!(
            actual.pointer("/permission/0/commands/deny"),
            Some(&serde_json::json!([]))
        );
        assert_eq!(
            actual.pointer("/permission/0/identifier"),
            Some(&serde_json::json!("commands-test"))
        );
    }

    #[test]
    fn reports_missing_malformed_and_incomplete_permission_files() {
        let missing_path = temp_path();
        assert!(sync_permission_file(&missing_path, Vec::new())
            .unwrap_err()
            .contains("failed to read"));

        let path = temp_path();
        fs::write(&path, "not json").unwrap();
        assert!(sync_permission_file(&path, Vec::new())
            .unwrap_err()
            .contains("failed to parse"));

        fs::write(&path, r#"{"permission":[]}"#).unwrap();
        assert!(sync_permission_file(&path, Vec::new())
            .unwrap_err()
            .contains("missing permission command allowlist"));
        let _ = fs::remove_file(path);
    }
}
