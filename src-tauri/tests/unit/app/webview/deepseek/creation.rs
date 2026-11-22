use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn parent_destroyed_rejects_new_reservations_with_or_without_an_existing_instance() {
    for reserve_first in [false, true] {
        let creations = Creations::default();
        if reserve_first {
            creations.begin().unwrap();
        }
        creations.destroyed();
        assert!(
            creations.begin().is_err(),
            "a destroyed parent must never admit another instance (reserved={reserve_first})"
        );
    }
}

#[test]
fn rollback_closes_callback_admission_before_retry_and_poison_is_sticky() {
    let creations = Creations::default();
    let first = creations.begin().unwrap();
    let callbacks = AtomicUsize::new(0);
    let publish = || {
        callbacks.fetch_add(1, Ordering::SeqCst);
        true
    };
    first.rollback(|| Ok(())).unwrap();
    assert!(first.check_active().is_err());
    first.loaded(|_| publish());
    assert_eq!(callbacks.load(Ordering::SeqCst), 0);
    let second = creations.begin().unwrap();
    second.loaded(|_| publish());
    assert_eq!(callbacks.load(Ordering::SeqCst), 1);
    assert!(second.rollback(|| Ok(())).is_ok());
    assert!(creations.check().unwrap_err().to_string().contains("重启"));
    assert!(creations.begin().is_err());
    second.loaded(|_| publish());
    assert_eq!(callbacks.load(Ordering::SeqCst), 1);
}

#[test]
fn parent_destroyed_is_final_cleanup_without_restart_diagnostic() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    attempt.loaded(|_| true);
    creations.destroyed();
    attempt.rollback(|| Ok(())).unwrap();
    assert!(creations.check().is_ok());
    assert!(!attempt.navigate(|| true));
}

#[test]
fn unbound_failed_close_keeps_the_existing_attempt_retryable() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    assert!(attempt.rollback(|| anyhow::bail!("close failed")).is_err());
    assert!(creations.check().is_ok());
    assert!(attempt.navigate(|| true));
    assert!(creations.begin().is_err());
    attempt.rollback(|| Ok(())).unwrap();
    assert!(!attempt.navigate(|| true));
    assert!(creations.begin().is_ok());
}

#[test]
fn reservation_callbacks_and_ready_consumers_share_the_same_request_arc() {
    let creations = Creations::default();
    let first = creations.begin().unwrap();
    assert!(first.requests_if_ready().is_err());
    first.loaded(|requests| {
        assert!(Arc::ptr_eq(requests, &first.requests));
        false
    });
    assert!(
        first.requests_if_ready().is_err(),
        "page load is not native placement"
    );
    let diagnostic = creations.publish_ready(&first).unwrap();
    let solve_questions = creations
        .current()
        .unwrap()
        .unwrap()
        .requests_if_ready()
        .unwrap();
    assert!(Arc::ptr_eq(&diagnostic, &solve_questions));
    first.rollback(|| Ok(())).unwrap();
    let second = creations.begin().unwrap();
    assert!(!Arc::ptr_eq(&first.requests, &second.requests));
    assert!(creations.publish_ready(&first).is_err());
    let mut late = false;
    first.loaded(|_| {
        late = true;
        true
    });
    first.rollback(|| Ok(())).unwrap();
    assert!(!late);
    assert!(Arc::ptr_eq(
        &creations.current().unwrap().unwrap().requests,
        &second.requests
    ));
    assert!(
        creations.publish_ready(&second).is_ok(),
        "old rollback cannot cancel the new slot"
    );
}

#[test]
fn failed_close_retains_the_same_unpublished_instance_and_destroyed_closes_it() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    assert!(attempt.rollback(|| anyhow::bail!("close failed")).is_err());
    let retained = creations.current().unwrap().unwrap();
    assert!(Arc::ptr_eq(&attempt.requests, &retained.requests));
    assert!(retained.requests_if_ready().is_err());
    assert!(creations.begin().is_err());
    creations.publish_ready(&retained).unwrap();
    creations.destroyed();
    assert!(creations.publish_ready(&retained).is_err());
    assert!(retained.requests_if_ready().is_err());
    assert!(retained.requests.observer.begin().is_none());
    let mut late = false;
    retained.loaded(|_| {
        late = true;
        true
    });
    assert!(!late);
}
