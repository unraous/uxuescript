//! B1 keeps a solver view for the lifetime of app; switching to Native retains it.
use super::{layer::WebviewLayer, lifecycle};
use crate::config::solver::SolverKind;
use anyhow::{Result, ensure};
use tauri::{Manager, Webview, Window};

#[derive(Default)]
pub(crate) struct WebSolverViews(tokio::sync::Mutex<()>);

// Static front to back, then the solver. Static views keep their relative order. Set those
// priorities before raising DeepSeek from Lifecycle's initial backmost position.
pub(super) const BACKGROUND_ORDER: [(&str, i32); 5] = [
    ("mask", 4),
    ("chaoxing-mask", 3),
    ("chaoxing", 2),
    ("main", 0),
    ("deepseek", 1),
];

impl WebSolverViews {
    pub(crate) async fn ensure(&self, window: &Window, solver: SolverKind) -> Result<Webview> {
        ensure!(
            solver == SolverKind::DeepSeekWeb,
            "Native LLM 不需要 WebView"
        );
        ensure!(window.label() == "app", "Web Solver 只能创建在 app 窗口中");
        let _operation = self.0.lock().await;
        let requests = window.state::<super::deepseek::request::RequestState>();
        requests.creation.check()?;
        // Lifecycle owns a cancellation-safe task. Its prepare hook runs while
        // the new child is still outside the window, before geometry restoration.
        let result = lifecycle::spawn(window, "deepseek", background).await;
        if let Err(error) = result {
            if let Err(gate) = requests.creation.check() {
                return Err(error.context(format!("{gate:#}")));
            }
            return Err(error);
        }
        requests.creation.check_active()?;
        result
    }
}

async fn background(window: Window, _view: Webview) -> Result<()> {
    window
        .state::<super::deepseek::request::RequestState>()
        .creation
        .check_active()?;
    for (label, priority) in BACKGROUND_ORDER {
        let view = lifecycle::existing(&window, label)?
            .ok_or_else(|| anyhow::anyhow!("后台归位缺少 WebView [{label}]"))?;
        view.set_layer(priority).await?;
    }
    Ok(())
}

/// Selection updates memory immediately; persistence stays with save_config and
/// exit. A successful preload means native creation/placement, not page readiness.
pub(crate) fn preload(window: Window, solver: SolverKind) {
    if solver != SolverKind::DeepSeekWeb {
        return;
    }
    tauri::async_runtime::spawn(async move {
        match window
            .state::<WebSolverViews>()
            .ensure(&window, solver)
            .await
        {
            Ok(_) => log::debug!("DeepSeek WebView 已创建/复用并后台归位，页面就绪另行检查"),
            Err(error) => log::error!("DeepSeek WebView 预加载失败（配置选择保持不变）: {error:#}"),
        }
    });
}
