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
        owner.operation.try_lock().is_err(),
        "cancelled caller cannot release the creation gate"
    );
    let second_owner = owner.clone();
    let expected = original.clone();
    let second = tokio::spawn(async move {
        second_owner
            .ensure_with(move |attempt, fresh| async move {
                assert!(!fresh);
                assert!(Arc::ptr_eq(&expected, &attempt));
                assert!(
                    attempt.requests_if_ready().is_ok(),
                    "the first native prepare must have completed"
                );
                Ok(())
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
