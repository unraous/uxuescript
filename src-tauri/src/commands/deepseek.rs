pub use crate::app::webview::deepseek::request::{Generation, RequestState};
use crate::{
    app::webview::deepseek::request::{Options, TextBinding},
    commands::CommandsResult,
};
use tauri::{Manager, Webview};

pub use crate::app::webview::deepseek::authentication::Authentication;

/// Only the local configuration UI may start the read-only identity query.
#[uxs_commands::command]
pub async fn deepseek_authentication(caller: Webview) -> CommandsResult<Authentication> {
    if !is_local_main(&caller) {
        return Err(anyhow::anyhow!("DeepSeek 登录检查仅允许本地 main Webview").into());
    }
    let window = caller.window();
    let requests = window
        .state::<crate::app::webview::solvers::WebSolverViews>()
        .ensure(&window, crate::config::solver::SolverKind::DeepSeekWeb)
        .await?;
    let webview = window
        .get_webview("deepseek")
        .ok_or_else(|| anyhow::anyhow!("未找到 DeepSeek Webview"))?;
    Ok(crate::app::webview::deepseek::authentication::query(&requests, &webview).await)
}

pub(super) fn is_local_main(caller: &Webview) -> bool {
    if caller.label() != "main" || caller.window().label() != "app" {
        return false;
    }
    let Ok(url) = caller.url() else {
        return false;
    };
    if url.path() != "/main.html" {
        return false;
    }
    let local_app = if cfg!(target_os = "windows") {
        url.origin().ascii_serialization() == "http://tauri.localhost"
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    let local_dev = caller
        .app_handle()
        .config()
        .build
        .dev_url
        .as_ref()
        .is_some_and(|dev| url.origin() == dev.origin());
    local_app || local_dev
}

/// 开发诊断沿正常生成管线注册，非 debug 构建在入口拒绝；启动流程不发请求。
#[uxs_commands::command]
pub async fn deepseek_generate_text(
    caller: Webview,
    text: String,
    timeout_ms: Option<u32>,
    thinking: Option<bool>,
    web_search: Option<bool>,
) -> CommandsResult<Generation> {
    if !cfg!(debug_assertions) {
        return Err(anyhow::anyhow!("DeepSeek 诊断仅在 debug 构建启用").into());
    }
    if !is_local_main(&caller) {
        return Err(anyhow::anyhow!("DeepSeek 诊断仅允许本地 main Webview").into());
    }
    let window = caller.window();
    let requests = window
        .state::<crate::app::webview::solvers::WebSolverViews>()
        .ensure(&window, crate::config::solver::SolverKind::DeepSeekWeb)
        .await?;
    requests
        .generate_text(&text, Options { timeout_ms, thinking, web_search }, &TextBinding::default())
        .await
        .map_err(|code| {
            // ensure 已确认原生实例存在；尚未 attach 表示页面仍未就绪。
            let code = if code == "WEBVIEW_NOT_OPEN" { "DOCUMENT_NOT_READY" } else { code };
            let message = match code {
                "QUARANTINED" => "DeepSeek 远端状态未知，已隔离后续发送。请手动核对网页并重启应用；不保证远端已停止。",
                "BUSY" => "DeepSeek 已有请求在途或结果尚未确认，本次未调度生成",
                "INVALID_REQUEST" => "DeepSeek text 必须非空，timeoutMs 必须在 1000..600000；本次未调度生成",
                "DOCUMENT_NOT_READY" | "BINDING_NOT_READY" | "START_REJECTED" => "DeepSeek 文档或绑定尚未就绪，本次未调度生成",
                _ => "DeepSeek 请求检查失败，请手动核对网页；不能据此断言远端已停止",
            };
            // 已调度后的异常由 Generation::Interrupted 交付，带 unknown/quarantined，不能称为未发送。
            anyhow::anyhow!("{message} ({code})").into()
        })
}
