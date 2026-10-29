use anyhow::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, Semaphore, SemaphorePermit};
use tokio::time::{Duration, Instant};

/// 同一次求解共用请求许可、限流冷却和串行恢复状态。
pub(super) struct RequestPool {
    slots: Semaphore,
    serial_slot: Semaphore,
    serial: AtomicBool,
    cooldown: Cooldown,
}

impl RequestPool {
    pub(super) fn new(concurrency: usize) -> Self {
        Self {
            slots: Semaphore::new(concurrency),
            serial_slot: Semaphore::new(1),
            serial: AtomicBool::new(false),
            cooldown: Cooldown::default(),
        }
    }

    async fn acquire(&self) -> Result<(SemaphorePermit<'_>, Option<SemaphorePermit<'_>>)> {
        let permit = self.slots.acquire().await?;
        // 已发出的请求正常结束；首次 429 后的新请求统一经过串行许可。
        let serial = if self.serial.load(Ordering::Relaxed) {
            Some(self.serial_slot.acquire().await?)
        } else {
            None
        };
        Ok((permit, serial))
    }

    fn shrink(&self) {
        if !self.serial.swap(true, Ordering::Relaxed) {
            log::warn!("触发 API 限流，本次求解请求并发收缩为 1");
        }
    }

    /// 仅对 HTTP 429 最多重试三次（含首次共四次请求）。
    /// Retry-After 只解析整数秒，缺失或解析失败时依次等待 1、2、4 秒；
    /// 网络发送错误直接返回，其他状态及最终响应交由协议处理函数判断。
    pub(super) async fn send<F>(&self, build_req: F) -> Result<reqwest::Response>
    where
        F: Fn() -> reqwest::RequestBuilder,
    {
        const MAX_RETRIES: u32 = 3;

        for retry in 0..=MAX_RETRIES {
            let _permits = self.acquire().await?;
            self.cooldown.wait().await;
            let res = build_req().send().await?;

            if res.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
                return Ok(res);
            }
            let delay = res
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok()?.parse().ok())
                .map(std::time::Duration::from_secs)
                .unwrap_or_else(|| std::time::Duration::from_millis(1000 * (1 << retry)));

            self.cooldown.defer(delay).await;
            self.shrink();
            if retry == MAX_RETRIES {
                return Ok(res);
            }
            log::warn!(
                "触发 API 限流 (429)，将在 {:?} 后进行第 {}/{} 次重试...",
                delay,
                retry + 1,
                MAX_RETRIES
            );
        }

        unreachable!("最后一次请求直接返回响应")
    }
}

/// 同一次求解的批次共享限流冷却；恢复后错开发送，避免一起重试。
#[derive(Default)]
struct Cooldown(Mutex<Option<Instant>>);

impl Cooldown {
    async fn wait(&self) {
        loop {
            let mut next = self.0.lock().await;
            let Some(deadline) = *next else { return };
            if deadline <= Instant::now() {
                *next = Some(Instant::now() + Duration::from_millis(250));
                return;
            }
            // 等待期间释放锁，使其他批次收到 429 时仍能延长冷却。
            drop(next);
            tokio::time::sleep_until(deadline).await;
        }
    }

    async fn defer(&self, delay: Duration) {
        let mut next = self.0.lock().await;
        let deadline = Instant::now() + delay;
        *next = Some(next.map_or(deadline, |current| current.max(deadline)));
    }
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/dispatcher/pool.rs"]
mod tests;
