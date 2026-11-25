/// 供主界面 [main] Webview 控制超星 [Chaoxing] Webview 的命令集。
use super::CommandsResult;

use crate::app::webview::{UrlStack, home_url};

use anyhow::anyhow;
use tauri::{Manager, window};

use crate::app::webview::solvers::{ActiveView, ViewActivation, WebSolverViews};

fn switching_window(caller: &tauri::Webview) -> anyhow::Result<window::Window> {
    anyhow::ensure!(
        super::deepseek::is_local_main(caller),
        "网页视图切换仅允许 app 窗口中的本地 main Webview"
    );
    Ok(caller.window())
}

#[uxs_commands::command]
pub async fn activate_deepseek_view(caller: tauri::Webview) -> CommandsResult<ViewActivation> {
    let window = switching_window(&caller)?;
    Ok(window
        .state::<WebSolverViews>()
        .activate(&window, ActiveView::Deepseek)
        .await?)
}

#[uxs_commands::command]
pub async fn activate_chaoxing_view(caller: tauri::Webview) -> CommandsResult<ViewActivation> {
    let window = switching_window(&caller)?;
    Ok(window
        .state::<WebSolverViews>()
        .activate(&window, ActiveView::Chaoxing)
        .await?)
}

#[uxs_commands::command]
pub async fn current_webview(caller: tauri::Webview) -> CommandsResult<ActiveView> {
    let window = switching_window(&caller)?;
    Ok(window
        .state::<WebSolverViews>()
        .current_view(&window)
        .await?)
}

fn stop_task(window: &window::Window) {
    window.state::<super::task::TaskSession>().clear();
}

#[uxs_commands::command]
pub fn set_zoom(window: window::Window, scale: f64) -> CommandsResult<()> {
    super::course_webview(&window)?.set_zoom(scale)?;
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
    super::course_webview(&window)?.navigate(home_url())?;
    Ok(())
}

#[uxs_commands::command]
pub fn go_back(window: window::Window, url_stack: tauri::State<UrlStack>) -> CommandsResult<()> {
    stop_task(&window);
    if let Some(url) = url_stack.back() {
        super::course_webview(&window)?.navigate(url)?;
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
        super::course_webview(&window)?.navigate(url)?;
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
    super::course_webview(&window)?.reload()?;
    Ok(())
}
