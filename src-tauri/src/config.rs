pub mod general;
pub mod llm;
pub mod options;
pub mod path;
pub mod solver;
pub mod theme;

use general::GeneralConfig;
use llm::LLMConfig;
use options::OptionsConfig;
use path::PathsConfig;
use solver::SolverKind;
use theme::ThemeConfig;

use anyhow::Result;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Config {
    pub version: String,
    pub log_level: log::LevelFilter,
    pub paths: PathsConfig,
    pub options: Mutex<OptionsConfig>,
    pub general: Mutex<GeneralConfig>,
    pub theme: Mutex<ThemeConfig>,
    pub solver: Mutex<SolverKind>,
    pub llm: LLMConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").into(),
            log_level: if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            },
            paths: PathsConfig::default(),
            options: Mutex::new(OptionsConfig::default()),
            general: Mutex::new(GeneralConfig::default()),
            theme: Mutex::new(ThemeConfig::default()),
            solver: Mutex::new(SolverKind::default()),
            llm: LLMConfig::default(),
        }
    }
}

impl Config {
    // 此处日志系统尚未初始化完成，读取配置文件失败时将直接降级回退至默认配置。
    fn load() -> Self {
        let config = Self::default();
        Self::parse(&std::fs::read_to_string(&config.paths.files["config"]).unwrap_or_default())
            .unwrap_or(config)
    }

    fn parse(content: &str) -> Result<Self> {
        let mut config: toml::Table = toml::from_str(content)?;
        let metadata = config.remove("metadata");
        let version_changed = config
            .get("version")
            .or_else(|| metadata.as_ref().and_then(|value| value.get("version")))
            .and_then(toml::Value::as_str)
            != Some(env!("CARGO_PKG_VERSION"));
        // 兼容旧 metadata 中的日志级别与版本；未记录版本的配置在首次升级时刷新预设。
        if let Some(level) = metadata.and_then(|value| value.get("logLevel").cloned()) {
            config.entry("log_level").or_insert(level);
        }
        let mut config: Self = config.try_into()?;
        let providers = config.llm.providers.get_mut();
        for (id, preset) in LLMConfig::default().providers.into_inner() {
            // 已保存的 provider 映射不会自动包含后续新增的内置项，同版本加载时也需补齐。
            let provider = providers.entry(id).or_insert_with(|| preset.clone());
            if version_changed && !provider.is_custom {
                let selected = provider
                    .chosen_model
                    .and_then(|index| provider.models.get(index));
                provider.chosen_model = selected
                    .and_then(|name| preset.models.iter().position(|model| model == name))
                    .or(preset.chosen_model);
                provider.models = preset.models;
            }
        }
        config.version = env!("CARGO_PKG_VERSION").into();
        Ok(config)
    }

    pub fn save(&self) -> Result<()> {
        std::fs::write(&self.paths.files["config"], toml::to_string_pretty(&self)?)?;
        log::info!("配置已保存到 {}", self.paths.files["config"].display());
        Ok(())
    }
}

pub static CONFIG: LazyLock<Config> = LazyLock::new(Config::load);

#[cfg(test)]
#[path = "../tests/unit/config.rs"]
mod tests;
