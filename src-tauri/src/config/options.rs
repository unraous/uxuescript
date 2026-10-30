use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Type)]
#[serde(default, rename_all = "camelCase")] // 将 Rust 下划线命名（snake_case）自动映射为 TypeScript 驼峰命名（camelCase）
pub struct OptionsConfig {
    pub mute_webview: bool,
    pub lock_speed: Option<f32>,
    // TOML 不保存 None；旧配置中缺失该字段表示用户关闭了等待。
    #[serde(default)]
    pub switching_cd: Option<f32>,
    pub quiz_review: bool,
}

impl Default for OptionsConfig {
    fn default() -> Self {
        Self {
            mute_webview: true,
            lock_speed: None,
            switching_cd: Some(1.0),
            quiz_review: false,
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/config/options.rs"]
mod tests;
