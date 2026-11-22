//! Admission guard for B1 failure rollback, not a second RequestState instance.
use anyhow::{Result, ensure};
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct Creations(Mutex<Option<Arc<Attempt>>>);

#[derive(Default)]
struct Status {
    active: bool,
    bound: bool,
    poisoned: bool,
    ended: bool,
}

pub(super) struct Attempt(Mutex<Status>);

impl Creations {
    pub(crate) fn check(&self) -> Result<()> {
        if let Some(attempt) = self.0.lock().as_ref() {
            ensure!(
                !attempt.0.lock().poisoned,
                "DeepSeek 绑定后初始化回滚，无法安全重建；请重启应用"
            );
        }
        Ok(())
    }

    pub(crate) fn check_active(&self) -> Result<()> {
        self.check()?;
        if let Some(attempt) = self.0.lock().as_ref() {
            ensure!(
                attempt.0.lock().active,
                "DeepSeek 回滚中的 WebView 尚未释放或窗口已退出，请重试"
            );
        }
        Ok(())
    }

    pub(crate) fn destroyed(&self) {
        if let Some(attempt) = self.0.lock().as_ref() {
            let mut status = attempt.0.lock();
            status.active = false;
            status.ended = true;
        }
    }

    pub(super) fn begin(&self) -> Result<Arc<Attempt>> {
        self.check()?;
        let mut current = self.0.lock();
        if let Some(previous) = current.as_ref() {
            ensure!(
                !previous.0.lock().active,
                "DeepSeek 已有创建记录，不能重建；请重启应用"
            );
        }
        let attempt = Arc::new(Attempt(Mutex::new(Status {
            active: true,
            ..Status::default()
        })));
        *current = Some(attempt.clone());
        Ok(attempt)
    }

    pub(crate) fn rollback(
        &self,
        close: impl FnOnce() -> Result<()>,
        cancel: impl FnOnce(),
    ) -> Result<()> {
        let current = self.0.lock();
        if let Some(attempt) = current.as_ref() {
            // The same gate covers load_on's begin/eval/attach and navigation.
            // close() alone does not trigger Observer.close (parent Destroyed does).
            let mut status = attempt.0.lock();
            let result = close();
            status.poisoned |= status.bound && !status.ended;
            if result.is_ok() || status.poisoned {
                status.active = false;
                cancel();
            }
            if status.poisoned {
                log::error!("DeepSeek 绑定后初始化回滚，已禁止后续回调和重建；请重启应用");
            }
            result
        } else {
            close()
        }
    }
}

impl Attempt {
    pub(super) fn loaded(&self, load: impl FnOnce() -> bool) {
        let mut status = self.0.lock();
        if status.active {
            status.bound |= load();
        }
    }

    pub(super) fn navigate(&self, navigate: impl FnOnce() -> bool) -> bool {
        let status = self.0.lock();
        status.active && navigate()
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/deepseek/creation.rs"]
mod tests;
