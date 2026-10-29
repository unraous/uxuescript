use super::*;
use std::sync::Arc;

#[tokio::test]
async fn rate_limits_reduce_new_requests_to_one_and_leave_inflight_requests_alone() {
    let pool = RequestPool::new(10);
    let mut inflight = Vec::new();
    for _ in 0..10 {
        inflight.push(pool.acquire().await.unwrap());
    }
    assert_eq!(pool.slots.available_permits(), 0);
    pool.shrink();
    pool.shrink();
    // 已在途的请求不占用串行许可；完成后再发出的请求共用唯一许可。
    drop(inflight);
    let first = pool.acquire().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(20), pool.acquire())
            .await
            .is_err()
    );
    drop(first);
    let next = tokio::time::timeout(Duration::from_secs(1), pool.acquire())
        .await
        .unwrap()
        .unwrap();
    drop(next);
    let fresh = RequestPool::new(10);
    assert_eq!(fresh.slots.available_permits(), 10);
    assert!(!fresh.serial.load(Ordering::Relaxed));
}

#[tokio::test]
async fn http_429_switches_to_serial_before_retrying() {
    use crate::test_support::http::serve_sequence;
    let (url, requests) = serve_sequence(vec![(429, "{}".into()), (200, "{}".into())]).await;
    let pool = RequestPool::new(10);
    let client = reqwest::Client::new();
    let response = pool
        .send(|| client.post(&url).json(&serde_json::json!({})))
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert!(pool.serial.load(Ordering::Relaxed));
    assert_eq!(requests.await.unwrap().len(), 2);
}

#[tokio::test]
async fn cooldown_extension_delays_waiters_and_spaces_recovery() {
    let cooldown = Arc::new(Cooldown::default());
    cooldown.defer(Duration::from_millis(20)).await;
    let waiting = cooldown.clone();
    let waiter = tokio::spawn(async move {
        waiting.wait().await;
        Instant::now()
    });
    cooldown.defer(Duration::from_millis(80)).await;
    let extended = Instant::now();
    assert!(waiter.await.unwrap() >= extended + Duration::from_millis(70));
    let first = Instant::now();
    cooldown.wait().await;
    assert!(first.elapsed() >= Duration::from_millis(200));
}

#[tokio::test]
async fn configured_concurrency_limits_permits() {
    let pool = RequestPool::new(2);
    let first = pool.acquire().await.unwrap();
    let second = pool.acquire().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(20), pool.acquire())
            .await
            .is_err()
    );
    drop(first);
    let third = tokio::time::timeout(Duration::from_secs(1), pool.acquire())
        .await
        .unwrap()
        .unwrap();
    drop((second, third));
}
