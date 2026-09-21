use crate::config::CONFIG;

use chrono::Local;
use tauri::{plugin::TauriPlugin, Wry};
use tauri_plugin_log::{Target, TargetKind};

/// 构造统一的 Rust 与 WebView 日志插件。
pub fn plugin() -> TauriPlugin<Wry> {
    CONFIG
        .paths
        .ensure()
        .expect("Failed to initialize application paths");

    let file_name = format!("{}.log", Local::now().format("%Y-%m-%d_%H-%M-%S"));

    tauri_plugin_log::Builder::new()
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{} {} {}] {}",
                Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                record.target(),
                message
            ))
        })
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::Folder {
                path: CONFIG.paths.dirs["logs"].clone(),
                file_name: Some(file_name),
            }),
        ])
        .level(log::LevelFilter::Info)
        .level_for("uxs_lib", CONFIG.metadata.log_level)
        .level_for(tauri_plugin_log::WEBVIEW_TARGET, log::LevelFilter::Trace)
        .max_file_size(10_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .build()
}
