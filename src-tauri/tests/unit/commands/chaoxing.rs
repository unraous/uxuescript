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
    let _lock = CONFIG_LOCK.lock().await;
    let id = "__healthy_test__".to_owned();
    let previous_id = std::mem::replace(&mut *CONFIG.llm.active_provider.lock(), id.clone());
    let previous_provider = CONFIG
        .llm
        .providers
        .lock()
        .insert(id.clone(), provider.clone());
    let result = action.await;
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
        super::solve_questions(Folio {
            entries: questions.into_iter().map(Entry::Question).collect(),
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    assert_eq!(result.len(), 3);
    assert_eq!(result[0].index, "406063260");
    assert_eq!(result[2].content, "新时代的重大意义。");
    let request = request.await.unwrap();
    assert_eq!(request.body["model"], "probe-model");
    let sent: Value = input_questions(&request.body);
    assert_eq!(sent, input);
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
    let result = probe_with(&provider(protocol, url), super::solve_questions(payload))
        .await
        .unwrap();
    assert_eq!(result.len(), 5);
    let request = request.await.unwrap();
    let sent: Value = input_questions(&request.body);
    assert_eq!(sent, serde_json::to_value(expected).unwrap());
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
