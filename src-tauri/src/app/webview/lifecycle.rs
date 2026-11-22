//! Coordinates dynamic children; instance existence remains owned by Tauri.
use super::layer::Layers;
use anyhow::{Context, Result, anyhow, ensure};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, Webview, Window};

struct WindowState {
    operation: tokio::sync::Mutex<()>,
    alive: AtomicBool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            operation: tokio::sync::Mutex::new(()),
            alive: AtomicBool::new(true),
        }
    }
}

impl WindowState {
    fn check_alive(&self) -> Result<()> {
        ensure!(
            self.alive.load(Ordering::Acquire),
            "窗口已销毁，不能操作动态 WebView"
        );
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct Lifecycle(Mutex<HashMap<String, Arc<WindowState>>>);

impl Lifecycle {
    pub(crate) fn register_window(&self, window: &Window) {
        self.0
            .lock()
            .insert(window.label().to_owned(), Arc::default());
    }

    fn window(&self, window: &Window) -> Result<Arc<WindowState>> {
        self.0
            .lock()
            .get(window.label())
            .cloned()
            .context("窗口的 WebView 生命周期尚未初始化或已结束")
    }

    pub(crate) fn destroyed(&self, window: &Window) {
        if let Some(state) = self.0.lock().remove(window.label()) {
            // Do not block the UI thread waiting for a native operation. Old
            // handles retain this invalidated state and cannot recreate a gate.
            state.alive.store(false, Ordering::Release);
        }
        // In-flight layer operations only hold the removed order's Arc; they
        // cannot reinsert it. spawn checks alive again before reporting success.
        window.state::<Layers>().remove(window);
    }
}

fn validate_dynamic(label: &str) -> Result<()> {
    match label {
        "main" | "chaoxing" | "chaoxing-mask" | "mask" => {
            anyhow::bail!("静态 WebView [{label}] 不允许动态创建或销毁")
        }
        // B still needs instance-scoped RequestState/Observer and detach support.
        "deepseek" => anyhow::bail!("DeepSeek 动态生命周期尚未开放"),
        _ => anyhow::bail!("未开放的动态 WebView 标签: {label}"),
    }
}

fn existing(window: &Window, label: &str) -> Result<Option<Webview>> {
    let view = window.get_webview(label);
    if let Some(view) = &view {
        ensure!(
            view.window().label() == window.label(),
            "WebView [{label}] 不属于目标窗口"
        );
    }
    Ok(view)
}

// Stage A exposes no production target yet. Future dynamic call sites must use
// these entry points, rather than calling the creation factory or close directly.
#[allow(dead_code)]
pub(crate) async fn spawn(window: &Window, label: &str) -> Result<Webview> {
    validate_dynamic(label)?;
    let state = window.state::<Lifecycle>().window(window)?;
    let window = window.clone();
    let label = label.to_owned();
    // Cancellation must not strand a child between creation and registration.
    tokio::spawn(async move {
        let layer_state = window.state::<Layers>();
        let layers = &*layer_state;
        let window = &window;
        let label = label.as_str();
        spawn_entry(
            &state,
            || existing(&window, &label),
            || super::create_on(&window, &label, true).map_err(|error| anyhow!(error.to_string())),
            |view: Webview| async move {
                layers.add_entry(&view).await?;
                let (position, size) = super::placement_on(&window, &label)
                    .map_err(|error| anyhow!(error.to_string()))?;
                // Repeating this also recovers a staged child if rollback close
                // failed earlier, including resizes skipped while it was staged.
                // No visibility toggle or document reload occurs.
                view.set_size(size)?;
                view.set_position(position)?;
                Ok(())
            },
            |view: Webview| async move {
                view.close()?;
                layers.remove_entry(&window, &label).await;
                Ok(())
            },
        )
        .await
        .with_context(|| format!("创建动态 WebView [{label}] 失败"))
    })
    .await
    .context("动态 WebView 创建任务异常结束")?
}

#[allow(dead_code)]
pub(crate) async fn destroy(window: &Window, label: &str) -> Result<()> {
    validate_dynamic(label)?;
    let state = window.state::<Lifecycle>().window(window)?;
    let window = window.clone();
    let label = label.to_owned();
    tokio::spawn(async move {
        destroy_entry(
            &state,
            || existing(&window, &label),
            |view: Webview| async move { view.close().map_err(Into::into) },
            || async {
                window.state::<Layers>().remove_entry(&window, &label).await;
            },
        )
        .await
        .with_context(|| format!("销毁动态 WebView [{label}] 失败"))
    })
    .await
    .context("动态 WebView 销毁任务异常结束")?
}

async fn spawn_entry<V: Clone, P, C>(
    state: &WindowState,
    find: impl FnOnce() -> Result<Option<V>>,
    create: impl FnOnce() -> Result<V>,
    prepare: impl Fn(V) -> P,
    close: impl Fn(V) -> C,
) -> Result<V>
where
    P: Future<Output = Result<()>>,
    C: Future<Output = Result<()>>,
{
    let _operation = state.operation.lock().await;
    state.check_alive()?;
    let previous = find()?;
    let created = previous.is_none();
    let view = match previous {
        Some(view) => view,
        None => create()?,
    };
    let result = async {
        state.check_alive()?;
        prepare(view.clone()).await?;
        state.check_alive()
    }
    .await;
    if let Err(error) = result {
        if created {
            if let Err(rollback) = close(view.clone()).await {
                return Err(anyhow!(
                    "{error:#}; 关闭新 WebView 回滚失败: {rollback:#}; 实例保留，可重试创建或销毁"
                ));
            }
        }
        return Err(error);
    }
    Ok(view)
}

async fn destroy_entry<V, C, U>(
    state: &WindowState,
    find: impl FnOnce() -> Result<Option<V>>,
    close: impl Fn(V) -> C,
    unregister: impl FnOnce() -> U,
) -> Result<()>
where
    C: Future<Output = Result<()>>,
    U: Future<Output = ()>,
{
    let _operation = state.operation.lock().await;
    state.check_alive()?;
    if let Some(view) = find()? {
        close(view).await?;
    }
    unregister().await;
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/unit/app/lifecycle.rs"]
mod tests;
