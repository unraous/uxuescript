pub use crate::app::webview::deepseek::request::{Generation, RequestState};
use crate::{app::webview::deepseek::request::Options, commands::CommandsResult};
use tauri::{Manager, State, Webview};

fn is_local_main(caller: &Webview) -> bool {
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
    state: State<'_, RequestState>,
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
    let deepseek = window
        .state::<crate::app::webview::solvers::WebSolverViews>()
        .ensure(&window, crate::config::solver::SolverKind::DeepSeekWeb)
        .await?;
    state
        .generate(&deepseek, &text, Options { timeout_ms, thinking, web_search })
        .await
        .map_err(|code| {
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
