use proc_macro::TokenStream;
use quote::{quote, ToTokens};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use syn::{visit::Visit, ItemFn};
use walkdir::WalkDir;

struct CommandEntry {
    module_name: String,
    name: String,
    cfgs: Vec<String>,
    is_specta: bool,
}

struct CommandVisitor {
    module_name: String,
    commands: Vec<CommandEntry>,
}

struct ProjectCommands {
    commands: Vec<CommandEntry>,
    tracked_files: Vec<String>,
    bindings_path: String,
    permissions_path: PathBuf,
}

struct SourceFile {
    path: PathBuf,
    module_name: String,
}

fn discover_source_files(commands_dir: &Path) -> Vec<SourceFile> {
    let mut files: Vec<_> = WalkDir::new(commands_dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.into_path();
            if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                return None;
            }

            let relative = path.strip_prefix(commands_dir).ok()?.with_extension("");
            let components: Vec<&str> = relative
                .components()
                .filter_map(|component| component.as_os_str().to_str())
                .collect();
            if components.is_empty() {
                return None;
            }

            Some(SourceFile {
                path,
                module_name: components.join("::"),
            })
        })
        .collect();

    // WalkDir does not promise a stable order. Keep generated output reproducible
    // even though parsing itself is performed in parallel.
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}

fn parse_source_file(source: &SourceFile) -> Vec<CommandEntry> {
    let content = fs::read_to_string(&source.path).unwrap_or_else(|error| {
        panic!(
            "auto_handler: failed to read {}: {error}",
            source.path.display()
        )
    });
    let syntax_tree = syn::parse_file(&content).unwrap_or_else(|error| {
        panic!(
            "auto_handler: failed to parse {}: {error}",
            source.path.display()
        )
    });
    let mut visitor = CommandVisitor {
        module_name: source.module_name.clone(),
        commands: Vec::new(),
    };
    visitor.visit_file(&syntax_tree);
    visitor.commands
}

fn command_path(command: &CommandEntry) -> syn::Path {
    let full_path = format!("crate::commands::{}::{}", command.module_name, command.name);
    syn::parse_str(&full_path).expect("auto_handler: failed to build command path")
}

fn command_cfgs(command: &CommandEntry) -> Vec<syn::Attribute> {
    command
        .cfgs
        .iter()
        .map(|cfg| {
            let source = format!("{cfg}\nfn __auto_handler_cfg_probe() {{}}\n");
            let file =
                syn::parse_file(&source).expect("auto_handler: failed to restore cfg attribute");
            match file.items.into_iter().next() {
                Some(syn::Item::Fn(function)) => function
                    .attrs
                    .into_iter()
                    .next()
                    .expect("auto_handler: missing restored cfg attribute"),
                _ => panic!("auto_handler: failed to restore cfg attribute"),
            }
        })
        .collect()
}

fn collect_project_commands() -> ProjectCommands {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let manifest_path = PathBuf::from(&manifest_dir);
    let commands_dir = manifest_path.join("src").join("commands");

    let source_files = if commands_dir.exists() {
        discover_source_files(&commands_dir)
    } else {
        Vec::new()
    };
    let tracked_files = source_files
        .iter()
        .map(|source| source.path.to_string_lossy().into_owned())
        .collect();

    // Each source file is independent. Keep the chunks and handles in sorted-file
    // order so the final command order remains deterministic after joining workers.
    let commands = if source_files.is_empty() {
        Vec::new()
    } else {
        let worker_count = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1)
            .min(source_files.len());
        let chunk_size = source_files.len().div_ceil(worker_count);

        std::thread::scope(|scope| {
            let handles: Vec<_> = source_files
                .chunks(chunk_size)
                .map(|sources| {
                    scope.spawn(move || {
                        sources
                            .iter()
                            .flat_map(parse_source_file)
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            handles
                .into_iter()
                .flat_map(|handle| {
                    handle
                        .join()
                        .expect("auto_handler: command scan thread panicked")
                })
                .collect()
        })
    };

    let bindings_path = manifest_path
        .parent()
        .unwrap_or(&manifest_path)
        .join("src/services/cmds.ts")
        .to_string_lossy()
        .into_owned();

    ProjectCommands {
        commands,
        tracked_files,
        bindings_path,
        permissions_path: manifest_path.join("permissions").join("commands-main.json"),
    }
}

fn permission_names(commands: &[CommandEntry]) -> Vec<String> {
    let mut names: Vec<String> = commands
        .iter()
        .map(|command| command.name.clone())
        .collect();
    names.sort();
    names.dedup();
    names
}

impl ProjectCommands {
    fn sync_permissions(&self) {
        let Ok(content) = fs::read_to_string(&self.permissions_path) else {
            return;
        };
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(allow) = json.pointer_mut("/permission/0/commands/allow") {
                *allow = serde_json::json!(permission_names(&self.commands));
                if let Ok(updated) = serde_json::to_string_pretty(&json) {
                    if updated != content {
                        let _ = fs::write(&self.permissions_path, updated);
                    }
                }
            }
        }
    }
}

impl<'ast> Visit<'ast> for CommandVisitor {
    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        let is_command = node.attrs.iter().any(|attr| {
            let path = attr.path();
            path.segments.len() == 2
                && path.segments[0].ident == "tauri"
                && path.segments[1].ident == "command"
        });

        if is_command {
            let is_specta = node.attrs.iter().any(|attr| {
                let path = attr.path();
                path.segments.last().is_some_and(|s| s.ident == "specta")
            });

            let fn_name = &node.sig.ident;
            let command_name = fn_name.to_string();
            let cfgs: Vec<String> = node
                .attrs
                .iter()
                .filter(|attr| attr.path().is_ident("cfg"))
                .map(|attr| attr.to_token_stream().to_string())
                .collect();

            self.commands.push(CommandEntry {
                module_name: self.module_name.clone(),
                name: command_name,
                cfgs,
                is_specta,
            });
        }

        syn::visit::visit_item_fn(self, node);
    }
}

#[proc_macro]
pub fn register(_: TokenStream) -> TokenStream {
    let project = collect_project_commands();
    project.sync_permissions();
    let tracked_files = &project.tracked_files;

    let all_command_tokens: Vec<_> = project
        .commands
        .iter()
        .map(|c| {
            let path = command_path(c);
            let cfgs = command_cfgs(c);
            quote! { #(#cfgs)* #path }
        })
        .collect();

    let expanded = quote! {
        {
            #( const _: &[u8] = include_bytes!(#tracked_files); )*
            tauri::generate_handler![
                #(#all_command_tokens),*
            ]
        }
    };

    expanded.into()
}

#[proc_macro]
pub fn sync_bindings(_: TokenStream) -> TokenStream {
    let project = collect_project_commands();
    project.sync_permissions();
    let tracked_files = &project.tracked_files;
    let bindings_path = &project.bindings_path;
    let specta_command_tokens: Vec<_> = project
        .commands
        .iter()
        .filter(|c| c.is_specta)
        .map(|c| {
            let path = command_path(c);
            let cfgs = command_cfgs(c);
            quote! { #(#cfgs)* #path }
        })
        .collect();

    let expanded = quote! {
        {
            #( const _: &[u8] = include_bytes!(#tracked_files); )*
            tauri_specta::Builder::<tauri::Wry>::new()
                .error_handling(tauri_specta::ErrorHandlingMode::Throw)
                .commands(tauri_specta::collect_commands![
                    #(#specta_command_tokens),*
                ])
                .export(
                    specta_typescript::Typescript::default(),
                    #bindings_path,
                )
                .expect("sync_bindings: failed to export TypeScript bindings");
        }
    };

    expanded.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use quote::ToTokens;

    /// Helper: run CommandVisitor on a source string and return collected path strings.
    fn collect_commands(module_name: &str, source: &str) -> Vec<String> {
        let syntax_tree = syn::parse_file(source).expect("failed to parse test source");
        let mut visitor = CommandVisitor {
            module_name: module_name.to_string(),
            commands: Vec::new(),
        };
        visitor.visit_file(&syntax_tree);
        visitor
            .commands
            .iter()
            .map(|c| command_path(c).to_token_stream().to_string())
            .collect()
    }

    #[test]
    fn detects_tauri_command() {
        let src = r#"
            #[tauri::command]
            pub fn hello() -> String {
                "hello".to_string()
            }
        "#;
        let cmds = collect_commands("greeter", src);
        assert_eq!(cmds, vec!["crate :: commands :: greeter :: hello"]);
    }

    #[test]
    fn skips_plain_functions() {
        let src = r#"
            pub fn not_a_command() -> i32 { 42 }

            fn private_helper() {}
        "#;
        let cmds = collect_commands("utils", src);
        assert!(cmds.is_empty(), "plain functions should be skipped");
    }

    #[test]
    fn collects_multiple_commands() {
        let src = r#"
            #[tauri::command]
            pub fn foo() {}

            pub fn bar() {}

            #[tauri::command]
            pub fn baz() -> bool { true }
        "#;
        let cmds = collect_commands("multi", src);
        assert_eq!(cmds.len(), 2);
        assert!(cmds[0].contains("foo"));
        assert!(cmds[1].contains("baz"));
    }

    #[test]
    fn ignores_other_attributes() {
        let src = r#"
            #[derive(Debug)]
            pub struct Foo;

            #[inline]
            pub fn inlined() {}

            #[allow(dead_code)]
            fn suppressed() {}
        "#;
        let cmds = collect_commands("attrs", src);
        assert!(cmds.is_empty(), "non-tauri attributes should be ignored");
    }

    #[test]
    fn rejects_bare_command_attribute() {
        // Bare #[command] should NOT match — only #[tauri::command] is valid.
        let src = r#"
            #[command]
            pub fn sneaky() {}
        "#;
        let cmds = collect_commands("edge", src);
        assert!(cmds.is_empty(), "bare #[command] should not be matched");
    }

    #[test]
    fn supports_nested_module_path() {
        // Verify that nested module names (from subdirectories) work correctly
        let src = r#"
            #[tauri::command]
            pub fn list_users() {}
        "#;
        let cmds = collect_commands("admin::users", src);
        assert_eq!(
            cmds,
            vec!["crate :: commands :: admin :: users :: list_users"]
        );
    }

    #[test]
    fn module_name_appears_in_path() {
        let src = r#"
            #[tauri::command]
            pub fn action() {}
        "#;
        let cmds = collect_commands("my_module", src);
        assert_eq!(cmds.len(), 1);
        assert!(
            cmds[0].contains("my_module"),
            "generated path should include the module name"
        );
    }

    #[test]
    fn preserves_cfg_attributes() {
        let src = r#"
            #[cfg(target_os = "windows")]
            #[tauri::command]
            pub fn win_cmd() {}
        "#;
        let syntax_tree = syn::parse_file(src).expect("failed to parse test source");
        let mut visitor = CommandVisitor {
            module_name: "cfg_mod".to_string(),
            commands: Vec::new(),
        };
        visitor.visit_file(&syntax_tree);
        assert_eq!(visitor.commands.len(), 1);
        assert_eq!(visitor.commands[0].cfgs.len(), 1);
        let cfg = command_cfgs(&visitor.commands[0])
            .into_iter()
            .next()
            .expect("stored cfg attribute should remain parseable");
        assert!(cfg.path().is_ident("cfg"));
    }

    #[test]
    fn sorts_and_deduplicates_permission_names() {
        let commands = vec![
            CommandEntry {
                module_name: "a".to_string(),
                name: "zeta".to_string(),
                cfgs: Vec::new(),
                is_specta: false,
            },
            CommandEntry {
                module_name: "b".to_string(),
                name: "alpha".to_string(),
                cfgs: Vec::new(),
                is_specta: false,
            },
            CommandEntry {
                module_name: "c".to_string(),
                name: "zeta".to_string(),
                cfgs: Vec::new(),
                is_specta: false,
            },
        ];

        assert_eq!(permission_names(&commands), vec!["alpha", "zeta"]);
    }
}
