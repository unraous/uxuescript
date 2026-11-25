use super::*;
use std::sync::Arc;

#[tokio::test]
async fn accepted_activation_survives_cancel_then_serializes_queued_switches_and_reuses_requests() {
    let owner = WebSolverViews::default();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (started, done) = (entered.clone(), release.clone());
    let first_owner = owner.clone();
    let first = tokio::spawn(async move {
        let ensuring = first_owner.clone();
        first_owner
            .activate_with(async move {
                ensuring
                    .ensure_with(|_, fresh| async move {
                        assert!(fresh);
                        Ok(())
                    })
                    .await?;
                started.notify_one();
                done.notified().await;
                Ok(ViewActivation {
                    view: ActiveView::Deepseek,
                    focus_error: None,
                })
            })
            .await
    });
    entered.notified().await;
    let attempt = owner.current_attempt().unwrap().unwrap();
    let requests = attempt.requests_if_ready().unwrap();
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    assert!(owner.activation.try_lock().is_err());

    let completed = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let mut queued = Vec::new();
    for target in [ActiveView::Chaoxing, ActiveView::Deepseek] {
        let switching = owner.clone();
        let completed = completed.clone();
        queued.push(tokio::spawn(async move {
            let ensuring = switching.clone();
            switching
                .activate_with(async move {
                    ensuring
                        .ensure_with(|_, _| async { panic!("existing request must be reused") })
                        .await?;
                    completed.lock().push(target);
                    Ok(ViewActivation {
                        view: target,
                        focus_error: None,
                    })
                })
                .await
        }));
        tokio::task::yield_now().await;
    }
    assert!(queued.iter().all(|task| !task.is_finished()));
    release.notify_one();
    for (task, target) in queued
        .into_iter()
        .zip([ActiveView::Chaoxing, ActiveView::Deepseek])
    {
        assert_eq!(task.await.unwrap().unwrap().view, target);
    }
    assert_eq!(
        *completed.lock(),
        [ActiveView::Chaoxing, ActiveView::Deepseek]
    );
    assert!(Arc::ptr_eq(
        &attempt,
        &owner.current_attempt().unwrap().unwrap()
    ));
    assert!(Arc::ptr_eq(
        &requests,
        &attempt.requests_if_ready().unwrap()
    ));
    owner.destroyed();
    assert!(
        owner
            .activate_with(async { panic!("ended owner cannot activate") })
            .await
            .is_err()
    );
}
