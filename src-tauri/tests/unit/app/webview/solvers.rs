use super::*;

#[tokio::test]
async fn cancelled_waiter_keeps_creation_serial_until_ready_and_both_consumers_share_the_arc() {
    let owner = WebSolverViews::default();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let first_owner = owner.clone();
    let first_entered = entered.clone();
    let first_release = release.clone();
    let first = tokio::spawn(async move {
        first_owner
            .ensure_with(move |attempt, fresh| async move {
                assert!(fresh);
                assert!(attempt.requests_if_ready().is_err());
                first_entered.notify_one();
                first_release.notified().await;
                Ok(())
            })
            .await
    });
    entered.notified().await;
    let original = owner.creations.current().unwrap().unwrap();
    assert!(original.requests_if_ready().is_err());
    first.abort();
    assert!(matches!(first.await, Err(error) if error.is_cancelled()));
    assert!(
        owner.creations.operation.try_lock().is_err(),
        "cancelled caller cannot release the creation gate"
    );
    let second_owner = owner.clone();
    let second = tokio::spawn(async move {
        second_owner
            .ensure_with(|_, _| async {
                panic!("Ready ensure must reuse the RequestState without native preparation")
            })
            .await
    });
    tokio::task::yield_now().await;
    assert!(!second.is_finished());
    release.notify_one();
    let diagnostic = second.await.unwrap().unwrap();
    let solve_questions = original.requests_if_ready().unwrap();
    assert!(Arc::ptr_eq(&diagnostic, &solve_questions));
    owner.destroyed();
    assert!(
        owner
            .ensure_with(|_, _| async { panic!("destroyed owner cannot prepare") })
            .await
            .is_err()
    );
}

#[tokio::test]
async fn closing_rejects_ensure_without_waiting_for_operation_and_destroyed_waits_for_creation() {
    let owner = WebSolverViews::default();
    owner.ensure_with(|_, _| async { Ok(()) }).await.unwrap();
    let attempt = owner.current_attempt().unwrap().unwrap();
    owner.begin_close(&attempt).unwrap();
    assert!(Arc::ptr_eq(
        &attempt,
        &owner.current_attempt().unwrap().unwrap()
    ));
    let operation = owner.creations.operation.lock().await;
    let error = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        owner.ensure_with(|_, _| async { panic!("Closing must not prepare") }),
    )
    .await
    .expect("Closing ensure cannot wait on operation")
    .err()
    .expect("Closing ensure must fail");
    assert!(error.to_string().contains("关闭"));
    drop(operation);
    attempt.drain_local().await.unwrap();

    let creating = WebSolverViews::default();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let first_owner = creating.clone();
    let first_entered = entered.clone();
    let first_release = release.clone();
    let first = tokio::spawn(async move {
        first_owner
            .ensure_with(move |_, _| async move {
                first_entered.notify_one();
                first_release.notified().await;
                Ok(())
            })
            .await
    });
    entered.notified().await;
    let attempt = creating.creations.current().unwrap().unwrap();
    let queued_owner = creating.clone();
    let queued = tokio::spawn(async move {
        queued_owner
            .ensure_with(|_, _| async { panic!("ended owner cannot prepare queued work") })
            .await
    });
    tokio::task::yield_now().await;
    creating.destroyed();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), queued)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), attempt.drain_local())
            .await
            .is_err(),
        "OwnerEnded must await in-progress preparation before reporting LocalDrained"
    );
    release.notify_one();
    assert!(first.await.unwrap().is_err());
    attempt.drain_local().await.unwrap();
    assert!(creating.creations.begin().is_err());
}
