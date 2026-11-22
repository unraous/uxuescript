//! Single reservation slot: an attempt owns the request Arc used by its callbacks and callers.
use super::request::RequestState;
use anyhow::{Result, ensure};
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct Creations(Mutex<Current>);

#[derive(Default)]
struct Current {
    attempt: Option<Arc<Attempt>>,
    ended: bool,
}

#[derive(Default)]
struct Status {
    active: bool,
    ready: bool,
    bound: bool,
    poisoned: bool,
    ended: bool,
}

pub(crate) struct Attempt {
    status: Mutex<Status>,
    // Arc identity is the creation identity; no label lookup can replace it.
    requests: Arc<RequestState>,
}

impl Creations {
    pub(crate) fn check(&self) -> Result<()> {
        if let Some(attempt) = self.0.lock().attempt.as_ref() {
            attempt.check()?;
        }
        Ok(())
    }

    pub(crate) fn current(&self) -> Result<Option<Arc<Attempt>>> {
        let current = self.0.lock();
        ensure!(!current.ended, "DeepSeek 父窗口已销毁，不能创建或使用实例");
        if let Some(attempt) = current.attempt.as_ref() {
            attempt.check()?;
            if attempt.status.lock().active {
                return Ok(Some(attempt.clone()));
            }
        }
        Ok(None)
    }

    pub(crate) fn destroyed(&self) {
        let mut current = self.0.lock();
        current.ended = true;
        if let Some(attempt) = current.attempt.as_ref() {
            attempt.destroyed();
        }
    }

    pub(crate) fn publish_ready(&self, attempt: &Arc<Attempt>) -> Result<Arc<RequestState>> {
        // Publication and parent destruction share Current -> Attempt lock order.
        // Checking only Attempt leaves a gap after Current has already ended.
        let current = self.0.lock();
        ensure!(!current.ended, "DeepSeek 父窗口已销毁，不能发布 Ready");
        ensure!(
            current
                .attempt
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, attempt)),
            "DeepSeek 创建身份已失效，不能发布 Ready"
        );
        attempt.publish_ready()?;
        attempt.requests_if_ready()
    }

    pub(crate) fn begin(&self) -> Result<Arc<Attempt>> {
        let mut current = self.0.lock();
        ensure!(!current.ended, "DeepSeek 父窗口已销毁，不能预约新实例");
        if let Some(previous) = current.attempt.as_ref() {
            previous.check()?;
            ensure!(
                !previous.status.lock().active,
                "DeepSeek 已有创建记录，不能重建；请重启应用"
            );
        }
        let attempt = Arc::new(Attempt {
            status: Mutex::new(Status {
                active: true,
                ..Status::default()
            }),
            requests: Arc::new(RequestState::default()),
        });
        current.attempt = Some(attempt.clone());
        Ok(attempt)
    }
}

impl Attempt {
    fn check(&self) -> Result<()> {
        ensure!(
            !self.status.lock().poisoned,
            "DeepSeek 绑定后初始化回滚，无法安全重建；请重启应用"
        );
        Ok(())
    }

    pub(crate) fn check_active(&self) -> Result<()> {
        self.check()?;
        let status = self.status.lock();
        ensure!(
            status.active && !status.ended,
            "DeepSeek 实例已回滚或父窗口已销毁"
        );
        Ok(())
    }

    fn publish_ready(&self) -> Result<Arc<RequestState>> {
        let mut status = self.status.lock();
        ensure!(
            status.active && !status.ended && !status.poisoned,
            "DeepSeek 实例已失效，不能发布 Ready"
        );
        status.ready = true;
        Ok(self.requests.clone())
    }

    pub(crate) fn requests_if_ready(&self) -> Result<Arc<RequestState>> {
        let status = self.status.lock();
        ensure!(
            status.active && status.ready && !status.ended && !status.poisoned,
            "DeepSeek 原生实例尚未完成归位或已失效"
        );
        Ok(self.requests.clone())
    }

    pub(crate) fn rollback(&self, close: impl FnOnce() -> Result<()>) -> Result<()> {
        // The same gate covers begin/eval/attach, navigation and native rollback.
        // A stale rollback acts only on this Arc, never on the owner's newer slot.
        let mut status = self.status.lock();
        status.ready = false;
        let result = close();
        status.poisoned |= status.bound && !status.ended;
        if result.is_ok() || status.poisoned {
            status.active = false;
            self.requests.cancel_creation();
        }
        if status.poisoned {
            log::error!("DeepSeek 绑定后初始化回滚，已禁止后续回调和重建；请重启应用");
        }
        result
    }

    pub(crate) fn destroyed(&self) {
        let mut status = self.status.lock();
        if !status.ended {
            status.active = false;
            status.ready = false;
            status.ended = true;
            self.requests.detach();
        }
    }

    pub(super) fn loaded(&self, load: impl FnOnce(&Arc<RequestState>) -> bool) {
        let mut status = self.status.lock();
        if status.active {
            status.bound |= load(&self.requests);
        }
    }

    pub(super) fn navigate(&self, navigate: impl FnOnce() -> bool) -> bool {
        let status = self.status.lock();
        status.active && navigate()
    }

    pub(super) fn observer(&self) -> Arc<super::Observer> {
        self.requests.observer.clone()
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/deepseek/creation.rs"]
mod tests;
