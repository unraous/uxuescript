use super::*;

fn url(value: &str) -> Url {
    value.parse().expect("valid test URL")
}

#[test]
fn targets_only_the_exact_https_origin() {
    assert!(is_target_url(&url("https://chat.deepseek.com/")));
    assert!(is_target_url(&url(
        "https://chat.deepseek.com:443/a/chat/s/example"
    )));
    for address in [
        "http://chat.deepseek.com/",
        "https://chat.deepseek.com:8443/",
        "https://auth.chat.deepseek.com/",
        "https://chat.deepseek.com.example.org/",
        "https://example.org/",
        "about:blank",
    ] {
        assert!(!is_target_url(&url(address)), "{address}");
    }
}

#[test]
fn delivers_the_embedded_iife_unchanged_inside_a_top_origin_condition_not_a_function_scope() {
    let expected = format!(
        "if (window.top === window && window.location.origin === 'https://chat.deepseek.com') {{\n{}\n}}",
        include_script!("deepseek-web-adapter.js")
    );
    assert!(
        adapter_initialization_script() == expected,
        "guarded delivery must preserve the full artifact and its scope"
    );
}

fn snapshot_json() -> serde_json::Value {
    serde_json::json!({
        "kind": "snapshot",
        "snapshot": {
            "schemaVersion": 1,
            "generation": 0,
            "authenticationRevision": 0,
            "apiAvailable": true,
            "adapterVersion": "0.1.0",
            "phase": "initializing",
            "initialization": "pending",
            "attempts": 1,
            "pathBindable": true,
            "sessionPresent": false,
            "sessionState": "none",
            "errorCode": null,
            "pageNotReadyTimedOut": false
        }
    })
}

#[test]
fn auth_invalidation_emits_for_each_new_document_and_credential_revision_only() {
    let mut first_document = None;
    let mut value = ready_snapshot_json();
    let first = parse_readout(&value.to_string()).unwrap();
    assert!(first.authentication_changed(&mut first_document));
    assert!(!first.authentication_changed(&mut first_document));
    // Route rebinds and failed samples are unrelated to login state.
    value["snapshot"]["generation"] = 1.into();
    assert!(
        !parse_readout(&value.to_string())
            .unwrap()
            .authentication_changed(&mut first_document)
    );
    assert!(!Readout::ReadFailed.authentication_changed(&mut first_document));
    value["snapshot"]["authenticationRevision"] = 1.into();
    let changed = parse_readout(&value.to_string()).unwrap();
    assert!(changed.authentication_changed(&mut first_document));
    assert!(!changed.authentication_changed(&mut first_document));
    // A whole-document reload starts its own revision at zero and must notify.
    let mut next_document = None;
    assert!(first.authentication_changed(&mut next_document));
}

fn ready_snapshot_json() -> serde_json::Value {
    let mut value = snapshot_json();
    value["snapshot"]["phase"] = "ready".into();
    value["snapshot"]["initialization"] = "fulfilled".into();
    value["snapshot"]["sessionPresent"] = true.into();
    value["snapshot"]["sessionState"] = "valid".into();
    value
}

#[test]
fn reads_synchronous_json_and_keeps_pending_distinct_from_fulfilled() {
    let mut value = snapshot_json();
    let pending = parse_readout(&value.to_string()).expect("pending snapshot");
    let Readout::Snapshot { snapshot } = pending else {
        panic!("snapshot expected")
    };
    assert_eq!(snapshot.initialization, Initialization::Pending);
    assert_eq!(snapshot.session_state, SessionState::None);
    value["snapshot"]["phase"] = "ready".into();
    value["snapshot"]["initialization"] = "fulfilled".into();
    value["snapshot"]["sessionPresent"] = true.into();
    value["snapshot"]["sessionState"] = "valid".into();
    let fulfilled = parse_readout(&value.to_string()).expect("fulfilled snapshot");
    let Readout::Snapshot { snapshot } = fulfilled else {
        panic!("snapshot expected")
    };
    assert_eq!(snapshot.initialization, Initialization::Fulfilled);
    assert_eq!(snapshot.session_state, SessionState::Valid);
}

#[test]
fn distinguishes_same_ready_fields_with_different_binding_generations_without_logging_identity() {
    let mut value = snapshot_json();
    value["snapshot"]["phase"] = "ready".into();
    value["snapshot"]["initialization"] = "fulfilled".into();
    value["snapshot"]["sessionPresent"] = true.into();
    value["snapshot"]["sessionState"] = "valid".into();
    let private = "11111111-1111-4111-8111-111111111111";
    value["snapshot"]["sessionId"] = private.into();
    let first = parse_readout(&value.to_string()).unwrap();
    value["snapshot"]["generation"] = 2.into();
    let rebound = parse_readout(&value.to_string()).unwrap();
    assert_ne!(first, rebound);
    assert!(first.summary().contains("binding_generation=0"));
    assert!(rebound.summary().contains("binding_generation=2"));
    assert_ne!(first.summary(), rebound.summary());
    assert!(!rebound.summary().contains(private));
    assert_eq!(rebound, parse_readout(&value.to_string()).unwrap());
}

#[test]
fn recognizes_rejected_page_wait_diagnostics_and_expected_absence_separately() {
    let mut value = snapshot_json();
    value["snapshot"]["phase"] = "waiting_page".into();
    value["snapshot"]["initialization"] = "rejected".into();
    value["snapshot"]["errorCode"] = "PAGE_NOT_READY".into();
    value["snapshot"]["attempts"] = 4.into();
    let waiting = parse_readout(&value.to_string()).expect("page wait snapshot");
    assert!(!waiting.is_warning());
    assert!(waiting.summary().contains("attempts=4"));
    assert!(waiting.summary().contains("PageNotReady"));
    assert!(
        !parse_readout(r#"{"kind":"target_skipped"}"#)
            .unwrap()
            .is_warning()
    );
    assert!(
        parse_readout(r#"{"kind":"bootstrap_missing"}"#)
            .unwrap()
            .is_warning()
    );
    assert!(
        parse_readout(r#"{"kind":"read_failed"}"#)
            .unwrap()
            .is_warning()
    );
    value["snapshot"]["phase"] = "failed".into();
    value["snapshot"]["pageNotReadyTimedOut"] = true.into();
    assert!(parse_readout(&value.to_string()).unwrap().is_warning());
}

#[test]
fn rejects_malformed_unknown_schema_and_inconsistent_valid_session_without_echoing_input() {
    for invalid in ["null", "{}", "not JSON", r#""pending Promise""#] {
        assert!(parse_readout(invalid).is_err());
    }
    let mut value = snapshot_json();
    value["snapshot"]["schemaVersion"] = 2.into();
    assert_eq!(parse_readout(&value.to_string()), Err("UNSUPPORTED_SCHEMA"));
    value["snapshot"]["schemaVersion"] = 1.into();
    value["snapshot"]["sessionState"] = "valid".into();
    assert_eq!(
        parse_readout(&value.to_string()),
        Err("INCONSISTENT_SNAPSHOT")
    );
    let private = "11111111-1111-4111-8111-111111111111";
    value["snapshot"]["errorCode"] = private.into();
    let error = parse_readout(&value.to_string()).unwrap_err();
    assert_eq!(error, "INVALID_JSON");
    assert!(!error.contains(private));
}

#[test]
fn summary_never_logs_raw_adapter_version_or_session_data() {
    let mut value = snapshot_json();
    let private = "11111111-1111-4111-8111-111111111111";
    value["snapshot"]["adapterVersion"] = private.into();
    value["snapshot"]["sessionId"] = private.into();
    let readout = parse_readout(&value.to_string()).expect("diagnostic snapshot");
    let summary = readout.summary();
    assert!(summary.contains("initialization=Pending"));
    assert!(summary.contains("session_present=false"));
    assert!(!summary.contains(private));
}

#[tokio::test]
async fn receives_json_from_callback_without_waiting_for_any_javascript_promise() {
    let (sender, receiver) = oneshot::channel();
    let (_cancel_sender, mut cancel) = oneshot::channel();
    sender.send(snapshot_json().to_string()).unwrap();
    let raw = wait_for_callback(receiver, &mut cancel, Duration::from_millis(100))
        .await
        .unwrap();
    assert!(parse_readout(&raw).is_ok());
}

#[tokio::test]
async fn cancellation_wins_over_a_ready_old_callback_and_new_generation_is_isolated() {
    let observer = Observer::default();
    let (old_epoch, mut old_cancel) = observer.begin().expect("old page");
    let (sender, receiver) = oneshot::channel();
    sender.send(snapshot_json().to_string()).unwrap();
    let (new_epoch, mut new_cancel) = observer.begin().expect("new page");
    assert!(!observer.is_current(old_epoch));
    assert!(observer.is_current(new_epoch));
    assert_eq!(
        wait_for_callback(receiver, &mut old_cancel, Duration::from_millis(100)).await,
        Err(ReadFailure::Cancelled)
    );
    observer.close();
    assert!(!observer.is_current(new_epoch));
    assert!(observer.begin().is_none());
    let (late_sender, late_receiver) = oneshot::channel();
    assert_eq!(
        wait_for_callback(late_receiver, &mut new_cancel, Duration::from_millis(100)).await,
        Err(ReadFailure::Cancelled)
    );
    assert!(late_sender.send("late callback".into()).is_err());
}

#[tokio::test]
async fn navigation_cancels_a_pending_callback_without_waiting_for_its_deadline() {
    let observer = Observer::default();
    let (epoch, mut cancelled) = observer.begin().expect("page");
    let (_sender, receiver) = oneshot::channel();
    observer.cancel();
    let result = tokio::time::timeout(
        Duration::from_millis(100),
        wait_for_callback(receiver, &mut cancelled, Duration::from_secs(2)),
    )
    .await
    .expect("cancellation must finish promptly");
    assert_eq!(result, Err(ReadFailure::Cancelled));
    assert!(!observer.is_current(epoch));
}

#[test]
fn only_current_page_may_publish_diagnostic_changes() {
    let observer = Observer::default();
    let (old, _old_cancel) = observer.begin().unwrap();
    let (current, _cancel) = observer.begin().unwrap();
    let mut published = 0;
    assert!(!observer.while_current(old, || published += 1));
    assert!(observer.while_current(current, || published += 1));
    observer.close();
    assert!(!observer.while_current(current, || published += 1));
    assert_eq!(published, 1);
}

#[tokio::test]
async fn allowed_navigation_entry_cancels_before_content_loading_and_blocks_late_publish() {
    for address in [
        "https://chat.deepseek.com/",
        "https://chat.deepseek.com/a/chat/s/11111111-1111-4111-8111-111111111111",
    ] {
        let observer = Arc::new(Observer::default());
        let (epoch, mut cancelled) = observer.begin().unwrap();
        let navigation = navigation_handler(observer.clone(), super::super::is_deepseek_url);
        let (sender, receiver) = oneshot::channel();
        // Refresh / navigation is accepted, but ContentLoading has not happened yet.
        assert!(navigation(&url(address)));
        let mut published = false;
        assert!(!observer.while_current(epoch, || published = true));
        sender.send(ready_snapshot_json().to_string()).unwrap();
        assert_eq!(
            wait_for_callback(receiver, &mut cancelled, Duration::from_millis(100)).await,
            Err(ReadFailure::Cancelled)
        );
        assert!(!published);
    }
}

#[tokio::test]
async fn rejected_navigation_entry_preserves_the_existing_page_observation_and_host_filter() {
    let observer = Arc::new(Observer::default());
    let (epoch, mut cancelled) = observer.begin().unwrap();
    let navigation = navigation_handler(observer.clone(), super::super::is_deepseek_url);
    for address in [
        "https://example.org/",
        "https://auth.chat.deepseek.com/",
        "https://chat.deepseek.com.example.org/",
        "about:blank",
    ] {
        let destination = url(address);
        assert!(!super::super::is_deepseek_url(&destination));
        assert!(!navigation(&destination));
        assert!(observer.is_current(epoch));
    }
    let (sender, receiver) = oneshot::channel();
    sender.send(ready_snapshot_json().to_string()).unwrap();
    let raw = wait_for_callback(receiver, &mut cancelled, Duration::from_millis(100))
        .await
        .unwrap();
    assert!(parse_readout(&raw).is_ok());
    let mut published = false;
    assert!(observer.while_current(epoch, || published = true));
    assert!(published);
}

#[tokio::test]
async fn callback_wait_has_a_deadline_and_reports_a_dropped_callback() {
    let (_sender, receiver) = oneshot::channel();
    let (_cancel_sender, mut cancel) = oneshot::channel();
    assert_eq!(
        wait_for_callback(receiver, &mut cancel, Duration::from_millis(5)).await,
        Err(ReadFailure::Timeout)
    );
    let (sender, receiver) = oneshot::channel();
    drop(sender);
    assert_eq!(
        wait_for_callback(receiver, &mut cancel, Duration::from_millis(100)).await,
        Err(ReadFailure::CallbackDropped)
    );
}

#[tokio::test]
async fn local_drain_tracks_every_observer_and_preserves_unfinished_handles_on_timeout() {
    let state = request::RequestState::default();
    let (release, held) = oneshot::channel();
    assert!(state.observer.begin_observe(|_, cancelled| {
        tauri::async_runtime::JoinHandle::Tokio(tokio::spawn(async move {
            let _ = cancelled.await;
            let _ = held.await;
        }))
    }));
    assert!(state.observer.begin_observe(|_, cancelled| {
        tauri::async_runtime::JoinHandle::Tokio(tokio::spawn(async move {
            let _ = cancelled.await;
        }))
    }));
    state.close_local();
    assert!(
        !state
            .observer
            .begin_observe(|_, _| panic!("closed observer must not start"))
    );
    let error = state
        .drain_local(Duration::from_millis(5))
        .await
        .unwrap_err();
    assert!(error.downcast_ref::<request::DrainTimeout>().is_some());
    assert!(!state.observer.0.lock().local.observers.is_empty());
    release.send(()).unwrap();
    state.drain_local(Duration::from_secs(1)).await.unwrap();
    assert!(state.observer.0.lock().local.observers.is_empty());
}

#[tokio::test]
async fn observer_panic_and_abort_remain_failed_on_repeated_drains() {
    for abort in [false, true] {
        let state = request::RequestState::default();
        assert!(state.observer.begin_observe(|_, _| {
            let task = tokio::spawn(async move {
                if abort {
                    std::future::pending::<()>().await;
                } else {
                    panic!("controlled observer panic");
                }
            });
            if abort {
                task.abort();
            }
            tauri::async_runtime::JoinHandle::Tokio(task)
        }));
        state.close_local();
        for _ in 0..2 {
            let error = state.drain_local(Duration::from_secs(1)).await.unwrap_err();
            assert!(error.to_string().contains("did not exit normally"));
        }
    }
}
