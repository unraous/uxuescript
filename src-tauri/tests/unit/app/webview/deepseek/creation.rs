use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn rollback_closes_callback_admission_before_retry_and_poison_is_sticky() {
    let creations = Creations::default();
    let first = creations.begin().unwrap();
    let callbacks = AtomicUsize::new(0);
    let publish = || {
        callbacks.fetch_add(1, Ordering::SeqCst);
        true
    };
    creations.rollback(|| Ok(()), || {}).unwrap();
    assert!(creations.check_active().is_err());
    first.loaded(publish);
    assert_eq!(callbacks.load(Ordering::SeqCst), 0);
    let second = creations.begin().unwrap();
    second.loaded(publish);
    assert_eq!(callbacks.load(Ordering::SeqCst), 1);
    assert!(creations.rollback(|| Ok(()), || {}).is_ok());
    assert!(creations.check().unwrap_err().to_string().contains("重启"));
    assert!(creations.begin().is_err());
    second.loaded(publish);
    assert_eq!(callbacks.load(Ordering::SeqCst), 1);
}

#[test]
fn parent_destroyed_is_final_cleanup_without_restart_diagnostic() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    attempt.loaded(|| true);
    creations.destroyed();
    creations.rollback(|| Ok(()), || {}).unwrap();
    assert!(creations.check().is_ok());
    assert!(!attempt.navigate(|| true));
}

#[test]
fn unbound_failed_close_keeps_the_existing_attempt_retryable() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    assert!(
        creations
            .rollback(|| anyhow::bail!("close failed"), || {})
            .is_err()
    );
    assert!(creations.check().is_ok());
    assert!(attempt.navigate(|| true));
    assert!(creations.begin().is_err());
    creations.rollback(|| Ok(()), || {}).unwrap();
    assert!(!attempt.navigate(|| true));
    assert!(creations.begin().is_ok());
}
