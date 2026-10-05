use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub(super) struct SourceFile {
    pub(super) path: PathBuf,
    pub(super) module_name: String,
}

pub(super) fn discover_source_files(commands_dir: &Path) -> Vec<SourceFile> {
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

    // WalkDir does not promise a stable order. Keep generated output reproducible.
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}
