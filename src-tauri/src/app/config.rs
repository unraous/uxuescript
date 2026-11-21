use serde::Deserialize;
use std::{collections::HashMap, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub msi: MsiConfig,
}

#[derive(Deserialize)]
struct TauriConfig {
    plugins: PluginConfig,
}

#[derive(Deserialize)]
struct PluginConfig {
    uxuescript: Config,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsiConfig {
    pub value_name: String,
    pub value: u32,
    pub keys: HashMap<String, String>,
}

pub static CONFIG: LazyLock<Config> = LazyLock::new(|| {
    serde_json::from_str::<TauriConfig>(include_str!("../../tauri.conf.json"))
        .expect("无法解析 tauri.conf.json")
        .plugins
        .uxuescript
});
