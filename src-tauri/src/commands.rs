pub mod chaoxing;
pub mod config;
pub mod mask;
pub mod task;
pub mod updater;
pub mod webview;
pub mod window;

use serde::Serialize;
use specta::Type;

#[derive(Debug, thiserror::Error)]
pub enum CommandsError {
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl Type for CommandsError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <String as Type>::definition(types)
    }
}

impl Serialize for CommandsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type CommandsResult<T, E = CommandsError> = Result<T, E>;

fn course_webview(window: &tauri::Window) -> anyhow::Result<tauri::Webview> {
    use tauri::Manager;

    window
        .get_webview("chaoxing")
        .ok_or_else(|| anyhow::anyhow!("未找到超星 Webview: chaoxing"))
}
