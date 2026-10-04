use super::CommandsResult;

use anyhow::anyhow;
use tauri::{window::Window, Emitter, Listener, Manager, State, Webview};
use tokio::sync::{oneshot, Mutex};

#[derive(Default)]
pub struct Confirmations(Mutex<()>, Mutex<()>);

/// 显示调用方对应的确认遮罩，并在退出动画及隐藏完成后返回选择。
#[tauri::command]
#[specta::specta]
pub async fn confirm(
    webview: Webview,
    window: Window,
    state: State<'_, Confirmations>,
    message: String,
) -> CommandsResult<bool> {
    let (mask_label, active) = match webview.label() {
        "main" => ("mask", &state.0),
        "chaoxing" => ("chaoxing-mask", &state.1),
        _ => return Err(anyhow!("此 Webview 不能发起确认弹窗").into()),
    };
    let Ok(_active) = active.try_lock() else {
        return Ok(false);
    };
    let mask = window
        .get_webview(mask_label)
        .ok_or_else(|| anyhow!("未找到遮罩 Webview: {mask_label}"))?;
    let (sender, receiver) = oneshot::channel();
    let listener = mask.once("confirmation-result", move |event| {
        let _ = sender.send(serde_json::from_str::<bool>(event.payload()));
    });

    if let Err(error) = mask
        .show()
        .and_then(|_| mask.emit_to(mask_label, "confirmation-pop-up", message))
    {
        mask.unlisten(listener);
        return Err(error.into());
    }

    let choice = receiver
        .await
        .map_err(|_| anyhow!("确认弹窗未能返回结果"))?
        .map_err(anyhow::Error::from)?;
    mask.hide()?;
    Ok(choice)
}

/// 遮罩监听器就绪后显示窗口并发送开屏事件。
#[tauri::command]
#[specta::specta]
pub fn start_mask(window: Window) -> CommandsResult<()> {
    window.show()?;
    let mask = window
        .get_webview("mask")
        .ok_or_else(|| anyhow!("未找到遮罩 Webview"))?;
    mask.emit_to("mask", "start-event", ())?;
    Ok(())
}

/// 显示初始化时隐藏的主界面和超星 Webview；此命令不检查页面加载状态。
#[tauri::command]
#[specta::specta]
pub fn show_content(window: Window) -> CommandsResult<()> {
    let main = window
        .get_webview("main")
        .ok_or_else(|| anyhow!("未找到主界面 Webview"))?;
    let chaoxing = window
        .get_webview("chaoxing")
        .ok_or_else(|| anyhow!("未找到超星 Webview"))?;

    main.show()?;
    chaoxing.show()?;
    Ok(())
}

/// 异步隐藏遮罩，避免遮罩 Webview 在自身 IPC 调用链中等待可见性更新。
#[tauri::command]
#[specta::specta]
pub fn hide_mask(window: Window) -> CommandsResult<()> {
    let mask = window
        .get_webview("mask")
        .ok_or_else(|| anyhow!("未找到遮罩 Webview"))?;

    tauri::async_runtime::spawn(async move {
        if let Err(e) = mask.hide() {
            log::error!("隐藏遮罩 Webview 失败: {}", e);
        }
    });
    Ok(())
}
