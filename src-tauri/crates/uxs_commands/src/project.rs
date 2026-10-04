use super::command::CommandEntry;
use super::source::discover_source_files;
use super::source::SourceFile;
use super::visitor::CommandVisitor;
use std::env;
use std::fs;
use std::path::PathBuf;
use syn::visit::Visit;

pub(super) struct ProjectCommands {
    pub(super) commands: Vec<CommandEntry>,
    pub(super) tracked_files: Vec<String>,
    pub(super) bindings_path: String,
    pub(super) permissions_dir: PathBuf,
}

impl ProjectCommands {
    pub(super) fn collect() -> Self {
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
        let commands = parse_source_files(&source_files);
        let bindings_path = manifest_path
            .parent()
            .unwrap_or(&manifest_path)
            .join("src/services/cmds.ts")
            .to_string_lossy()
            .into_owned();

        Self {
            commands,
            tracked_files,
            bindings_path,
            permissions_dir: manifest_path.join("permissions"),
        }
    }
}

fn parse_source_file(source: &SourceFile) -> Vec<CommandEntry> {
    let content = fs::read_to_string(&source.path).unwrap_or_else(|error| {
        panic!(
            "uxs_commands: failed to read {}: {error}",
            source.path.display()
        )
    });
    let syntax_tree = syn::parse_file(&content).unwrap_or_else(|error| {
        panic!(
            "uxs_commands: failed to parse {}: {error}",
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

fn parse_source_files(source_files: &[SourceFile]) -> Vec<CommandEntry> {
    // Attribute arguments use proc-macro token streams, which must be parsed on the proc-macro thread.
    source_files.iter().flat_map(parse_source_file).collect()
}
