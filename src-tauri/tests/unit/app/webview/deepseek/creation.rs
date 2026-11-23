use super::*;

#[test]
fn rollback_close_success_does_not_prove_native_retirement() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    attempt.native_creation_started().unwrap();
    attempt.native_created();
    attempt.rollback(|| Ok(())).unwrap();
    assert!(
        creations.begin().is_err(),
        "native close dispatch is not safe retirement"
    );
    assert_eq!(
        attempt.status.lock().phase,
        Phase::Failed(Failure::RetirementUnconfirmed)
    );
    assert!(creations.current().is_err());
    assert!(creations.publish_ready(&attempt).is_err());
}

#[test]
fn creation_failure_releases_only_unsubmitted_children_and_preserves_same_attempt_recovery() {
    let creations = Creations::default();
    let unsubmitted = creations.begin().unwrap();
    creations.creation_failed(&unsubmitted);
    assert!(creations.current().unwrap().is_none());
    let submitted = creations.begin().unwrap();
    assert!(!Arc::ptr_eq(&unsubmitted, &submitted));
    assert!(creations.publish_ready(&unsubmitted).is_err());
    assert!(creations.begin_close(&unsubmitted).is_err());
    let mut late = false;
    unsubmitted.loaded(|_| {
        late = true;
        true
    });
    assert!(!late);
    unsubmitted
        .rollback(|| panic!("retired callback cannot close a new child"))
        .unwrap();
    submitted.native_creation_started().unwrap();
    creations.creation_failed(&submitted);
    assert_eq!(
        submitted.status.lock().phase,
        Phase::Failed(Failure::CreationUnconfirmed)
    );
    assert!(creations.begin().is_err());
    assert!(creations.retry_cleanup(&submitted).is_err());

    let retained_owner = Creations::default();
    let retained = retained_owner.begin().unwrap();
    retained.native_creation_started().unwrap();
    retained.native_created();
    assert!(retained.rollback(|| anyhow::bail!("close failed")).is_err());
    retained_owner.creation_failed(&retained);
    assert!(Arc::ptr_eq(
        &retained,
        &retained_owner.current().unwrap().unwrap()
    ));
    assert_eq!(retained.status.lock().phase, Phase::Creating);
    assert!(retained.navigate(|| true));
    let requests = retained_owner.publish_ready(&retained).unwrap();
    assert!(Arc::ptr_eq(&requests, &retained.requests));
    assert!(retained_owner.begin().is_err());
}

#[tokio::test]
async fn phase_gate_close_and_owner_end_are_final_and_share_one_close_task() {
    let creations = Creations::default();
    let attempt = creations.begin().unwrap();
    assert!(
        creations.begin_close(&attempt).is_err(),
        "Creating has no independent close"
    );
    // A Creating attempt may already be bound; a Ready one need not be.
    assert!(!attempt.status.lock().bound);
    let first = creations.publish_ready(&attempt).unwrap();
    assert!(Arc::ptr_eq(&first, &attempt.requests_if_ready().unwrap()));
    creations.begin_close(&attempt).unwrap();
    let close_result = attempt.status.lock().closing.clone().unwrap();
    creations.begin_close(&attempt).unwrap();
    assert!(close_result.same_channel(attempt.status.lock().closing.as_ref().unwrap()));
    assert_eq!(attempt.status.lock().phase, Phase::Closing);
    assert!(creations.current().is_err());
    assert!(creations.publish_ready(&attempt).is_err());
    assert!(attempt.requests.observer.begin().is_none());
    let cancelled = tokio::spawn({
        let attempt = attempt.clone();
        async move { attempt.drain_local().await }
    });
    cancelled.abort();
    let drained = attempt.drain_local().await.unwrap();
    assert_eq!(drained, attempt.drain_local().await.unwrap());
    assert_eq!(attempt.status.lock().phase, Phase::Closing);
    assert!(
        creations.begin().is_err(),
        "LocalDrained does not release native ownership"
    );
    creations.destroyed();
    creations.destroyed();
    assert!(creations.current().is_err());
    assert!(creations.begin().is_err());
    attempt
        .rollback(|| panic!("destroyed owner must not close child"))
        .unwrap();

    let empty = Creations::default();
    empty.destroyed();
    assert!(empty.begin().is_err());
}

#[tokio::test]
async fn rollback_failure_cleanup_capability_and_bound_history_are_preserved() {
    let owner = Creations::default();
    let attempt = owner.begin().unwrap();
    attempt.loaded(|_| true);
    assert!(attempt.status.lock().bound);
    attempt
        .rollback(|| anyhow::bail!("close failed"))
        .unwrap_err();
    assert_eq!(
        attempt.status.lock().phase,
        Phase::Failed(Failure::BoundRollback)
    );
    assert!(owner.current().is_err());
    assert!(owner.publish_ready(&attempt).is_err());
    assert!(owner.retry_cleanup(&attempt).is_err());
    attempt.loaded(|_| panic!("failed attempt cannot reattach"));
    assert!(attempt.status.lock().bound);
    owner.destroyed();
    attempt.drain_local().await.unwrap();

    let retryable = Creations::default();
    let failed = retryable.begin().unwrap();
    failed.rollback(|| Ok(())).unwrap();
    retryable.retry_cleanup(&failed).unwrap();
    failed.drain_local().await.unwrap();
    assert_eq!(failed.status.lock().phase, Phase::Closing);
    assert!(retryable.begin().is_err());
}
