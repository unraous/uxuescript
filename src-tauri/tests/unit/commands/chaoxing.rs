use super::*;
use crate::config::llm::{LLMProtocol, LLMProvider};
use crate::test_support::http::input_questions;
use crate::test_support::http::{response, serve, serve_sequence};
use serde_json::{Value, json};

static CONFIG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn probe(provider: &LLMProvider) -> CommandsResult<String> {
    probe_with(provider, super::healthy()).await
}

async fn probe_with<T>(
    provider: &LLMProvider,
    action: impl std::future::Future<Output = CommandsResult<T>>,
) -> CommandsResult<T> {
    probe_with_solver(
        Some(provider),
        crate::config::solver::SolverKind::NativeLlm,
        action,
    )
    .await
}

async fn probe_with_solver<T>(
    provider: Option<&LLMProvider>,
    solver: crate::config::solver::SolverKind,
    action: impl std::future::Future<Output = CommandsResult<T>>,
) -> CommandsResult<T> {
    let _lock = CONFIG_LOCK.lock().await;
    let previous_solver = std::mem::replace(&mut *CONFIG.solver.lock(), solver);
    let id = "__healthy_test__".to_owned();
    let previous_id = std::mem::replace(&mut *CONFIG.llm.active_provider.lock(), id.clone());
    let previous_provider = CONFIG.llm.providers.lock().remove(&id);
    if let Some(provider) = provider {
        CONFIG
            .llm
            .providers
            .lock()
            .insert(id.clone(), provider.clone());
    }
    let result = action.await;
    *CONFIG.solver.lock() = previous_solver;
    *CONFIG.llm.active_provider.lock() = previous_id;
    let mut providers = CONFIG.llm.providers.lock();
    if let Some(previous) = previous_provider {
        providers.insert(id, previous);
    } else {
        providers.remove(&id);
    }
    result
}

fn provider(protocol: LLMProtocol, base_url: String) -> LLMProvider {
    LLMProvider {
        name: "Health test".into(),
        is_custom: true,
        protocol,
        base_url,
        api_key: None,
        models: vec!["probe-model".into()],
        chosen_model: Some(0),
        extra_body: None,
    }
}

fn solver_payload() -> Folio {
    let question = serde_json::from_value(json!({
        "id": "1", "kind": "简答题", "stem": "测试题", "options": []
    }))
    .unwrap();
    Folio {
        entries: vec![Entry::Question(question)],
        ..Default::default()
    }
}

#[tokio::test]
async fn solver_commands_update_memory_without_changing_native_configuration() {
    let mut native = provider(
        LLMProtocol::OpenAIChatCompletions,
        "http://127.0.0.1:1".into(),
    );
    native.api_key = Some(crate::config::llm::ApiKey::new("saved-native-key".into()).unwrap());
    let (initial, selected, restored, native_preserved) = probe_with(&native, async {
        let before = serde_json::to_value(&CONFIG.llm).unwrap();
        let initial = crate::commands::config::current_solver();
        crate::commands::config::set_solver(crate::config::solver::SolverKind::DeepSeekWeb);
        let selected = crate::commands::config::current_solver();
        crate::commands::config::set_solver(crate::config::solver::SolverKind::NativeLlm);
        let restored = crate::commands::config::current_solver();
        Ok((
            initial,
            selected,
            restored,
            before == serde_json::to_value(&CONFIG.llm).unwrap(),
        ))
    })
    .await
    .unwrap();
    assert_eq!(initial, crate::config::solver::SolverKind::NativeLlm);
    assert_eq!(selected, crate::config::solver::SolverKind::DeepSeekWeb);
    assert_eq!(restored, crate::config::solver::SolverKind::NativeLlm);
    assert!(native_preserved);
}

#[tokio::test]
async fn web_solver_reports_not_connected_without_native_provider() {
    let error = probe_with_solver(
        None,
        crate::config::solver::SolverKind::DeepSeekWeb,
        super::solve_questions(solver_payload()),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "DeepSeek Web Solver 尚未接入");
}

#[tokio::test]
async fn web_solver_does_not_validate_native_models() {
    for chosen_model in [None, Some(10)] {
        let mut provider = provider(
            LLMProtocol::OpenAIChatCompletions,
            "http://127.0.0.1:1".into(),
        );
        provider.chosen_model = chosen_model;
        let error = probe_with_solver(
            Some(&provider),
            crate::config::solver::SolverKind::DeepSeekWeb,
            super::solve_questions(solver_payload()),
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "DeepSeek Web Solver 尚未接入");
    }
}

#[tokio::test]
async fn web_solver_does_not_send_native_api_requests() {
    let protocol = LLMProtocol::OpenAIChatCompletions;
    let body = response(
        &protocol,
        json!([{"index": "1", "content": "测试答案", "explanation": ""}]),
    );
    let (url, requests) = serve_sequence(vec![(200, body)]).await;
    let result = probe_with_solver(
        Some(&provider(protocol, url)),
        crate::config::solver::SolverKind::DeepSeekWeb,
        super::solve_questions(solver_payload()),
    )
    .await;
    let sent_native_request = requests.is_finished();
    requests.abort();
    assert_eq!(
        result.unwrap_err().to_string(),
        "DeepSeek Web Solver 尚未接入"
    );
    assert!(
        !sent_native_request,
        "Web Solver must not call the Native API"
    );
}

#[tokio::test]
async fn web_solver_reports_not_connected_even_for_an_empty_folio() {
    let error = probe_with_solver(
        None,
        crate::config::solver::SolverKind::DeepSeekWeb,
        super::solve_questions(Folio::default()),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "DeepSeek Web Solver 尚未接入");
}

#[tokio::test]
async fn native_solver_keeps_all_protocols_on_the_solve_questions_entry() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let body = response(
            &protocol,
            json!([{"index": "1", "content": "测试答案", "explanation": ""}]),
        );
        let (url, request) = serve(200, body).await;
        let result = probe_with(
            &provider(protocol, url),
            super::solve_questions(solver_payload()),
        )
        .await
        .unwrap();
        assert_eq!(result[0].content, "测试答案");
        let sent = input_questions(&request.await.unwrap().body);
        assert_eq!(sent[0]["id"], "1");
        assert_eq!(sent[0]["stem"], "测试题");
    }
}

#[tokio::test]
async fn native_solver_keeps_empty_folio_and_provider_validation() {
    for (payload, expected) in [
        (Folio::default(), "题目解析失败"),
        (solver_payload(), "大模型提供商 [__healthy_test__] 不存在"),
    ] {
        let error = probe_with_solver(
            None,
            crate::config::solver::SolverKind::NativeLlm,
            super::solve_questions(payload),
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), expected);
    }
    let mut native = provider(
        LLMProtocol::OpenAIChatCompletions,
        "http://127.0.0.1:1".into(),
    );
    native.chosen_model = None;
    let error = probe_with(&native, super::solve_questions(solver_payload()))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("选择有效模型"));
}

#[tokio::test]
async fn sends_question_payload_to_the_selected_model_without_a_font() {
    let protocol = LLMProtocol::OpenAIChatCompletions;
    let answers = json!([
        {"index": "406063260", "content": "A", "explanation": ""},
        {"index": "406063268", "content": "AC", "explanation": ""},
        {"index": "406063270", "content": "新时代的重大意义。", "explanation": ""}
    ]);
    let (url, request) = serve(200, response(&protocol, answers)).await;
    let input = json!([
        {"id": "406063260", "kind": "单选题", "stem": "普通文本题干", "options": ["A 选项一", "B 选项二"]},
        {"id": "406063268", "kind": "多选题", "stem": "多选题干", "options": ["A 甲", "B 乙", "C 丙"]},
        {"id": "406063270", "kind": "简答题", "stem": "简答题干", "options": []}
    ]);
    let questions: Vec<Question> = serde_json::from_value(input.clone()).unwrap();
    let result = probe_with(
        &provider(protocol, url),
        super::solve_questions(
            Folio {
                entries: questions.into_iter().map(Entry::Question).collect(),
                ..Default::default()
            },
            false,
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.len(), 3);
    assert_eq!(result[0].index, "406063260");
    assert_eq!(result[2].content, "新时代的重大意义。");
    let request = request.await.unwrap();
    assert_eq!(request.body["model"], "probe-model");
    let sent: Value = input_questions(&request.body);
    let mut expected = input;
    for question in expected.as_array_mut().unwrap() {
        question["blank_count"] = Value::Null;
        question["passages"] = json!([]);
    }
    assert_eq!(sent, expected);
}

#[tokio::test]
async fn decrypts_question_payload_before_sending_it_to_the_model() {
    let protocol = LLMProtocol::OpenAIChatCompletions;
    let questions: Vec<Question> =
        serde_json::from_str(include_str!("../../assets/course-page/questions.json")).unwrap();
    let expected: Vec<Question> =
        serde_json::from_str(include_str!("../../assets/course-page/decrypted.json")).unwrap();
    let answers: Vec<_> = (1..=5)
        .map(|index| {
            json!({
                "index": index.to_string(), "content": "A", "explanation": "样本答案"
            })
        })
        .collect();
    let (url, request) = serve(200, response(&protocol, json!(answers))).await;
    let payload = Folio {
        entries: questions.into_iter().map(Entry::Question).collect(),
        font: Some(include_bytes!("../../assets/course-page/cxs-font.ttf").to_vec()),
        ..Default::default()
    };
    let result = probe_with(
        &provider(protocol, url),
        super::solve_questions(payload, false),
    )
    .await
    .unwrap();
    assert_eq!(result.len(), 5);
    let request = request.await.unwrap();
    let sent: Value = input_questions(&request.body);
    let expected: Vec<_> = expected
        .into_iter()
        .map(|question| {
            let mut value = serde_json::to_value(question.data).unwrap();
            value["passages"] = json!([]);
            value
        })
        .collect();
    assert_eq!(sent, json!(expected));
}

#[tokio::test]
async fn probes_all_protocols_with_the_selected_model_and_fixed_question() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let body = response(
            &protocol,
            json!([{"index": "1", "content": "因为大气散射。", "explanation": ""}]),
        );
        let (url, request) = serve(200, body).await;
        let provider = provider(protocol, url);
        assert_eq!(probe(&provider).await.unwrap(), "ok");
        let request = request.await.unwrap();
        let body = request.body;
        match provider.protocol {
            LLMProtocol::OpenAIChatCompletions => {
                assert_eq!(body["model"], "probe-model");
                assert!(body["messages"][1]["content"].is_array());
            }
            LLMProtocol::OpenAIResponses => {
                assert_eq!(body["model"], "probe-model");
                assert!(body["input"].is_array());
            }
            LLMProtocol::GoogleGemini => {
                assert!(
                    request
                        .head
                        .starts_with("POST /probe-model:generateContent ")
                );
                assert!(body["contents"][0]["parts"].is_array());
            }
        };
        let questions = input_questions(&body);
        assert_eq!(questions.as_array().unwrap().len(), 1);
        assert_eq!(questions[0]["stem"], "天空为什么是蓝色的？请用一句话回答。");
    }
}

#[tokio::test]
async fn preserves_http_status_and_upstream_error_details() {
    for (status, message) in [
        (401, "invalid_api_key"),
        (404, "model_not_found"),
        (500, "upstream_unavailable"),
    ] {
        let (url, request) = serve(status, json!({"error": message}).to_string()).await;
        let error = probe(&provider(LLMProtocol::OpenAIChatCompletions, url))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains(&status.to_string()), "{error}");
        assert!(error.contains(message), "{error}");
        request.await.unwrap();
    }
}

#[tokio::test]
async fn reports_friendly_http_errors_for_each_protocol() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let (url, request) = serve(401, "upstream authentication failed".into()).await;
        let error = probe(&provider(protocol, url))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("检查 API Key"), "{error}");
        assert!(error.contains("401"), "{error}");
        assert!(error.contains("upstream authentication failed"), "{error}");
        request.await.unwrap();
    }
}

#[tokio::test]
async fn reports_rejection_without_assuming_its_cause_and_redacts_key() {
    let key = "test-secret-key-123";
    let body =
        json!({"error": {"code": "1301", "message": format!("内容审核拒绝 {key}")}}).to_string();
    let (url, request) = serve(400, body).await;
    let mut provider = provider(LLMProtocol::OpenAIChatCompletions, url);
    provider.api_key = Some(crate::config::llm::ApiKey::new(key.into()).unwrap());
    let error = probe(&provider).await.unwrap_err().to_string();
    assert!(error.contains("服务商拒绝了请求"), "{error}");
    assert!(error.contains("1301"), "{error}");
    assert!(error.contains("内容审核拒绝"), "{error}");
    assert!(error.contains("[已隐藏 API Key]"), "{error}");
    assert!(!error.contains(key), "{error}");
    request.await.unwrap();
}

#[tokio::test]
async fn rejects_empty_and_unparseable_answers() {
    let protocol = LLMProtocol::OpenAIChatCompletions;
    for (body, expected, attempts) in [
        (
            response(&protocol, json!([])),
            "预期 1 题，收到 0 个答案",
            3,
        ),
        (
            response(
                &protocol,
                json!([{"index":"1", "content":" ", "explanation":""}]),
            ),
            "答案为空",
            3,
        ),
        (json!({"choices": []}).to_string(), "无法从", 1),
        (
            response(&protocol, json!("not an answer array")),
            "JSON 解析失败",
            3,
        ),
    ] {
        let (url, requests) = serve_sequence(vec![(200, body); attempts]).await;
        let error = probe(&provider(protocol.clone(), url))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected), "{error}");
        assert_eq!(requests.await.unwrap().len(), attempts);
    }
}

#[tokio::test]
async fn rejects_an_unselected_model_before_sending_a_request() {
    let mut provider = provider(
        LLMProtocol::OpenAIChatCompletions,
        "http://127.0.0.1:1".into(),
    );
    provider.chosen_model = None;
    assert!(
        probe(&provider)
            .await
            .unwrap_err()
            .to_string()
            .contains("选择有效模型")
    );
}
