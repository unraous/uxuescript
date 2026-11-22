mod creation;
pub(crate) mod request;

use crate::core::script::include_script;
use parking_lot::Mutex;
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{Manager, Url, Webview, WebviewBuilder, Window, WindowEvent, Wry};
use tokio::sync::oneshot;

pub(super) fn is_target_url(url: &Url) -> bool {
    url.origin().ascii_serialization() == "https://chat.deepseek.com"
}

fn adapter_initialization_script() -> String {
    // Windows 也会进入子 frame；条件块保留外部 IIFE 顶层 var 的文档全局作用域。
    format!(
        "if (window.top === window && window.location.origin === 'https://chat.deepseek.com') {{\n{}\n}}",
        crate::core::script::DEEPSEEK_ADAPTER_SCRIPT
    )
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Readout {
    Snapshot { snapshot: Snapshot },
    TargetSkipped,
    BootstrapMissing,
    ReadFailed,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    schema_version: u32,
    generation: u64,
    api_available: bool,
    adapter_version: Option<String>,
    phase: Phase,
    initialization: Initialization,
    attempts: u32,
    path_bindable: bool,
    session_present: bool,
    session_state: SessionState,
    error_code: Option<Code>,
    page_not_ready_timed_out: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Phase {
    WaitingPath,
    Initializing,
    WaitingPage,
    Ready,
    Invalidated,
    Disposing,
    Failed,
    Destroyed,
}
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Initialization {
    NotStarted,
    Pending,
    Fulfilled,
    Rejected,
}
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SessionState {
    None,
    Valid,
    Invalid,
    Unbound,
}
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Code {
    InstanceExists,
    NotInitialized,
    Disposed,
    PageNotReady,
    NotAuthenticated,
    SessionMismatch,
    Busy,
    ComposerNotEmpty,
    InternalError,
    ApiMissing,
    SessionMissing,
    UnexpectedError,
}

fn parse_readout(raw: &str) -> Result<Readout, &'static str> {
    // Serde 错误可能带输入值；诊断只报告固定错误码，不回显页面内容。
    let readout: Readout = serde_json::from_str(raw).map_err(|_| "INVALID_JSON")?;
    if let Readout::Snapshot { snapshot } = &readout {
        if snapshot.schema_version != 1 {
            return Err("UNSUPPORTED_SCHEMA");
        }
        if snapshot.session_state == SessionState::Valid
            && !(snapshot.api_available
                && snapshot.phase == Phase::Ready
                && snapshot.initialization == Initialization::Fulfilled
                && snapshot.path_bindable
                && snapshot.session_present)
        {
            return Err("INCONSISTENT_SNAPSHOT");
        }
    }
    Ok(readout)
}

impl Readout {
    fn is_warning(&self) -> bool {
        match self {
            Self::Snapshot { snapshot } => snapshot.phase == Phase::Failed,
            Self::TargetSkipped => false,
            Self::BootstrapMissing | Self::ReadFailed => true,
        }
    }

    fn summary(&self) -> String {
        match self {
            Self::Snapshot { snapshot } => format!(
                "binding_generation={} api={} adapter_v0_1_0={} phase={:?} initialization={:?} attempts={} bindable={} session_present={} session={:?} error={:?} page_wait_timeout={}",
                snapshot.generation,
                snapshot.api_available,
                snapshot.adapter_version.as_deref() == Some("0.1.0"),
                snapshot.phase,
                snapshot.initialization,
                snapshot.attempts,
                snapshot.path_bindable,
                snapshot.session_present,
                snapshot.session_state,
                snapshot.error_code,
                snapshot.page_not_ready_timed_out,
            ),
            Self::TargetSkipped => "target_skipped".into(),
            Self::BootstrapMissing => "bootstrap_missing".into(),
            Self::ReadFailed => "snapshot_read_failed".into(),
        }
    }
}

#[derive(Default)]
struct Observer(Mutex<Page>);
#[derive(Default)]
struct Page {
    generation: u64,
    closed: bool,
    stop: Option<oneshot::Sender<()>>,
    loaded: bool,
    request: Option<request::InFlight>,
    quarantined: bool,
}

fn invalidate(page: &mut Page) {
    page.generation += 1;
    page.loaded = false;
    request::interrupt(page);
    if let Some(stop) = page.stop.take() {
        let _ = stop.send(());
    }
}

impl Observer {
    fn begin(&self) -> Option<(u64, oneshot::Receiver<()>)> {
        let mut page = self.0.lock();
        if page.closed {
            return None;
        }
        invalidate(&mut page);
        page.loaded = true;
        let (stop, cancelled) = oneshot::channel();
        page.stop = Some(stop);
        Some((page.generation, cancelled))
    }

    fn cancel(&self) {
        invalidate(&mut self.0.lock());
    }

    fn close(&self) {
        let mut page = self.0.lock();
        page.closed = true;
        invalidate(&mut page);
    }

    fn while_current(&self, epoch: u64, publish: impl FnOnce()) -> bool {
        let page = self.0.lock();
        if page.closed || epoch != page.generation {
            return false;
        }
        // 发布与导航失效共用同一把锁，避免检查后才发生导航的迟到日志。
        publish();
        true
    }

    fn is_current(&self, epoch: u64) -> bool {
        let page = self.0.lock();
        !page.closed && epoch == page.generation
    }
}

#[derive(Debug, PartialEq)]
enum ReadFailure {
    Cancelled,
    Timeout,
    CallbackDropped,
    EvalDispatchFailed,
}
async fn wait_for_callback(
    receiver: oneshot::Receiver<String>,
    cancelled: &mut oneshot::Receiver<()>,
    deadline: Duration,
) -> Result<String, ReadFailure> {
    tokio::select! {
        biased;
        _ = cancelled => Err(ReadFailure::Cancelled),
        result = tokio::time::timeout(deadline, receiver) => match result {
            Ok(Ok(raw)) => Ok(raw),
            Ok(Err(_)) => Err(ReadFailure::CallbackDropped),
            Err(_) => Err(ReadFailure::Timeout),
        }
    }
}

// eval_with_callback 只读取同步对象；Windows 的脚本异常需在 JS 内转换为明确诊断。
const SNAPSHOT_SCRIPT: &str = r#"(() => {
  try {
    if (window.top !== window || window.location.origin !== 'https://chat.deepseek.com')
      return { kind: 'target_skipped' };
    const controller = globalThis.__UXS_DEEPSEEK_B1__;
    if (!controller) return { kind: 'bootstrap_missing' };
    return { kind: 'snapshot', snapshot: controller.snapshot() };
  } catch {
    return { kind: 'read_failed' };
  }
})()"#;

async fn read_snapshot(
    webview: &Webview,
    cancelled: &mut oneshot::Receiver<()>,
) -> Result<String, ReadFailure> {
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(SNAPSHOT_SCRIPT, move |raw| {
            // Tauri 回调为 Fn；只交付一次，不在回调里解析或发布状态。
            if let Some(sender) = sender.lock().take() {
                let _ = sender.send(raw);
            }
        })
        .map_err(|_| ReadFailure::EvalDispatchFailed)?;
    wait_for_callback(receiver, cancelled, Duration::from_secs(2)).await
}

async fn observe(
    webview: Webview,
    observer: Arc<Observer>,
    epoch: u64,
    mut cancelled: oneshot::Receiver<()>,
) {
    let mut previous = None;
    while observer.is_current(epoch) {
        let result = read_snapshot(&webview, &mut cancelled).await;
        if result == Err(ReadFailure::Cancelled) {
            return;
        }
        if !observer.while_current(epoch, || {
            let next = match result {
                Ok(raw) => parse_readout(&raw),
                Err(ReadFailure::Timeout) => Err("READ_TIMEOUT"),
                Err(ReadFailure::CallbackDropped) => Err("CALLBACK_DROPPED"),
                Err(ReadFailure::EvalDispatchFailed) => Err("EVAL_DISPATCH_FAILED"),
                Err(ReadFailure::Cancelled) => unreachable!(),
            };
            if previous.as_ref() != Some(&next) {
                let warning = next.as_ref().map_or(true, Readout::is_warning);
                let summary = match &next {
                    Ok(readout) => readout.summary(),
                    Err(code) => (*code).into(),
                };
                if warning {
                    log::warn!("DeepSeek B1 document={epoch} {summary}");
                } else {
                    log::debug!("DeepSeek B1 document={epoch} {summary}");
                }
                previous = Some(next);
            }
        }) {
            return;
        }
        tokio::select! {
            biased;
            _ = &mut cancelled => return,
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    }
}

fn load_on(
    webview: Webview,
    payload: PageLoadPayload<'_>,
    requests: &request::RequestState,
) -> bool {
    let observer = &requests.observer;
    if payload.event() == PageLoadEvent::Started {
        observer.cancel();
        return false;
    }
    if !is_target_url(payload.url()) {
        observer.cancel();
        return false;
    }
    let Some((epoch, cancelled)) = observer.begin() else {
        return false;
    };
    let token =
        serde_json::to_string(&requests.document_token(epoch)).expect("document token JSON");
    let bootstrap = format!(
        "{}\n;(() => {{ const controller = globalThis.__UXS_DEEPSEEK_B1__; if (controller && !controller.bindDocument({token})) console.warn('[uXS DeepSeek B2] document DOCUMENT_BIND_REJECTED'); }})();",
        include_script!("deepseek-web-bootstrap.js")
    );
    let attached = if webview.eval(&bootstrap).is_err() {
        log::warn!("DeepSeek B1 document={epoch} BOOTSTRAP_EVAL_DISPATCH_FAILED");
        false
    } else {
        requests.attach(webview.clone());
        true
    };
    tauri::async_runtime::spawn(observe(webview, observer.clone(), epoch, cancelled));
    attached
}

fn navigation_handler(
    observer: Arc<Observer>,
    allow_navigation: fn(&Url) -> bool,
) -> impl Fn(&Url) -> bool + Send + 'static {
    move |url| {
        let allowed = allow_navigation(url);
        if allowed {
            // Windows NavigationStarting 早于 ContentLoading；网络等待期间也不能发布旧页结果。
            observer.cancel();
        }
        allowed
    }
}

pub(super) fn configure(
    window: &Window,
    builder: WebviewBuilder<Wry>,
    allow_navigation: fn(&Url) -> bool,
) -> anyhow::Result<WebviewBuilder<Wry>> {
    let observer = window.state::<request::RequestState>().observer.clone();
    let attempt = window.state::<request::RequestState>().creation.begin()?;
    let app = window.app_handle().clone();
    let closing = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            closing.state::<request::RequestState>().detach();
        }
    });
    let navigation = navigation_handler(observer.clone(), allow_navigation);
    let navigation_attempt = attempt.clone();
    Ok(builder
        .initialization_script(adapter_initialization_script())
        .on_navigation(move |url| navigation_attempt.navigate(|| navigation(url)))
        .on_page_load(move |webview, payload| {
            attempt.loaded(|| load_on(webview, payload, &app.state::<request::RequestState>()));
        }))
}

#[cfg(test)]
#[path = "../../../tests/unit/app/webview/deepseek.rs"]
mod tests;
