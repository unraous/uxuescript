//! Local completion evidence only; this says nothing about native WebView retirement.
use anyhow::Result;
use std::{future::Future, pin::Pin, task::Context};
use tauri::async_runtime::JoinHandle;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalDrained(());

#[derive(Debug, thiserror::Error)]
#[error("DeepSeek 本地任务终结超时：generating={generating}, observers={observers}")]
pub(crate) struct DrainTimeout {
    pub(super) generating: usize,
    pub(super) observers: usize,
}

#[derive(Default)]
pub(super) struct Activities {
    // Flight::finish clears the request slot before the outer generating future exits.
    pub(super) generating: usize,
    pub(super) observers: Vec<JoinHandle<()>>,
    failure: Option<String>,
}

impl Activities {
    pub(super) fn poll_drained(&mut self, cx: &mut Context<'_>) -> Option<Result<LocalDrained>> {
        let mut index = 0;
        while index < self.observers.len() {
            match Pin::new(&mut self.observers[index]).poll(cx) {
                std::task::Poll::Pending => index += 1,
                std::task::Poll::Ready(result) => {
                    // Only completed handles leave the owner. Timeout/caller cancellation
                    // cannot detach a still-running task from the next drain attempt.
                    drop(self.observers.swap_remove(index));
                    if let Err(error) = result {
                        let message =
                            format!("DeepSeek observe task did not exit normally: {error}");
                        log::warn!("{message}");
                        self.failure.get_or_insert(message);
                    }
                }
            }
        }
        if self.generating != 0 || !self.observers.is_empty() {
            return None;
        }
        Some(match &self.failure {
            Some(error) => Err(anyhow::anyhow!("{error}")),
            None => Ok(LocalDrained(())),
        })
    }
}
