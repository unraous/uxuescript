use super::*;

#[test]
fn distinguishes_specific_codes_and_falls_back_to_status() {
    assert!(hint(StatusCode::TOO_MANY_REQUESTS, Some("insufficient_quota")).contains("额度不足"));
    assert!(hint(StatusCode::TOO_MANY_REQUESTS, Some("rate_limit_exceeded")).contains("请求频率"));
    assert!(hint(StatusCode::BAD_REQUEST, Some("context_length_exceeded")).contains("每批题数"));
    assert!(hint(StatusCode::BAD_REQUEST, Some("1301")).contains("服务商拒绝了请求"));
    assert!(hint(StatusCode::IM_A_TEAPOT, None).contains("服务商的错误信息"));
}
