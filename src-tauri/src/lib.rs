pub mod app;
pub mod commands;
pub mod config;
pub mod core;
pub mod secret_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    uxs_commands::sync_bindings!();

    use app::webview::UrlStack;
    use app::window;
    use commands::chaoxing::CourseMetaMap;
    use commands::mask::Confirmations;
    use commands::updater::DownloadState;

    #[cfg(target_os = "windows")]
    // Set before Tauri starts its worker threads, so no other thread can access the environment concurrently.
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-background-timer-throttling \
             --disable-renderer-backgrounding \
             --disable-backgrounding-occluded-windows \
             --disable-background-media-suspend \
             --lang=zh-CN --accept-lang=zh-CN,zh",
        );
    }

    tauri::Builder::default()
        .plugin(core::logger::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(window::listener)
        .manage(UrlStack::default())
        .manage(CourseMetaMap::default())
        .manage(Confirmations::default())
        .manage(DownloadState::default())
        .invoke_handler(uxs_commands::register!())
        .setup(window::init)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[path = "../tests/unit/support.rs"]
mod test_support;
