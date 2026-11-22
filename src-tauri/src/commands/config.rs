pub mod llm;

use super::CommandsResult;

use crate::config::general::GeneralConfig;
use crate::config::{
    CONFIG, options::OptionsConfig, path::PathsConfig, solver::SolverKind, theme::ThemeName,
};

#[uxs_commands::command(webview = "mask")]
pub fn general() -> GeneralConfig {
    *CONFIG.general.lock()
}

#[uxs_commands::command]
pub fn set_general(general: GeneralConfig) {
    *CONFIG.general.lock() = general;
}

#[uxs_commands::command]
pub fn current_solver() -> SolverKind {
    *CONFIG.solver.lock()
}

#[uxs_commands::command]
pub fn set_solver(window: tauri::Window, kind: SolverKind) {
    select_solver(kind, |solver| {
        crate::app::webview::solvers::preload(window, solver)
    });
}

// Like other setters, selection updates memory. save_config (or exit) persists
// it independently; a save failure never implies that preload did not happen.
pub(crate) fn select_solver(kind: SolverKind, preload: impl FnOnce(SolverKind)) {
    *CONFIG.solver.lock() = kind;
    preload(kind);
}

/// Return the selected color theme for the main and mask WebViews.
#[uxs_commands::command(webview = "mask")]
pub fn current_theme() -> ThemeName {
    CONFIG.theme.lock().name
}

/// Select a supported color theme in memory; save_config persists it with the other settings.
#[uxs_commands::command]
pub fn set_theme(name: ThemeName) {
    log::debug!("正在设置主题: {name:?}");
    CONFIG.theme.lock().name = name;
}

#[uxs_commands::command(webview = "chaoxing")]
pub fn options() -> OptionsConfig {
    log::debug!("正在获取配置信息...");
    let options = *CONFIG.options.lock();
    log::info!("成功获取配置信息: {:?}", options);
    options
}

#[uxs_commands::command]
pub fn set_options(options: OptionsConfig) {
    log::debug!("正在设置配置信息...");
    *CONFIG.options.lock() = options;
    log::info!("成功设置配置信息: {:?}", options);
}

/// 将内存中的全局配置持久化保存至本地文件。
#[uxs_commands::command]
pub fn save_config() -> CommandsResult<()> {
    log::debug!("正在保存配置文件...");
    CONFIG.save()?;
    log::info!("成功保存配置文件");
    Ok(())
}

#[uxs_commands::command]
pub fn paths() -> PathsConfig {
    log::debug!("正在获取路径配置...");
    let paths = CONFIG.paths.clone();
    log::info!("成功获取路径配置: {:?}", paths);
    paths
}
