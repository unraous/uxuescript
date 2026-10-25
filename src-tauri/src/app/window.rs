use super::webview;

#[cfg(windows)]
mod fullscreen;

use crate::config::CONFIG;

use anyhow::Result;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{
    Emitter, Listener, LogicalPosition, LogicalSize, Manager, PhysicalSize, WindowBuilder,
    WindowEvent, image::Image, webview::Webview, window::Window,
};

/// 执行窗口关闭前的应用状态刷新与持久化收尾工作
async fn flush_app_state() {
    if let Err(e) = CONFIG.save() {
        log::error!("保存配置失败: {}", e);
    } else {
        log::debug!("配置成功保存");
    }
}

/// 触发前端遮罩层退场动画与事件通知
async fn notify_exit_animation(window: &Window) {
    if let Some(mask) = window.get_webview("mask") {
        log::debug!("执行关闭动画并关闭窗口");
        mask.show().ok();
        if let Err(e) = mask.emit_to("mask", "close-event", &()) {
            log::error!("发送关闭动画事件失败: {}", e);
        }
        log::debug!("关闭动画触发完毕");
    } else {
        log::error!("未找到遮罩Webview，无法执行关闭动画");
    }
}

/// 防止重复 CloseRequested 触发并行清理。
static CLOSING: AtomicBool = AtomicBool::new(false);

async fn close(window: Window) {
    if CLOSING.swap(true, Ordering::SeqCst) {
        log::debug!("关闭流程已在进行，忽略重复请求");
        return;
    }
    log::debug!("执行程序收尾工作，即将关闭应用");
    if tokio::time::timeout(Duration::from_millis(2000), prepare_exit(&window))
        .await
        .is_err()
    {
        log::warn!("关闭收尾超时，强制销毁窗口");
    }
    window.destroy().ok();
}

/// Run the same exit animation and state flush before an updater exits the process directly.
pub async fn prepare_exit(window: &Window) {
    tokio::join!(
        tokio::time::sleep(Duration::from_millis(750)),
        notify_exit_animation(window),
        flush_app_state(),
    );
}

fn resize(webview: &Webview, size: LogicalSize<f64>) -> Result<()> {
    let (pos, size) = match webview.label() {
        "chaoxing" | "chaoxing-mask" => (
            LogicalPosition::new(size.width * 0.51, size.height * 0.46),
            LogicalSize::new(size.width * 0.48, size.height * 0.48),
        ),
        _ => (LogicalPosition::new(0.0, 0.0), size),
    };
    webview.set_position(pos)?;
    webview.set_size(size)?;
    Ok(())
}

fn resize_webviews(window: &Window, size: PhysicalSize<u32>) -> Result<()> {
    let size: LogicalSize<f64> = LogicalSize::from_physical(size, window.scale_factor()?);
    let webviews = window.webviews();
    for webview in webviews {
        resize(&webview, size)?;
    }
    Ok(())
}

/// 负责在接收到关闭请求时阻止默认销毁的窗口事件处理。
pub fn listener(window: &tauri::Window, event: &tauri::WindowEvent) {
    log::debug!("监听到窗口事件: {:?}", event);
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            tauri::async_runtime::spawn(close(window.clone()));
        }
        WindowEvent::Destroyed => {
            log::debug!("主程序窗口已销毁，应用已关闭");
        }
        WindowEvent::Resized(physical_size) => {
            if let Err(e) = resize_webviews(window, *physical_size) {
                log::error!("Resize时出现错误：{}", e);
            }
        }
        _ => {}
    }
}

/// 调试构建优先选取 1920×1080 显示器，否则使用枚举到的第一块显示器。
fn select_monitor_from(monitors: &[tauri::Monitor]) -> &tauri::Monitor {
    if cfg!(debug_assertions) {
        log::debug!("开始检测1080p屏幕");
        monitors
            .iter()
            .find(|m| {
                let size = m.size();
                size.width == 1920 && size.height == 1080
            })
            .unwrap_or(&monitors[0])
    } else {
        &monitors[0]
    }
}

/**
 * Creates a hidden fullscreen window and four child WebViews in order:
 * main, chaoxing, chaoxing-mask, mask. The first three are hidden initially;
 * the startup mask controls when the window and content become visible.
 *
 * Doesn't use `anyhow::Result` because `tauri::Builder::setup` strictly expects
 * `std::result::Result<(), Box<dyn std::error::Error>>` to prevent public API signature coupling with third-party error crates.
 */
pub fn init(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    log::debug!("开始初始化应用窗口");
    #[cfg(windows)]
    app.wry_plugin(fullscreen::Fullscreen);

    let monitors = app.available_monitors()?;

    let target_monitor = select_monitor_from(&monitors);
    let monitor_pos = target_monitor.position();

    let window = WindowBuilder::new(app, "app")
        .title("uxuescript")
        // maybe later vision would use this
        // .decorations(false)
        // .transparent(true)
        // .inner_size(800.0, 600.0)
        // .shadow(false)
        .fullscreen(true)
        .visible(false)
        .position(monitor_pos.x as f64, monitor_pos.y as f64)
        .background_color((0, 0, 0).into())
        .icon(Image::from_bytes(include_bytes!("../../icons/icon.ico"))?)?
        .build()?;

    webview::init_on(&window, "main")?.hide()?;
    webview::init_on(&window, "chaoxing")?.hide()?;
    webview::init_on(&window, "chaoxing-mask")?.hide()?;
    let mask = webview::init_on(&window, "mask")?;
    let startup_started = Arc::new(AtomicBool::new(false));
    let startup_window = window.clone();
    mask.listen("mask-ready", move |_| {
        if startup_started.swap(true, Ordering::AcqRel) {
            return;
        }

        if let Err(error) = startup_window
            .show()
            .and_then(|_| startup_window.emit_to("mask", "start-event", ()))
        {
            startup_started.store(false, Ordering::Release);
            log::error!("启动开屏动画失败: {error}");
        }
    });

    log::info!("初始化应用窗口成功");

    Ok(())
}
