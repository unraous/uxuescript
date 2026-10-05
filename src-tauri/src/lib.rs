pub mod app;
pub mod commands;
pub mod config;
pub mod core;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    uxs_commands::sync_bindings!();

    use app::webview::UrlStack;
    use app::window;
    use commands::chaoxing::CourseMetaMap;
    use commands::mask::Confirmations;

    // 禁用 WebView2 硬件 GPU 加速以降低 100MB+ 内存占用并提升性能
    #[cfg(target_os = "windows")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-gpu --disable-background-timer-throttling \
         --disable-renderer-backgrounding \
         --disable-backgrounding-occluded-windows \
         --disable-background-media-suspend \
         --lang=zh-CN --accept-lang=zh-CN,zh",
    );

    tauri::Builder::default()
        .plugin(core::logger::plugin())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(window::listener)
        .manage(UrlStack::default())
        .manage(CourseMetaMap::default())
        .manage(Confirmations::default())
        .invoke_handler(uxs_commands::register!())
        .setup(window::init)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
