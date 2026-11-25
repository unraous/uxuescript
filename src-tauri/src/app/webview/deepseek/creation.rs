//! One reservation owns callbacks, request activity and the local close result.
use super::request::{DrainTimeout, LocalDrained, RequestState};
use anyhow::{Context, Result, anyhow, ensure};
use parking_lot::Mutex;
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;

#[derive(Default)]
pub(crate) struct Creations {
    current: Mutex<Current>,
    pub(crate) operation: Arc<tokio::sync::Mutex<()>>,
    stopped: tokio::sync::Notify,
}

#[derive(Default)]
struct Current {
    attempt: Option<Arc<Attempt>>,
    owner: OwnerState,
}

#[derive(Default, Debug, PartialEq, Eq)]
enum OwnerState {
    #[default]
    Open,
    Ended,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Creating,
    Ready,
    Closing,
    Failed(Failure),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Failure {
    // close() only dispatched teardown; local cleanup is safe, replacement is not.
    RetirementUnconfirmed,
    BoundRollback,
    CreationUnconfirmed,
    IdentityMismatch,
    LocalDrainTimeout,
    LocalDrainFailed,
}

impl Failure {
    fn cleanup_allowed(&self) -> bool {
        matches!(self, Self::RetirementUnconfirmed | Self::LocalDrainTimeout)
    }
}

// Resource evidence is separate from service phase. Before add_child is called,
// a failed configuration owns no native child and its slot can safely be released.
#[derive(Default, PartialEq, Eq)]
enum NativeResource {
    #[default]
    None,
    Unconfirmed,
    Created,
}

type CloseResult = Option<std::result::Result<LocalDrained, String>>;
struct Status {
    phase: Phase,
    bound: bool,
    native: NativeResource,
    closing: Option<watch::Receiver<CloseResult>>,
}

pub(crate) struct Attempt {
    status: Mutex<Status>,
    // Arc identity is the creation identity; no label lookup can replace it.
    requests: Arc<RequestState>,
}

impl Creations {
    pub(crate) fn check(&self) -> Result<()> {
        let current = self.current.lock();
        ensure!(
            current.owner == OwnerState::Open,
            "DeepSeek 父窗口已销毁，不能创建或使用实例"
        );
        if let Some(attempt) = &current.attempt {
            attempt.check_active()?;
        }
        Ok(())
    }

    pub(crate) fn current(&self) -> Result<Option<Arc<Attempt>>> {
        let current = self.current.lock();
        ensure!(
            current.owner == OwnerState::Open,
            "DeepSeek 父窗口已销毁，不能创建或使用实例"
        );
        if let Some(attempt) = &current.attempt {
            attempt.check_active()?;
        }
        Ok(current.attempt.clone())
    }

    // Cleanup must be able to obtain a Closing/Failed attempt without reopening
    // service admission. The slot remains the only source of instance identity.
    pub(crate) fn owned(&self) -> Result<Option<Arc<Attempt>>> {
        let current = self.current.lock();
        ensure!(current.owner == OwnerState::Open, "DeepSeek 父窗口已销毁");
        Ok(current.attempt.clone())
    }

    pub(crate) fn destroyed(&self) {
        let mut current = self.current.lock();
        if current.owner == OwnerState::Ended {
            return;
        }
        current.owner = OwnerState::Ended;
        if let Some(attempt) = &current.attempt {
            let mut status = attempt.status.lock();
            // A previous local timeout retained live handles. Host destruction
            // gets one final drain attempt; repeated Destroyed stays idempotent.
            if status.phase == Phase::Failed(Failure::LocalDrainTimeout) {
                status.closing = None;
            }
            attempt.start_close(&mut status, self.operation.clone());
        }
        self.stopped.notify_waiters();
    }

    fn validate_current(current: &Current, attempt: &Arc<Attempt>) -> Result<()> {
        ensure!(current.owner == OwnerState::Open, "DeepSeek 父窗口已销毁");
        ensure!(
            current
                .attempt
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, attempt)),
            "DeepSeek 创建身份已失效"
        );
        Ok(())
    }

    pub(crate) fn publish_ready(&self, attempt: &Arc<Attempt>) -> Result<Arc<RequestState>> {
        let current = self.current.lock();
        Self::validate_current(&current, attempt)?;
        let mut status = attempt.status.lock();
        match status.phase {
            Phase::Creating | Phase::Ready => status.phase = Phase::Ready,
            _ => anyhow::bail!("DeepSeek 实例已失效，不能发布 Ready"),
        }
        Ok(attempt.requests.clone())
    }

    pub(crate) fn begin(&self) -> Result<Arc<Attempt>> {
        let mut current = self.current.lock();
        ensure!(
            current.owner == OwnerState::Open,
            "DeepSeek 父窗口已销毁，不能预约新实例"
        );
        ensure!(
            current.attempt.is_none(),
            "DeepSeek 已有创建记录，不能重建；请重启应用"
        );
        let attempt = Arc::new(Attempt {
            status: Mutex::new(Status {
                phase: Phase::Creating,
                bound: false,
                native: NativeResource::None,
                closing: None,
            }),
            requests: Arc::new(RequestState::default()),
        });
        current.attempt = Some(attempt.clone());
        Ok(attempt)
    }

    pub(crate) fn creation_failed(&self, attempt: &Arc<Attempt>) {
        self.stopped.notify_waiters();
        let mut current = self.current.lock();
        if Self::validate_current(&current, attempt).is_err() {
            return;
        }
        let mut status = attempt.status.lock();
        if status.phase != Phase::Creating {
            return;
        }
        match status.native {
            NativeResource::None => {
                attempt.requests.close_local();
                // No child was submitted to the native runtime. Close late callbacks
                // on this old Arc before releasing the only slot.
                status.phase = Phase::Closing;
                current.attempt = None;
            }
            NativeResource::Unconfirmed => {
                attempt.requests.close_local();
                status.phase = Phase::Failed(Failure::CreationUnconfirmed);
            }
            // A failed unbound rollback retains the same child and can retry placement.
            NativeResource::Created => {}
        }
    }

    pub(crate) fn identity_failed(&self, attempt: &Arc<Attempt>) {
        let current = self.current.lock();
        if Self::validate_current(&current, attempt).is_ok() {
            let mut status = attempt.status.lock();
            if matches!(status.phase, Phase::Creating | Phase::Ready) {
                attempt.requests.close_local();
                status.phase = Phase::Failed(Failure::IdentityMismatch);
            }
        }
    }

    pub(crate) fn begin_close(&self, attempt: &Arc<Attempt>) -> Result<()> {
        let current = self.current.lock();
        Self::validate_current(&current, attempt)?;
        let mut status = attempt.status.lock();
        ensure!(
            status.phase != Phase::Creating,
            "DeepSeek 实例正在创建，不能开始独立关闭"
        );
        ensure!(
            !matches!(status.phase, Phase::Failed(_)),
            "DeepSeek 失败实例须按清理能力执行 retry_cleanup"
        );
        attempt.start_close(&mut status, self.operation.clone());
        self.stopped.notify_waiters();
        Ok(())
    }

    pub(crate) fn retry_cleanup(&self, attempt: &Arc<Attempt>) -> Result<()> {
        let current = self.current.lock();
        Self::validate_current(&current, attempt)?;
        let mut status = attempt.status.lock();
        ensure!(
            matches!(&status.phase, Phase::Failed(failure) if failure.cleanup_allowed()),
            "DeepSeek 此失败只能随父窗口终结处理；请重启应用"
        );
        status.closing = None;
        attempt.start_close(&mut status, self.operation.clone());
        self.stopped.notify_waiters();
        Ok(())
    }

    pub(crate) fn stopped(&self) -> tokio::sync::futures::Notified<'_> {
        self.stopped.notified()
    }
}

impl Attempt {
    #[allow(dead_code)]
    pub(crate) fn phase(&self) -> Phase {
        self.status.lock().phase.clone()
    }

    pub(crate) fn check_active(&self) -> Result<()> {
        match &self.status.lock().phase {
            Phase::Creating | Phase::Ready => Ok(()),
            Phase::Closing => Err(anyhow!("DeepSeek 实例正在关闭，不能创建或使用实例")),
            Phase::Failed(failure) => Err(anyhow!(
                "DeepSeek 实例失败 ({failure:?})，不能恢复服务；请重启应用"
            )),
        }
    }

    pub(crate) fn requests_if_ready(&self) -> Result<Arc<RequestState>> {
        ensure!(
            self.status.lock().phase == Phase::Ready,
            "DeepSeek 原生实例尚未完成归位或已失效"
        );
        Ok(self.requests.clone())
    }

    pub(crate) fn native_creation_started(&self) -> Result<()> {
        let mut status = self.status.lock();
        ensure!(status.phase == Phase::Creating, "DeepSeek 创建已取消");
        status.native = NativeResource::Unconfirmed;
        Ok(())
    }

    pub(crate) fn native_created(&self) {
        self.status.lock().native = NativeResource::Created;
    }

    pub(crate) fn rollback(&self, close: impl FnOnce() -> Result<()>) -> Result<()> {
        let mut status = self.status.lock();
        // OwnerEnded / begin_close has already closed the gate. Never ask a dead
        // parent to close a child, or let a late rollback reverse Closing.
        if !matches!(status.phase, Phase::Creating | Phase::Ready) {
            return Ok(());
        }
        let result = close();
        if status.bound {
            self.requests.close_local();
            status.phase = Phase::Failed(Failure::BoundRollback);
            log::error!("DeepSeek 绑定后初始化回滚，无法恢复服务；请重启应用");
        } else if result.is_ok() {
            self.requests.close_local();
            status.phase = Phase::Failed(Failure::RetirementUnconfirmed);
        } else {
            status.phase = Phase::Creating;
        }
        result
    }

    // Current -> Attempt -> Observer Page -> target. Close the shared request
    // gate before publishing Closing; an earlier RequestState clone cannot claim.
    fn start_close(self: &Arc<Self>, status: &mut Status, operation: Arc<tokio::sync::Mutex<()>>) {
        if status.closing.is_some() {
            return;
        }
        self.requests.detach();
        status.phase = Phase::Closing;
        let (result, receiver) = watch::channel(None);
        status.closing = Some(receiver);
        let attempt = self.clone();
        tauri::async_runtime::spawn(async move {
            // Supervise the actual worker so panic/cancellation is a stored failure,
            // never an abandoned wait or a false LocalDrained certificate.
            let requests = attempt.requests.clone();
            let task = tokio::spawn(async move {
                let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                // Creation may still be placing a child. Wait for that existing
                // operation to leave, then release the gate before local drain.
                let creation = tokio::time::timeout_at(deadline, operation.lock())
                    .await
                    .map_err(|_| anyhow!("DeepSeek 等待创建任务终结超时"))?;
                drop(creation);
                requests
                    .drain_local(deadline.saturating_duration_since(tokio::time::Instant::now()))
                    .await
            });
            let (outcome, failure) = match task.await {
                Ok(Ok(drained)) => (Ok(drained), None),
                Ok(Err(error)) => {
                    let failure = if error.downcast_ref::<DrainTimeout>().is_some() {
                        Failure::LocalDrainTimeout
                    } else {
                        Failure::LocalDrainFailed
                    };
                    (Err(format!("{error:#}")), Some(failure))
                }
                Err(error) => (
                    Err(format!("DeepSeek 本地终结任务异常退出: {error}")),
                    Some(Failure::LocalDrainFailed),
                ),
            };
            if let Some(failure) = failure {
                attempt.status.lock().phase = Phase::Failed(failure);
            }
            if let Err(error) = &outcome {
                log::error!("DeepSeek 本地终结失败，保留实例所有权: {error}");
            }
            result.send_replace(Some(outcome));
        });
    }

    // B3-B awaits this shared certificate before its native retirement stage.
    #[allow(dead_code)]
    pub(crate) async fn drain_local(&self) -> Result<LocalDrained> {
        let mut result = self
            .status
            .lock()
            .closing
            .clone()
            .ok_or_else(|| anyhow!("DeepSeek 尚未开始本地终结"))?;
        loop {
            if let Some(outcome) = result.borrow_and_update().clone() {
                return outcome.map_err(anyhow::Error::msg);
            }
            result
                .changed()
                .await
                .context("DeepSeek 本地终结结果未交付")?;
        }
    }

    pub(super) fn loaded(&self, load: impl FnOnce(&Arc<RequestState>) -> bool) {
        let mut status = self.status.lock();
        if matches!(status.phase, Phase::Creating | Phase::Ready) {
            status.bound |= load(&self.requests);
        }
    }

    pub(super) fn navigate(&self, navigate: impl FnOnce() -> bool) -> bool {
        let status = self.status.lock();
        matches!(status.phase, Phase::Creating | Phase::Ready) && navigate()
    }

    pub(super) fn observer(&self) -> Arc<super::Observer> {
        self.requests.observer.clone()
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/deepseek/creation.rs"]
mod tests;
