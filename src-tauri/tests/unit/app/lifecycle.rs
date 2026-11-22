use super::*;
use std::sync::atomic::AtomicUsize;

#[tokio::test]
async fn spawn_retries_rolls_back_and_destroy_keeps_failed_close() {
    let state = WindowState::default();
    let existing = Mutex::new(None);
    let creates = AtomicUsize::new(0);
    let fail_prepare = AtomicBool::new(true);
    let fail_close = AtomicBool::new(true);
    let registered = AtomicBool::new(false);
    let find = || Ok(*existing.lock());
    let create = || {
        creates.fetch_add(1, Ordering::SeqCst);
        *existing.lock() = Some(7);
        Ok(7)
    };
    let prepare = |_: i32| async {
        if fail_prepare.load(Ordering::SeqCst) {
            anyhow::bail!("placement failed");
        }
        registered.store(true, Ordering::SeqCst);
        Ok(())
    };
    let close = |_: i32| async {
        if fail_close.load(Ordering::SeqCst) {
            anyhow::bail!("close failed");
        }
        *existing.lock() = None;
        registered.store(false, Ordering::SeqCst);
        Ok(())
    };
    assert!(
        spawn_entry(
            &state,
            find,
            || anyhow::bail!("create failed"),
            &prepare,
            &close
        )
        .await
        .is_err()
    );
    assert_eq!(*existing.lock(), None);
    fail_close.store(false, Ordering::SeqCst);
    assert!(
        spawn_entry(&state, find, create, &prepare, &close)
            .await
            .is_err()
    );
    assert_eq!(*existing.lock(), None);
    fail_close.store(true, Ordering::SeqCst);
    let error = spawn_entry(&state, find, create, &prepare, &close)
        .await
        .unwrap_err();
    assert!(format!("{error:#}").contains("placement failed"));
    assert!(format!("{error:#}").contains("close failed"));
    assert_eq!(*existing.lock(), Some(7));
    fail_prepare.store(false, Ordering::SeqCst);
    assert_eq!(
        spawn_entry(&state, find, create, &prepare, &close)
            .await
            .unwrap(),
        7
    );
    assert_eq!(
        spawn_entry(&state, find, create, &prepare, &close)
            .await
            .unwrap(),
        7
    );
    assert_eq!(creates.load(Ordering::SeqCst), 2);
    assert!(
        destroy_entry(&state, find, &close, || async {
            registered.store(false, Ordering::SeqCst);
        })
        .await
        .is_err()
    );
    assert!(registered.load(Ordering::SeqCst));
    fail_close.store(false, Ordering::SeqCst);
    destroy_entry(&state, find, &close, || async {
        registered.store(false, Ordering::SeqCst);
    })
    .await
    .unwrap();
    destroy_entry(&state, find, &close, || async {
        registered.store(false, Ordering::SeqCst);
    })
    .await
    .unwrap();
    spawn_entry(&state, find, create, &prepare, &close)
        .await
        .unwrap();
    assert_eq!(creates.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn destroyed_window_invalidates_in_flight_and_queued_work() {
    let state = WindowState::default();
    let closed = AtomicBool::new(false);
    let entered = tokio::sync::Notify::new();
    let release = tokio::sync::Notify::new();
    let first = spawn_entry(
        &state,
        || Ok(None),
        || Ok(1),
        |_: i32| async {
            entered.notify_one();
            release.notified().await;
            Ok(())
        },
        |_: i32| async {
            closed.store(true, Ordering::SeqCst);
            Ok(())
        },
    );
    let queued = async {
        entered.notified().await;
        // The first operation holds the gate while Destroyed invalidates it.
        assert!(state.operation.try_lock().is_err());
        state.alive.store(false, Ordering::Release);
        release.notify_one();
        spawn_entry(
            &state,
            || panic!("queued work must reject before lookup"),
            || Ok(1),
            |_: i32| async { Ok(()) },
            |_: i32| async { Ok(()) },
        )
        .await
    };
    let (first, queued) = tokio::join!(first, queued);
    assert!(first.is_err());
    assert!(queued.is_err());
    assert!(closed.load(Ordering::SeqCst));
    for label in [
        "main",
        "chaoxing",
        "chaoxing-mask",
        "mask",
        "deepseek",
        "unknown",
    ] {
        assert!(validate_dynamic(label).is_err());
    }
}
