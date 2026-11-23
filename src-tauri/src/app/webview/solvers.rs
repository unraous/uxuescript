//! B1 keeps a solver view for the lifetime of app; switching to Native retains it.
use super::{
    deepseek::{
        creation::{Attempt, Creations},
        request::RequestState,
    },
    layer::WebviewLayer,
    lifecycle,
};
use crate::config::solver::SolverKind;
use anyhow::{Context, Result, ensure};
use std::{future::Future, sync::Arc};
use tauri::{Manager, Webview, Window};

#[derive(Clone, Default)]
pub(crate) struct WebSolverViews {
    creations: Arc<Creations>,
}

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
    pub(crate) fn destroyed(&self) {
        self.creations.destroyed();
    }

    pub(crate) async fn ensure(
        &self,
        window: &Window,
        solver: SolverKind,
    ) -> Result<Arc<RequestState>> {
        ensure!(
            solver == SolverKind::DeepSeekWeb,
            "Native LLM 不需要 WebView"
        );
        ensure!(window.label() == "app", "Web Solver 只能创建在 app 窗口中");
        let window = window.clone();
        let creations = self.creations.clone();
        self.ensure_with(move |attempt, fresh| async move {
            // An active attempt can only reuse its existing native child. A new
            // reservation must not adopt a child carrying another Arc's callbacks.
            let existing = lifecycle::existing(&window, "deepseek")?;
            if existing.is_none() != fresh {
                creations.identity_failed(&attempt);
                anyhow::bail!("DeepSeek 原生实例与创建身份不一致，无法安全恢复；请重启应用");
            }
            let preparing = attempt.clone();
            lifecycle::spawn(&window, "deepseek", attempt, move |window, view| {
                background(window, view, preparing.clone())
            })
            .await?;
            Ok(())
        })
        .await
    }

    async fn ensure_with<F, P>(&self, prepare: F) -> Result<Arc<RequestState>>
    where
        F: FnOnce(Arc<Attempt>, bool) -> P + Send + 'static,
        P: Future<Output = Result<()>> + Send,
    {
        self.creations.check()?;
        if let Some(attempt) = self.creations.current()? {
            if let Ok(requests) = attempt.requests_if_ready() {
                return Ok(requests);
            }
        }
        let owner = self.clone();
        // Cancellation of a command/preload waiter must not release the admission
        // lock or strand its reservation before native placement and Ready publication.
        tokio::spawn(async move {
            let _operation = loop {
                let stopped = owner.creations.stopped();
                tokio::pin!(stopped);
                stopped.as_mut().enable();
                owner.creations.check()?;
                tokio::select! {
                    operation = owner.creations.operation.lock() => break operation,
                    _ = stopped => {}
                }
            };
            let (attempt, fresh) = match owner.creations.current()? {
                Some(attempt) => (attempt, false),
                None => (owner.creations.begin()?, true),
            };
            if let Ok(requests) = attempt.requests_if_ready() {
                return Ok(requests);
            }
            if let Err(error) = prepare(attempt.clone(), fresh).await {
                owner.creations.creation_failed(&attempt);
                if let Err(gate) = owner.creations.check() {
                    return Err(error.context(format!("{gate:#}")));
                }
                return Err(error);
            }
            owner.creations.publish_ready(&attempt)
        })
        .await
        .context("Web Solver 实例创建任务异常结束")?
    }

    // Internal B3-B seam: closing gates local work but does not close a native
    // child, remove Layers, release the slot or permit another generation.
    #[allow(dead_code)]
    pub(crate) fn current_attempt(&self) -> Result<Option<Arc<Attempt>>> {
        self.creations.owned()
    }

    #[allow(dead_code)]
    pub(crate) fn begin_close(&self, attempt: &Arc<Attempt>) -> Result<()> {
        self.creations.begin_close(attempt)
    }

    #[allow(dead_code)]
    pub(crate) fn retry_cleanup(&self, attempt: &Arc<Attempt>) -> Result<()> {
        self.creations.retry_cleanup(attempt)
    }
}

async fn background(window: Window, _view: Webview, attempt: Arc<Attempt>) -> Result<()> {
    attempt.check_active()?;
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

#[cfg(test)]
#[path = "../../../tests/unit/app/webview/solvers.rs"]
mod tests;
