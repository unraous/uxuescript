use anyhow::{Context, Result, anyhow};
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::{Manager, Webview};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    label: String,
    layer: i32,
}

/// Per-window order, from front to back. The async lock serializes native moves
/// and their corresponding state updates without blocking the UI thread.
#[derive(Default)]
pub struct Layers(Mutex<HashMap<String, Arc<tokio::sync::Mutex<Vec<Entry>>>>>);

impl Layers {
    pub fn register(&self, window: &tauri::Window, labels: &[&str]) {
        let entries = labels
            .iter()
            .rev()
            .map(|label| Entry {
                label: (*label).to_owned(),
                layer: 0,
            })
            .collect();
        self.0.lock().insert(
            window.label().to_owned(),
            Arc::new(tokio::sync::Mutex::new(entries)),
        );
    }

    pub fn remove(&self, window: &tauri::Window) {
        self.0.lock().remove(window.label());
    }
}

/// Controls a WebView's stacking position among its siblings.
pub trait WebviewLayer {
    /// Larger values appear in front; a repeated value moves this view ahead of its peers.
    /// Unset views start at zero in their creation order, newest in front.
    fn set_layer(&self, layer: i32) -> impl std::future::Future<Output = Result<()>> + Send;
}

impl WebviewLayer for Webview {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    async fn set_layer(&self, layer: i32) -> Result<()> {
        // The spawned operation completes its native move and state update even if
        // the caller stops awaiting the result.
        let webview = self.clone();
        tokio::spawn(async move { set_layer(&webview, layer).await })
            .await
            .context("WebView 层级任务异常结束")?
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    async fn set_layer(&self, _layer: i32) -> Result<()> {
        log::warn!("当前平台不支持调整 WebView [{}] 层级", self.label());
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn set_layer(webview: &Webview, layer: i32) -> Result<()> {
    let window = webview.window();
    let layers = window.state::<Layers>();
    let order = layers
        .0
        .lock()
        .get(window.label())
        .cloned()
        .context("窗口的 WebView 层级尚未初始化")?;
    let mut order = order.lock().await;
    update_order(&mut order, webview.label(), layer, |anchor| async {
        let anchor = anchor
            .map(|label| {
                window
                    .get_webview(&label)
                    .with_context(|| format!("未找到同级 WebView: {label}"))
            })
            .transpose()?;
        move_view(webview, anchor.as_ref()).await
    })
    .await
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
async fn update_order<F, Fut>(
    order: &mut Vec<Entry>,
    label: &str,
    layer: i32,
    move_native: F,
) -> Result<()>
where
    F: FnOnce(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let old_index = order
        .iter()
        .position(|entry| entry.label == label)
        .with_context(|| format!("WebView [{label}] 未登记层级"))?;
    let mut next = order.clone();
    let mut entry = next.remove(old_index);
    entry.layer = layer;
    let index = next
        .iter()
        .position(|other| other.layer <= layer)
        .unwrap_or(next.len());
    if index != old_index {
        let anchor = index.checked_sub(1).map(|i| next[i].label.clone());
        move_native(anchor).await?;
    }
    next.insert(index, entry);
    *order = next;
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn native_handle(webview: &Webview) -> Result<usize> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview.with_webview(move |view| {
        #[cfg(target_os = "macos")]
        let result = Ok(view.inner() as usize);
        #[cfg(target_os = "windows")]
        let result = unsafe {
            let mut hwnd = windows::Win32::Foundation::HWND::default();
            view.controller()
                .ParentWindow(&mut hwnd)
                .map(|_| hwnd.0 as usize)
                .map_err(anyhow::Error::from)
        };
        let _ = sender.send(result);
    })?;
    receiver.await.context("获取 WebView 原生句柄未执行")?
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn move_view(webview: &Webview, anchor: Option<&Webview>) -> Result<()> {
    let anchor = match anchor {
        Some(view) => Some(native_handle(view).await?),
        None => None,
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview.with_webview(move |view| {
        let _ = sender.send(move_native(view, anchor));
    })?;
    receiver.await.context("WebView 层级操作未执行")?
}

#[cfg(target_os = "macos")]
fn move_native(webview: tauri::webview::PlatformWebview, anchor: Option<usize>) -> Result<()> {
    use objc2_app_kit::{NSView, NSWindowOrderingMode};
    let view = unsafe { &*webview.inner().cast::<NSView>() };
    let parent = unsafe { view.superview() }.context("WebView 没有父视图")?;
    if let Some(anchor) = anchor {
        let siblings = parent.subviews();
        let sibling = (0..siblings.count())
            .map(|i| siblings.objectAtIndex(i))
            .find(|item| (&**item as *const NSView) as usize == anchor)
            .ok_or_else(|| anyhow!("目标同级 WebView 已不存在"))?;
        parent.addSubview_positioned_relativeTo(view, NSWindowOrderingMode::Below, Some(&sibling));
    } else {
        parent.addSubview_positioned_relativeTo(view, NSWindowOrderingMode::Above, None);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn move_native(webview: tauri::webview::PlatformWebview, anchor: Option<usize>) -> Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GW_HWNDFIRST, GW_HWNDNEXT, GetWindow, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SetWindowPos,
    };
    unsafe {
        let mut hwnd = HWND::default();
        webview.controller().ParentWindow(&mut hwnd)?;
        let insert_after = if let Some(anchor) = anchor {
            let mut sibling = GetWindow(hwnd, GW_HWNDFIRST)?;
            while sibling.0 as usize != anchor {
                sibling = GetWindow(sibling, GW_HWNDNEXT).context("目标同级 WebView 已不存在")?;
            }
            sibling
        } else {
            HWND_TOP
        };
        SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn layers_preserve_order_and_commit_only_after_move() {
        let mut order: Vec<_> = ["mask", "course", "main"]
            .into_iter()
            .map(|label| Entry {
                label: label.into(),
                layer: 0,
            })
            .collect();
        let labels = |order: &[Entry]| order.iter().map(|e| e.label.clone()).collect::<Vec<_>>();
        update_order(&mut order, "main", 2, |anchor| async move {
            assert_eq!(anchor, None);
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(labels(&order), ["main", "mask", "course"]);
        update_order(&mut order, "mask", -1, |anchor| async move {
            assert_eq!(anchor.as_deref(), Some("course"));
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(labels(&order), ["main", "course", "mask"]);
        update_order(&mut order, "mask", 0, |anchor| async move {
            assert_eq!(anchor.as_deref(), Some("main"));
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(labels(&order), ["main", "mask", "course"]);
        update_order(&mut order, "course", 0, |anchor| async move {
            assert_eq!(anchor.as_deref(), Some("main"));
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(labels(&order), ["main", "course", "mask"]);
        update_order(&mut order, "main", 3, |_| async {
            panic!("unchanged order must not move")
        })
        .await
        .unwrap();
        let before = order.clone();
        assert!(
            update_order(&mut order, "mask", 4, |_| async {
                Err(anyhow!("native failure"))
            })
            .await
            .is_err()
        );
        assert_eq!(order, before);
    }
}
