pub mod general;
pub mod llm;
pub mod options;
pub mod path;
pub mod theme;

use general::GeneralConfig;
use llm::LLMConfig;
use options::OptionsConfig;
use path::PathsConfig;
use theme::ThemeConfig;

use anyhow::{bail, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

/// Set when an existing config could not be read/parsed. In that state saves
/// must be refused rather than silently replacing a possibly recoverable file.
static CONFIG_LOAD_FAILED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Config {
    pub version: String,
    pub log_level: log::LevelFilter,
    pub paths: PathsConfig,
    pub options: Mutex<OptionsConfig>,
    pub general: Mutex<GeneralConfig>,
    pub theme: Mutex<ThemeConfig>,
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
            llm: LLMConfig::default(),
        }
    }
}

impl Config {
    // 日志系统尚未初始化，读取/解析失败时记录到 stderr 并拒绝后续覆盖。
    fn load() -> Self {
        let config = Self::default();
        let path = &config.paths.files["config"];
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => {
                CONFIG_LOAD_FAILED.store(true, Ordering::Relaxed);
                eprintln!("读取配置失败，已拒绝覆盖原文件: {error}");
                String::new()
            }
        };
        match Self::parse(&content) {
            Ok(config) => config,
            Err(error) => {
                CONFIG_LOAD_FAILED.store(true, Ordering::Relaxed);
                eprintln!("解析配置失败，已拒绝覆盖原文件: {error:#}");
                config
            }
        }
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
        if CONFIG_LOAD_FAILED.load(Ordering::Relaxed) {
            bail!("配置加载失败，拒绝覆盖现有配置文件");
        }
        let path = &self.paths.files["config"];
        let parent = path.parent().context("配置文件路径没有父目录")?;
        std::fs::create_dir_all(parent)?;
        let content = toml::to_string_pretty(self)?;
        let temp = path.with_extension("toml.tmp");
        let backup = path.with_extension("toml.bak");
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&temp)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
        }
        if path.exists() {
            std::fs::copy(path, &backup)
                .with_context(|| format!("备份配置失败: {}", backup.display()))?;
        }
        match std::fs::rename(&temp, path) {
            Ok(()) => {}
            Err(rename_error) => {
                // Windows cannot atomically replace an existing destination
                // with std::fs::rename. Preserve the backup and fall back to
                // a checked copy, leaving the temp file if that also fails.
                std::fs::copy(&temp, path).with_context(|| {
                    format!(
                        "替换配置失败（rename: {rename_error}）: {}",
                        path.display()
                    )
                })?;
                let _ = std::fs::remove_file(&temp);
            }
        }
        log::info!("配置已保存到 {}", path.display());
        Ok(())
    }
}

pub static CONFIG: LazyLock<Config> = LazyLock::new(Config::load);

#[cfg(test)]
#[path = "../tests/unit/config.rs"]
mod tests;
