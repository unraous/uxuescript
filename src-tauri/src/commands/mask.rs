use super::CommandsResult;

use anyhow::anyhow;
use serde::Serialize;
use specta::Type;
use tauri::{Emitter, Listener, Manager, State, Webview, window::Window};
use tokio::sync::{Mutex, oneshot};

#[derive(Default)]
pub struct Confirmations(Mutex<()>, Mutex<()>);

#[derive(Clone, serde::Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmOptions {
    pub title: Option<String>,
    pub read_seconds: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Confirmation {
    message: String,
    options: Option<ConfirmOptions>,
}

/// 显示调用方对应的确认遮罩，并在退出动画及隐藏完成后返回选择。
#[uxs_commands::command(webview = "chaoxing")]
pub async fn confirm(
    webview: Webview,
    window: Window,
    state: State<'_, Confirmations>,
    message: String,
    options: Option<ConfirmOptions>,
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

    if let Err(error) = mask.show().and_then(|_| {
        mask.emit_to(
            mask_label,
            "confirmation-pop-up",
            Confirmation { message, options },
        )
    }) {
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

/// 显示初始化时隐藏的主界面和超星 Webview；此命令不检查页面加载状态。
#[uxs_commands::command(webview = "mask")]
pub fn show_content(window: Window) -> CommandsResult<()> {
    window
        .get_webview("main")
        .ok_or_else(|| anyhow!("未找到主界面 Webview"))?
        .show()?;
    window
        .get_webview("chaoxing")
        .ok_or_else(|| anyhow!("未找到超星 Webview"))?
        .show()?;

    Ok(())
}

/// 异步隐藏遮罩，避免遮罩 Webview 等待自身 IPC 调用链；开屏完成时通知主界面。
#[uxs_commands::command(webview = "mask")]
pub fn hide_mask(window: Window, notify_startup: bool) -> CommandsResult<()> {
    let mask = window
        .get_webview("mask")
        .ok_or_else(|| anyhow!("未找到遮罩 Webview"))?;

    tauri::async_runtime::spawn(async move {
        let result = mask.hide().and_then(|_| {
            if notify_startup {
                window.emit_to("main", "startup-finished", ())
            } else {
                Ok(())
            }
        });
        if let Err(error) = result {
            log::error!("隐藏遮罩失败: {error}");
        }
    });
    Ok(())
}
