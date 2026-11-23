mod contract;
pub(crate) use super::local::{DrainTimeout, LocalDrained};
use super::{
    Observer, ReadFailure, Readout, SessionState, parse_readout, read_snapshot, wait_for_callback,
};
pub use contract::Generation;
pub(crate) use contract::Options;
use contract::{Ack, Delivery, Envelope, Identity, Poll, bridge_script, parse_poll};
use parking_lot::Mutex;
use serde::Deserialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Webview;
use tokio::sync::{Notify, oneshot};

static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

pub struct RequestState {
    pub(super) observer: Arc<Observer>,
    nonce: String,
    counter: AtomicU64,
    target: Mutex<Option<Webview>>,
    local_changed: Notify,
}

/// 一份文本求解固定首次观测的宿主文档与 JS 绑定，不跨会话继续后续批次。
#[derive(Default)]
pub(crate) struct TextBinding(Mutex<Option<(u64, u64)>>);
impl Default for RequestState {
    fn default() -> Self {
        let startup = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after UNIX epoch")
            .as_nanos();
        Self {
            observer: Arc::new(Observer::default()),
            nonce: format!(
                "{}-{startup:x}-{}",
                std::process::id(),
                NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed)
            ),
            counter: AtomicU64::new(1),
            target: Mutex::new(None),
            local_changed: Notify::new(),
        }
    }
}

pub(super) struct InFlight {
    request_id: String,
    stop: Option<oneshot::Sender<()>>,
    dispatched: bool,
}

// observer 与请求共用文档门。没有配置锁跨 await；取消 future 也保守保留未知远端隔离。
struct Flight<'a> {
    state: &'a RequestState,
    epoch: u64,
    request_id: String,
    identity: Option<Identity>,
    finished: bool,
}
impl Flight<'_> {
    fn mark_dispatched(&mut self) -> Result<(), &'static str> {
        let mut page = self.state.observer.0.lock();
        if page.closed || page.generation != self.epoch {
            return Err("DOCUMENT_INTERRUPTED");
        }
        page.request.as_mut().expect("claimed request").dispatched = true;
        Ok(())
    }
    fn was_dispatched(&self) -> bool {
        self.state
            .observer
            .0
            .lock()
            .request
            .as_ref()
            .is_some_and(|active| active.request_id == self.request_id && active.dispatched)
    }
    fn finish(&mut self, quarantine: bool) -> Result<(), &'static str> {
        let mut page = self.state.observer.0.lock();
        let current = !page.closed && page.generation == self.epoch;
        let matches = page
            .request
            .as_ref()
            .is_some_and(|active| active.request_id == self.request_id);
        if !matches {
            return Err("REQUEST_INTERRUPTED");
        }
        let active = page.request.take().expect("matched request");
        page.quarantined |= quarantine || (!current && active.dispatched);
        self.finished = true;
        if current {
            Ok(())
        } else {
            Err("DOCUMENT_INTERRUPTED")
        }
    }
}
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.finish(self.was_dispatched());
        }
        self.state.observer.0.lock().local.generating -= 1;
        self.state.local_changed.notify_waiters();
    }
}

pub(super) fn interrupt(page: &mut super::Page) {
    if let Some(request) = &mut page.request {
        page.quarantined |= request.dispatched;
        if let Some(stop) = request.stop.take() {
            let _ = stop.send(());
        }
    }
}

impl RequestState {
    pub(super) fn attach(&self, webview: Webview) -> bool {
        // 与 Destroyed 同一文档门，避免关闭后迟到的 load 保留句柄。
        let page = self.observer.0.lock();
        if !page.closed {
            *self.target.lock() = Some(webview);
            true
        } else {
            false
        }
    }

    pub(super) fn detach(&self) {
        self.close_local();
    }

    pub(crate) fn close_local(&self) {
        self.observer.close();
        self.target.lock().take();
    }

    /// Polled by Attempt's single shared termination task; its callers share the result.
    /// A timed-out/cancelled drain leaves pending handles here for a later retry.
    pub(crate) async fn drain_local(&self, timeout: Duration) -> anyhow::Result<LocalDrained> {
        anyhow::ensure!(
            self.observer.0.lock().closed,
            "DeepSeek 本地终结前必须关闭请求准入"
        );
        let drain = async {
            loop {
                let changed = self.local_changed.notified();
                tokio::pin!(changed);
                // Register before inspecting the count; completion between inspection
                // and waiting must not lose the last Flight's notification.
                changed.as_mut().enable();
                let outcome = std::future::poll_fn(|cx| {
                    use std::{future::Future, task::Poll};
                    let changed = changed.as_mut().poll(cx).is_ready();
                    let mut page = self.observer.0.lock();
                    if let Some(result) = page.local.poll_drained(cx) {
                        Poll::Ready(Some(result))
                    } else if changed {
                        Poll::Ready(None)
                    } else {
                        Poll::Pending
                    }
                })
                .await;
                if let Some(result) = outcome {
                    return result;
                }
            }
        };
        match tokio::time::timeout(timeout, drain).await {
            Ok(result) => result,
            Err(_) => {
                let page = self.observer.0.lock();
                Err(DrainTimeout {
                    generating: page.local.generating,
                    observers: page.local.observers.len(),
                }
                .into())
            }
        }
    }

    pub(crate) async fn generate_text(
        &self,
        text: &str,
        options: Options,
        binding: &TextBinding,
    ) -> Result<Generation, &'static str> {
        if self.target.lock().is_none() {
            return Err(if self.observer.0.lock().quarantined {
                "QUARANTINED"
            } else {
                "WEBVIEW_NOT_OPEN"
            });
        }
        let timeout = options.timeout_ms.unwrap_or(120_000);
        if text.trim().is_empty() || !(1_000..=600_000).contains(&timeout) {
            return Err("INVALID_REQUEST");
        }
        let (mut flight, mut cancelled) = self.claim()?;
        // This inner future borrows Flight. Its target clone is therefore dropped
        // before Flight confirms completion, on both return and cancellation.
        async {
            let webview = self.target.lock().clone().ok_or("DOCUMENT_INTERRUPTED")?;
            self.generate_bound(
                &webview,
                text,
                options,
                binding,
                &mut flight,
                &mut cancelled,
            )
            .await
        }
        .await
    }

    pub(super) fn document_token(&self, epoch: u64) -> String {
        format!("{}:document:{epoch}", self.nonce)
    }
    fn claim(&self) -> Result<(Flight<'_>, oneshot::Receiver<()>), &'static str> {
        let mut page = self.observer.0.lock();
        if page.quarantined {
            return Err("QUARANTINED");
        }
        if page.request.is_some() {
            return Err("BUSY");
        }
        if page.closed || !page.loaded {
            return Err("DOCUMENT_NOT_READY");
        }
        let request_id = format!(
            "{}:request:{}",
            self.nonce,
            self.counter.fetch_add(1, Ordering::Relaxed)
        );
        let (stop, cancelled) = oneshot::channel();
        page.request = Some(InFlight {
            request_id: request_id.clone(),
            stop: Some(stop),
            dispatched: false,
        });
        page.local.generating += 1;
        Ok((
            Flight {
                state: self,
                epoch: page.generation,
                request_id,
                identity: None,
                finished: false,
            },
            cancelled,
        ))
    }

    async fn generate_bound(
        &self,
        webview: &Webview,
        text: &str,
        options: Options,
        binding: &TextBinding,
        flight: &mut Flight<'_>,
        cancelled: &mut oneshot::Receiver<()>,
    ) -> Result<Generation, &'static str> {
        let timeout = options.timeout_ms.unwrap_or(120_000);
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(u64::from(timeout) + 5_000);
        let result = self
            .run(
                webview, flight, cancelled, text, &options, binding, deadline,
            )
            .await;
        let result = match result {
            Ok(result) => {
                if flight.finish(result.needs_quarantine()).is_ok() {
                    result
                } else {
                    self.interrupted(flight, "DOCUMENT_INTERRUPTED")
                }
            }
            Err(code) if flight.was_dispatched() => {
                if let Some(identity) = &flight.identity {
                    if let Ok(script) = bridge_script("cancel", identity) {
                        self.observer.while_current(flight.epoch, || {
                            if webview.eval(&script).is_err() {
                                log::warn!("DeepSeek B2 cancel EVAL_DISPATCH_FAILED");
                            }
                        });
                    }
                }
                let _ = flight.finish(true);
                self.interrupted(flight, code)
            }
            Err(code) => {
                let _ = flight.finish(false);
                return Err(code);
            }
        };
        let bytes = if let Generation::Completed { content, .. } = &result {
            content.len()
        } else {
            0
        };
        log::debug!(
            "DeepSeek B2 request={} status={} bytes={bytes}",
            result.request_id(),
            result.status()
        );
        Ok(result)
    }

    fn interrupted(&self, flight: &Flight<'_>, code: &'static str) -> Generation {
        Generation::Interrupted {
            request_id: flight.request_id.clone(),
            code: code.into(),
            delivery: Delivery::Unknown,
            remote: "unknown".into(),
            quarantined: true,
        }
    }

    async fn run(
        &self,
        webview: &Webview,
        flight: &mut Flight<'_>,
        cancelled: &mut oneshot::Receiver<()>,
        text: &str,
        options: &Options,
        binding: &TextBinding,
        deadline: tokio::time::Instant,
    ) -> Result<Generation, &'static str> {
        let raw = read_snapshot(webview, cancelled)
            .await
            .map_err(transport_code)?;
        let Readout::Snapshot { snapshot } = parse_readout(&raw)? else {
            return Err("BINDING_NOT_READY");
        };
        if snapshot.session_state != SessionState::Valid {
            return Err("BINDING_NOT_READY");
        }
        let current = (flight.epoch, snapshot.generation);
        {
            let mut expected = binding.0.lock();
            if expected.is_some_and(|expected| expected != current) {
                return Err("SOLVE_BINDING_CHANGED");
            }
            *expected = Some(current);
        }
        let identity = Identity {
            document_token: self.document_token(flight.epoch),
            binding_generation: snapshot.generation,
            request_id: flight.request_id.clone(),
        };
        flight.identity = Some(identity.clone());
        let script = bridge_script(
            "start",
            &Envelope {
                identity: &identity,
                text,
                options,
            },
        )?;
        flight.mark_dispatched()?;
        log::debug!(
            "DeepSeek B2 request={} stage=start_dispatched document={} binding_generation={}",
            identity.request_id,
            flight.epoch,
            identity.binding_generation
        );
        let raw = self.eval(webview, flight.epoch, &script, cancelled).await?;
        match serde_json::from_str::<Ack>(&raw).map_err(|_| "INVALID_ACK")? {
            Ack::Accepted { identity: accepted } if accepted == identity => {}
            Ack::Rejected { code } => {
                if code == "QUARANTINED" {
                    self.observer.0.lock().quarantined = true;
                }
                // 只有 bootstrap 的同步拒绝能够证明本次 generate 没有被调用。
                if matches!(
                    code.as_str(),
                    "QUARANTINED"
                        | "BUSY"
                        | "DOCUMENT_MISMATCH"
                        | "BINDING_NOT_READY"
                        | "SESSION_READ_FAILED"
                        | "SESSION_MISMATCH"
                ) {
                    self.observer
                        .0
                        .lock()
                        .request
                        .as_mut()
                        .expect("claimed request")
                        .dispatched = false;
                    return Err(match code.as_str() {
                        "QUARANTINED" => "QUARANTINED",
                        "BUSY" => "BUSY",
                        _ => "START_REJECTED",
                    });
                }
                return Err("INVALID_ACK");
            }
            _ => return Err("IDENTITY_MISMATCH"),
        }
        let script = bridge_script("read", &identity)?;
        let mut terminal = None;
        while terminal.is_none() && tokio::time::Instant::now() < deadline {
            let raw = self.eval(webview, flight.epoch, &script, cancelled).await?;
            match parse_poll(&raw, &identity)? {
                Poll::Pending { .. } => {
                    tokio::select! { biased; _ = &mut *cancelled => return Err("DOCUMENT_INTERRUPTED"), _ = tokio::time::sleep_until((tokio::time::Instant::now() + Duration::from_millis(250)).min(deadline)) => {} }
                }
                Poll::Terminal { result, .. } => terminal = Some(result),
                Poll::Interrupted { code, .. } => {
                    return Err(match code.as_str() {
                        "BINDING_CHANGED" => "BINDING_CHANGED",
                        "DOCUMENT_DESTROYED" => "DOCUMENT_INTERRUPTED",
                        _ => "REQUEST_INTERRUPTED",
                    });
                }
                Poll::Rejected { code } => {
                    return Err(if code == "IDENTITY_MISMATCH" {
                        "IDENTITY_MISMATCH"
                    } else {
                        "SLOT_LOST"
                    });
                }
            }
        }
        let result = terminal.ok_or("HOST_TIMEOUT")?;
        let script = bridge_script("ack", &identity)?;
        let raw = self.eval(webview, flight.epoch, &script, cancelled).await?;
        #[derive(Deserialize)]
        struct Confirmation {
            kind: String,
            confirmed: bool,
        }
        let confirmation: Confirmation = serde_json::from_str(&raw).map_err(|_| "INVALID_ACK")?;
        if confirmation.kind != "confirmed" || !confirmation.confirmed {
            return Err("ACK_REJECTED");
        }
        Ok(result)
    }

    async fn eval(
        &self,
        webview: &Webview,
        epoch: u64,
        script: &str,
        cancelled: &mut oneshot::Receiver<()>,
    ) -> Result<String, &'static str> {
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let mut dispatched = Ok(());
        if !self.observer.while_current(epoch, || {
            dispatched = webview.eval_with_callback(script, move |raw| {
                if let Some(sender) = sender.lock().take() {
                    let _ = sender.send(raw);
                }
            });
        }) {
            return Err("DOCUMENT_INTERRUPTED");
        }
        dispatched.map_err(|_| "EVAL_DISPATCH_FAILED")?;
        wait_for_callback(receiver, cancelled, Duration::from_secs(2))
            .await
            .map_err(transport_code)
    }
}

fn transport_code(error: ReadFailure) -> &'static str {
    match error {
        ReadFailure::Cancelled => "DOCUMENT_INTERRUPTED",
        ReadFailure::Timeout => "READ_TIMEOUT",
        ReadFailure::CallbackDropped => "CALLBACK_DROPPED",
        ReadFailure::EvalDispatchFailed => "EVAL_DISPATCH_FAILED",
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/deepseek/request.rs"]
mod tests;
