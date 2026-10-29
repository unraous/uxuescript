use super::*;
use crate::config::llm::ApiKey;
use crate::test_support::http::{response, serve};
use serde_json::json;
use tokio::time::{Duration, Instant};

async fn solve(
    provider: &LLMProvider,
    questions: Vec<Question>,
) -> anyhow::Result<Vec<AnswerItem>> {
    super::solve(provider, questions, Default::default()).await
}

fn questions(count: usize) -> Vec<Question> {
    (1..=count)
        .map(|index| Question {
            id: index.to_string(),
            kind: "single".into(),
            stem: "Choose A".into(),
            options: vec!["A".into()],
            images: Vec::new(),
        })
        .collect()
}

#[tokio::test]
async fn retries_only_invalid_batches_and_preserves_successes() {
    use crate::test_support::http::serve_sequence;
    // 第二批格式错误时，第一批已经成功；重试只请求第二批。
    let valid = |ids: &[usize]| {
        response(
            &LLMProtocol::OpenAIChatCompletions,
            json!({"answers": ids.iter().map(|id| json!({"index":id.to_string(),"explanation":"mock","content":"A"})).collect::<Vec<_>>()}),
        )
    };
    let invalid = json!({"choices":[{"message":{"content":"invalid JSON"}}]}).to_string();
    let (url, requests) = serve_sequence(vec![
        (200, valid(&[1, 2, 3, 4, 5])),
        (200, invalid),
        (200, valid(&[6])),
    ])
    .await;
    let mut provider = crate::config::llm::LLMConfig::default()
        .providers
        .into_inner()
        .remove("bigmodel")
        .unwrap();
    provider.base_url = url;
    let answers = solve(&provider, questions(6)).await.unwrap();
    assert_eq!(answers.len(), 6);
    let requests = requests.await.unwrap();
    let ids: Vec<Vec<String>> = requests
        .iter()
        .map(|request| {
            assert_eq!(request.body["response_format"]["type"], "json_object");
            assert!(
                request.body["messages"][0]["content"]
                    .as_str()
                    .unwrap()
                    .contains("answers")
            );
            serde_json::from_str::<Vec<Question>>(
                request.body["messages"][1]["content"].as_str().unwrap(),
            )
            .unwrap()
            .into_iter()
            .map(|question| question.id)
            .collect()
        })
        .collect();
    assert_eq!(
        ids,
        vec![vec!["1", "2", "3", "4", "5"], vec!["6"], vec!["6"]]
    );
}

#[tokio::test]
async fn invalid_json_retries_are_bounded_and_rejections_are_not_retried() {
    use crate::test_support::http::serve_sequence;
    let invalid = json!({"choices":[{"message":{"content":"invalid JSON"}}]}).to_string();
    let (url, requests) = serve_sequence(vec![(200, invalid.clone()); 3]).await;
    let mut provider = crate::config::llm::LLMConfig::default()
        .providers
        .into_inner()
        .remove("bigmodel")
        .unwrap();
    provider.base_url = url;
    let error = solve(&provider, questions(1)).await.unwrap_err();
    assert!(error.to_string().contains("失败 1 批"));
    assert_eq!(requests.await.unwrap().len(), 3);

    let (url, request) = serve(
        400,
        json!({"error":{"code":"1301","message":"内容审核拒绝"}}).to_string(),
    )
    .await;
    provider.base_url = url;
    let error = solve(&provider, questions(1)).await.unwrap_err();
    assert!(error.to_string().contains("1301"));
    request.await.unwrap();
}

#[tokio::test]
async fn rate_limit_retries_then_accepts_valid_answers() {
    use crate::test_support::http::serve_sequence;
    let (url, requests) = serve_sequence(vec![
        (
            429,
            json!({"error":{"code":"1302","message":"rate limited"}}).to_string(),
        ),
        (
            200,
            response(
                &LLMProtocol::OpenAIChatCompletions,
                json!([{"index":"1","explanation":"mock","content":"A"}]),
            ),
        ),
    ])
    .await;
    let mut provider = crate::config::llm::LLMConfig::default()
        .providers
        .into_inner()
        .remove("bigmodel")
        .unwrap();
    provider.base_url = url;
    let pool = RequestPool::new(10);
    let started = Instant::now();
    assert_eq!(
        solve_batch(
            &reqwest::Client::new(),
            &provider,
            &provider.models[0],
            &questions(1),
            &pool
        )
        .await
        .unwrap()[0]
            .content,
        "A"
    );
    assert!(started.elapsed() >= Duration::from_secs(1));
    assert_eq!(requests.await.unwrap().len(), 2);
}

#[tokio::test]
async fn preset_chat_requests_preserve_options_and_read_answer_arrays() {
    for (id, path, model, thinking) in [
        (
            "bailian",
            "/compatible-mode/v1/chat/completions",
            "qwen3.8-flash",
            Some(false),
        ),
        (
            "siliconflow",
            "/v1/chat/completions",
            "deepseek-ai/DeepSeek-V4.1-Flash",
            None,
        ),
    ] {
        let mut provider = crate::config::llm::LLMConfig::default()
            .providers
            .into_inner()
            .remove(id)
            .unwrap();
        let body = response(
            &provider.protocol,
            json!([{"index":"1","explanation":"mock","content":"A"}]),
        );
        let (url, request) = serve(200, body).await;
        let preset_path = tauri::Url::parse(&provider.base_url)
            .unwrap()
            .path()
            .to_owned();
        provider.base_url = format!("{url}{preset_path}");
        provider.api_key = Some(ApiKey::new("mock-api-key".into()).unwrap());

        let answers = solve(
            &provider,
            vec![Question {
                id: "1".into(),
                kind: "single".into(),
                stem: "Choose A".into(),
                options: vec!["A".into()],
                images: Vec::new(),
            }],
        )
        .await
        .unwrap();
        let request = request.await.unwrap();
        assert!(request.head.starts_with(&format!("POST {path} ")));
        assert_eq!(request.headers["authorization"], "Bearer mock-api-key");
        assert_eq!(request.body["model"], model);
        assert_eq!(
            request
                .body
                .get("enable_thinking")
                .and_then(serde_json::Value::as_bool),
            thinking
        );
        assert_eq!(request.body["stream"], false);
        assert!(request.body.get("extra_body").is_none());
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].content, "A");
    }
}

#[tokio::test]
async fn sends_protocol_requests_with_application_headers() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let body = response(
            &protocol,
            json!([{"index":"1","explanation":"mock","content":"A"}]),
        );
        let (url, request) = serve(200, body).await;
        let path = match protocol {
            LLMProtocol::OpenAIChatCompletions => "/v1/chat/completions",
            LLMProtocol::OpenAIResponses => "/v1/responses",
            LLMProtocol::GoogleGemini => "/models",
        };
        let provider = LLMProvider {
            name: "Local mock".into(),
            is_custom: true,
            protocol,
            base_url: format!("{url}{path}"),
            api_key: Some(ApiKey::new("mock-api-key".into()).unwrap()),
            models: vec!["mock-model".into()],
            chosen_model: Some(0),
            extra_body: None,
        };
        let answers = solve(
            &provider,
            vec![Question {
                id: "1".into(),
                kind: "???".into(),
                stem: "?? A".into(),
                options: vec!["A".into()],
                images: Vec::new(),
            }],
        )
        .await
        .unwrap();
        let request = request.await.unwrap();
        let head = request.head;
        let headers = request.headers;
        let body = request.body;
        assert_eq!(
            headers["user-agent"],
            concat!("uXueScript/", env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(headers["accept"], "application/json");
        assert_eq!(headers["content-type"], "application/json");
        assert!(!headers.contains_key("accept-language"));
        match provider.protocol {
            LLMProtocol::OpenAIChatCompletions => {
                assert!(head.starts_with("POST /v1/chat/completions "));
                assert_eq!(headers["authorization"], "Bearer mock-api-key");
                assert_eq!(body["model"], "mock-model");
                assert!(body["messages"].is_array());
            }
            LLMProtocol::OpenAIResponses => {
                assert!(head.starts_with("POST /v1/responses "));
                assert_eq!(headers["authorization"], "Bearer mock-api-key");
                assert_eq!(body["model"], "mock-model");
                assert!(body["input"].is_string());
            }
            LLMProtocol::GoogleGemini => {
                assert!(head.starts_with("POST /models/mock-model:generateContent "));
                assert_eq!(headers["x-goog-api-key"], "mock-api-key");
                assert!(body["contents"].is_array());
            }
        }
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].index, "1");
        assert_eq!(answers[0].content, "A");
    }
}

#[tokio::test]
async fn sends_images_in_each_protocol_native_format() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let body = response(
            &protocol,
            json!([{"index":"1","explanation":"mock","content":"A"}]),
        );
        let (url, request) = serve(200, body).await;
        let provider = LLMProvider {
            name: "Image mock".into(),
            is_custom: true,
            protocol: protocol.clone(),
            base_url: url,
            api_key: None,
            models: vec!["vision-model".into()],
            chosen_model: Some(0),
            extra_body: None,
        };
        let input = questions(1);
        let images = vec![media::Image {
            question_id: "1".into(),
            marker: "图片1".into(),
            mime: "image/png".into(),
            data: "AQID".into(),
        }];
        let pool = RequestPool::new(10);
        match protocol {
            LLMProtocol::OpenAIChatCompletions => {
                chat::solve(
                    &reqwest::Client::new(),
                    &provider,
                    "vision-model",
                    &input,
                    &images,
                    &pool,
                )
                .await
                .unwrap();
            }
            LLMProtocol::OpenAIResponses => {
                responses::solve(
                    &reqwest::Client::new(),
                    &provider,
                    "vision-model",
                    &input,
                    &images,
                    &pool,
                )
                .await
                .unwrap();
            }
            LLMProtocol::GoogleGemini => {
                gemini::solve(
                    &reqwest::Client::new(),
                    &provider,
                    "vision-model",
                    &input,
                    &images,
                    &pool,
                )
                .await
                .unwrap();
            }
        }
        let body = request.await.unwrap().body;
        match protocol {
            LLMProtocol::OpenAIChatCompletions => {
                let content = body["messages"][1]["content"].as_array().unwrap();
                assert_eq!(content[1]["text"], "题号 1 的 [图片1]");
                assert_eq!(content[2]["image_url"]["url"], "data:image/png;base64,AQID");
            }
            LLMProtocol::OpenAIResponses => {
                let content = body["input"][0]["content"].as_array().unwrap();
                assert_eq!(content[1]["text"], "题号 1 的 [图片1]");
                assert_eq!(content[2]["image_url"], "data:image/png;base64,AQID");
            }
            LLMProtocol::GoogleGemini => {
                let parts = body["contents"][0]["parts"].as_array().unwrap();
                assert_eq!(parts[1]["text"], "题号 1 的 [图片1]");
                assert_eq!(parts[2]["inline_data"]["mime_type"], "image/png");
                assert_eq!(parts[2]["inline_data"]["data"], "AQID");
            }
        }
    }
}

#[tokio::test]
async fn general_config_controls_batch_size() {
    use crate::test_support::http::serve_sequence;
    let replies = [vec![1, 2], vec![3]].into_iter().map(|ids| {
        (200, response(&LLMProtocol::OpenAIChatCompletions,
            json!({"answers": ids.iter().map(|id| json!({"index":id.to_string(),"explanation":"mock","content":"A"})).collect::<Vec<_>>()})))
    }).collect();
    let (url, requests) = serve_sequence(replies).await;
    let mut provider = crate::config::llm::LLMConfig::default()
        .providers
        .into_inner()
        .remove("bigmodel")
        .unwrap();
    provider.base_url = url;
    let settings = crate::config::general::GeneralConfig {
        concurrency: std::num::NonZeroU32::new(1).unwrap(),
        batch_size: std::num::NonZeroU32::new(2).unwrap(),
        ..Default::default()
    };
    let answers = super::solve(&provider, questions(3), settings)
        .await
        .unwrap();
    assert_eq!(answers.len(), 3);
    let sizes: Vec<usize> = requests
        .await
        .unwrap()
        .iter()
        .map(|request| {
            serde_json::from_str::<Vec<Question>>(
                request.body["messages"][1]["content"].as_str().unwrap(),
            )
            .unwrap()
            .len()
        })
        .collect();
    assert_eq!(sizes, vec![2, 1]);
}
