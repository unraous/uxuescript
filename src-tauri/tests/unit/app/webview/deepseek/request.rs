use super::*;

fn identity() -> Identity {
    Identity {
        document_token: "process:document-1".into(),
        binding_generation: 3,
        request_id: "process:request-1".into(),
    }
}

#[test]
fn claims_one_request_and_serializes_text_without_a_session_id() {
    let state = RequestState::default();
    state.observer.begin().unwrap();
    let (mut first, _cancelled) = state.claim().unwrap();
    assert_eq!(state.claim().err(), Some("BUSY"));
    let id = identity();
    let text = "quoted \" text\n\\ </script> 完整回答";
    let envelope = Envelope {
        identity: &id,
        text,
        options: &Options::default(),
    };
    let encoded = serde_json::to_string(&envelope).unwrap();
    let decoded: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded["text"], text);
    assert!(decoded.get("sessionId").is_none());
    assert!(decoded["options"].get("thinking").is_none());
    assert!(decoded["options"].get("webSearch").is_none());
    assert!(
        bridge_script("start", &envelope)
            .unwrap()
            .contains(&encoded)
    );
    first.finish(false).unwrap();
    let (second, _) = state.claim().unwrap();
    assert_ne!(second.request_id, first.request_id);
}

#[test]
fn preserves_full_terminal_results_and_quarantines_only_unsafe_outcomes() {
    let id = identity();
    let mut value = serde_json::json!({
        "kind": "terminal", "documentToken": id.document_token,
        "bindingGeneration": id.binding_generation, "requestId": id.request_id,
        "result": {"status": "completed", "requestId": id.request_id, "content": "完整回答\nsecond line", "durationMs": 32}
    });
    let completed = parse_poll(&value.to_string(), &id).unwrap();
    let Poll::Terminal { result, .. } = completed else {
        panic!("terminal expected")
    };
    assert!(!result.needs_quarantine());
    assert_eq!(
        serde_json::to_value(&result).unwrap()["content"],
        "完整回答\nsecond line"
    );
    value["result"] = serde_json::json!({
        "status":"failed", "requestId":id.request_id, "durationMs":5,
        "error":{"code":"COMPOSER_NOT_EMPTY","message":"input preserved","stage":"checking_page","delivery":"not_sent","remote":"not_started","retryable":false,"diagnostics":{"candidateCount":2}}
    });
    let Poll::Terminal { result, .. } = parse_poll(&value.to_string(), &id).unwrap() else {
        panic!("terminal expected")
    };
    assert!(!result.needs_quarantine());
    value["result"]["status"] = "uncertain".into();
    value["result"]["error"]["delivery"] = "confirmed".into();
    value["result"]["error"]["remote"] = "generating".into();
    let Poll::Terminal { result, .. } = parse_poll(&value.to_string(), &id).unwrap() else {
        panic!("terminal expected")
    };
    assert!(result.needs_quarantine());
    value["requestId"] = "foreign".into();
    assert_eq!(
        parse_poll(&value.to_string(), &id).err(),
        Some("IDENTITY_MISMATCH")
    );
}

#[tokio::test]
async fn navigation_ends_a_dispatched_request_and_late_completion_cannot_unlock_quarantine() {
    let state = RequestState::default();
    state.observer.begin().unwrap();
    let (mut flight, mut cancelled) = state.claim().unwrap();
    flight.mark_dispatched().unwrap();
    state.observer.cancel();
    tokio::time::timeout(Duration::from_millis(100), &mut cancelled)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(flight.finish(false), Err("DOCUMENT_INTERRUPTED"));
    state.observer.begin().unwrap();
    assert_eq!(state.claim().err(), Some("QUARANTINED"));
    // 关闭目标释放 handle，但远端未知的隔离事实不能被 missing target 覆盖。
    state.detach();
    let result = state.generate_text("text", Options::default(), &TextBinding::default()).await;
    assert_eq!(result.err(), Some("QUARANTINED"));
}
