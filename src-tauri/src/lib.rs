pub mod app;
pub mod commands;
pub mod config;
pub mod core;

pub fn sync_bindings() {
    commands_collector::sync_bindings!();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use app::webview::UrlStack;
    use app::window;
    use commands::chaoxing::CourseMetaMap;

    // 禁用 WebView2 硬件 GPU 加速以降低 100MB+ 内存占用并提升性能
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
        .invoke_handler(commands_collector::register!())
        .setup(window::init)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
