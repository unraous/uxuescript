use super::*;

#[test]
fn navigation_and_close_reject_late_authenticated_callbacks() {
    let observer = Observer::default();
    let (epoch, _cancelled) = observer.begin().unwrap();
    let raw = r#"{"status":"authenticated","diagnostic":null}"#;
    assert_eq!(
        parse_current(&observer, epoch, raw).unwrap().status,
        AuthenticationStatus::Authenticated
    );
    observer.cancel();
    assert_eq!(
        parse_current(&observer, epoch, raw).unwrap_err(),
        "DOCUMENT_CHANGED"
    );
    let (next, _cancelled) = observer.begin().unwrap();
    observer.close();
    assert_eq!(
        parse_current(&observer, next, raw).unwrap_err(),
        "DOCUMENT_CHANGED"
    );
}

#[test]
fn page_or_adapter_status_cannot_substitute_for_authentication() {
    let observer = Observer::default();
    let (epoch, _cancelled) = observer.begin().unwrap();
    for raw in [
        r#"{"phase":"ready"}"#,
        r#"{"sessionState":"valid"}"#,
        r#"{"status":"unexpected"}"#,
    ] {
        assert_eq!(
            parse_current(&observer, epoch, raw).unwrap_err(),
            "INVALID_AUTH_RESPONSE"
        );
    }
    for status in ["checking", "unauthenticated", "unknown"] {
        let raw = format!(r#"{{"status":"{status}","diagnostic":null}}"#);
        assert_ne!(
            parse_current(&observer, epoch, &raw).unwrap().status,
            AuthenticationStatus::Authenticated
        );
    }
}
