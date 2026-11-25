//! Visibility is derived from Layers; activation never changes solver selection
//! or the ownership of its Attempt/RequestState.
use super::{BACKGROUND_LAYER, FOREGROUND_LAYER, WebSolverViews, lifecycle};
use crate::{
    app::webview::layer::{Layers, WebviewLayer},
    config::solver::SolverKind,
};
use anyhow::{Context, Result, ensure};
use serde::Serialize;
use specta::Type;
use tauri::{Emitter, Manager, Window};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ActiveView {
    Chaoxing,
    Deepseek,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ViewActivation {
    pub view: ActiveView,
    pub focus_error: Option<String>,
}

impl WebSolverViews {
    pub(crate) async fn current_view(&self, window: &Window) -> Result<ActiveView> {
        let _operation = self.activation.lock().await;
        self.committed_view(window).await
    }

    async fn committed_view(&self, window: &Window) -> Result<ActiveView> {
        ensure!(window.label() == "app", "网页视图切换仅允许 app 窗口");
        // owned checks OwnerEnded without blocking Chaoxing behind a failed
        // solver attempt; displaying the course does not need a working solver.
        self.creations.owned()?;
        let foreground = window
            .state::<Layers>()
            .is_above(window, "deepseek", "chaoxing-mask")
            .await?;
        self.creations.owned()?;
        Ok(if foreground {
            ActiveView::Deepseek
        } else {
            ActiveView::Chaoxing
        })
    }

    pub(crate) async fn activate(
        &self,
        window: &Window,
        target: ActiveView,
    ) -> Result<ViewActivation> {
        ensure!(window.label() == "app", "网页视图切换仅允许 app 窗口");
        let owner = self.clone();
        let window = window.clone();
        self.activate_with(async move {
            if target == ActiveView::Deepseek {
                owner.ensure(&window, SolverKind::DeepSeekWeb).await?;
            }
            owner.creations.owned()?;
            if let Some(deepseek) = lifecycle::existing(&window, "deepseek")? {
                deepseek
                    .set_layer(match target {
                        ActiveView::Deepseek => FOREGROUND_LAYER,
                        ActiveView::Chaoxing => BACKGROUND_LAYER,
                    })
                    .await?;
            } else {
                ensure!(
                    target == ActiveView::Chaoxing,
                    "未找到已创建的 DeepSeek WebView"
                );
            }
            let view = owner.committed_view(&window).await?;
            ensure!(view == target, "WebView 层级与目标视图不一致");
            if let Err(error) = window.emit_to("main", "active-webview-changed", view) {
                log::warn!("视图已切换，但通知本地界面失败: {error}");
            }
            let label = match view {
                ActiveView::Chaoxing => "chaoxing",
                ActiveView::Deepseek => "deepseek",
            };
            let focus = lifecycle::existing(&window, label)
                .and_then(|view| view.with_context(|| format!("未找到焦点目标 WebView [{label}]")))
                .and_then(|view| view.set_focus().map_err(Into::into));
            let focus_error = focus.err().map(|error| {
                let message = format!("视图已切换，但请求 [{label}] 焦点失败: {error:#}");
                log::warn!("{message}");
                message
            });
            if focus_error.is_none() {
                // Tauri acknowledges dispatcher submission, not DOM input focus.
                log::debug!("已提交 [{label}] WebView 焦点请求，实际输入焦点由 GUI 验收");
            }
            Ok(ViewActivation { view, focus_error })
        })
        .await
    }

    async fn activate_with(
        &self,
        activate: impl std::future::Future<Output = Result<ViewActivation>> + Send + 'static,
    ) -> Result<ViewActivation> {
        self.creations.owned()?;
        // FIFO admission defines the accepted command order. After admission,
        // cancellation cannot release the gate between layer commit and focus.
        let operation = self.activation.clone().lock_owned().await;
        let owner = self.clone();
        tokio::spawn(async move {
            let _operation = operation;
            owner.creations.owned()?;
            let result = activate.await?;
            owner.creations.owned()?;
            Ok(result)
        })
        .await
        .context("WebView 切换任务异常结束")?
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/solvers/view.rs"]
mod tests;
