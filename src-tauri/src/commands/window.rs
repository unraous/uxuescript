use tauri::window::Window;
/// 发起窗口关闭请求；保存配置与退场动画由窗口事件监听器处理。
#[tauri::command]
#[specta::specta]
pub fn close(window: Window) {
    window.close().ok();
}

/// 应用窗口最小化处理指令。
#[tauri::command]
#[specta::specta]
pub fn minimize(window: Window) {
    window.minimize().ok();
}
