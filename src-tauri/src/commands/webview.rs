/// 供主界面 [main] Webview 控制超星 [Chaoxing] Webview 的命令集。
use super::CommandsResult;

use crate::app::config::CONFIG;
use crate::app::webview::{CourseWebview, UrlStack};

use anyhow::anyhow;
use tauri::{Manager, window};

fn stop_task(window: &window::Window) {
    window.state::<super::task::TaskSession>().clear();
}

#[uxs_commands::command]
pub fn set_zoom(window: window::Window, scale: f64) -> CommandsResult<()> {
    let course = window.state::<CourseWebview>();
    course.main.set_zoom(scale)?;
    Ok(())
}

#[uxs_commands::command]
pub fn can_go_back(url_stack: tauri::State<UrlStack>) -> bool {
    url_stack.can_back()
}

#[uxs_commands::command]
pub fn can_go_forward(url_stack: tauri::State<UrlStack>) -> bool {
    url_stack.can_forward()
}

#[uxs_commands::command]
pub fn go_home(window: window::Window) -> CommandsResult<()> {
    stop_task(&window);
    window
        .state::<CourseWebview>()
        .main
        .navigate(CONFIG.home_url.clone())?;
    Ok(())
}

#[uxs_commands::command]
pub fn go_back(window: window::Window, url_stack: tauri::State<UrlStack>) -> CommandsResult<()> {
    stop_task(&window);
    if let Some(url) = url_stack.back() {
        window.state::<CourseWebview>().main.navigate(url)?;
        Ok(())
    } else {
        log::warn!("[chaoxing] 无法后退：已无历史页面");
        Err(anyhow!("无法后退：没有更早的历史页面").into())
    }
}

#[uxs_commands::command]
pub fn go_forward(window: window::Window, url_stack: tauri::State<UrlStack>) -> CommandsResult<()> {
    stop_task(&window);
    if let Some(url) = url_stack.forward() {
        log::debug!("[chaoxing] 前进至: {}", url);
        window.state::<CourseWebview>().main.navigate(url)?;
        Ok(())
    } else {
        log::warn!("[chaoxing] 无法前进：已是最新页面");
        Err(anyhow!("无法前进：没有更新的历史页面").into())
    }
}

#[uxs_commands::command]
pub fn current_url(url_stack: tauri::State<UrlStack>) -> Option<String> {
    url_stack.current().map(|url| url.to_string())
}

#[uxs_commands::command]
pub fn reload(window: window::Window) -> CommandsResult<()> {
    stop_task(&window);
    window.state::<CourseWebview>().main.reload()?;
    Ok(())
}
