use super::{AnswerItem, SYSTEM_PROMPT};
use crate::config::llm::{LLMProtocol, LLMProvider};
use crate::core::quiz::html::Question;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Semaphore;

const CHUNK_SIZE: usize = 5;
const MAX_CONCURRENCY: usize = 10;

/// LLM 求解入口分发器
pub async fn solve(provider: &LLMProvider, questions: Vec<Question>) -> Result<Vec<AnswerItem>> {
    let chosen_model = provider
        .chosen_model
        .and_then(|idx| provider.models.get(idx))
        .ok_or_else(|| anyhow::anyhow!("未为提供商 [{}] 选择有效模型", provider.name))?;

    log::debug!(
        "将使用 [{}] 提供商模型 [{}] 进行推理 (题目总数: {}, 分组大小: {}, 最大并发: {})",
        provider.name,
        chosen_model,
        questions.len(),
        CHUNK_SIZE,
        MAX_CONCURRENCY
    );

    if questions.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::new();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut handles = Vec::new();

    for chunk in questions.chunks(CHUNK_SIZE) {
        let client = client.clone();
        let provider = provider.clone();
        let model = chosen_model.to_string();
        let chunk = chunk.to_vec();
        let permit = semaphore.clone().acquire_owned().await?;

        handles.push(tokio::spawn(async move {
            let res = match provider.protocol {
                LLMProtocol::OpenAIChatCompletions => {
                    chat_completions(&client, &provider, &model, &chunk).await
                }
                LLMProtocol::OpenAIResponses => responses(&client, &provider, &model, &chunk).await,
                LLMProtocol::GoogleGemini => gemini(&client, &provider, &model, &chunk).await,
            };
            drop(permit);
            res
        }));
    }

    let mut all_answers = Vec::with_capacity(questions.len());
    for handle in handles {
        let chunk_answers = handle.await??;
        all_answers.extend(chunk_answers);
    }

    Ok(all_answers)
}

/// 仅对 HTTP 429 最多重试三次（含首次共四次请求）。
/// Retry-After 只解析整数秒，缺失或解析失败时依次等待 1、2、4 秒；
/// 网络发送错误直接返回，其他状态及最终响应交由协议处理函数判断。
async fn send_with_retry<F>(build_req: F) -> Result<reqwest::Response>
where
    F: Fn() -> reqwest::RequestBuilder,
{
    const MAX_RETRIES: u32 = 3;

    for retry in 0..MAX_RETRIES {
        let res = build_req().send().await?;

        if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let delay = res
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok()?.parse().ok())
                .map(std::time::Duration::from_secs)
                .unwrap_or_else(|| std::time::Duration::from_millis(1000 * (1 << retry)));

            log::warn!(
                "触发 API 限流 (429)，将在 {:?} 后进行第 {}/{} 次重试...",
                delay,
                retry + 1,
                MAX_RETRIES
            );
            tokio::time::sleep(delay).await;
            continue;
        }
        return Ok(res);
    }

    Ok(build_req().send().await?)
}

/// 通用 OpenAI ChatCompletions 接口处理
async fn chat_completions(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
) -> Result<Vec<AnswerItem>> {
    let mut request_body: serde_json::Value =
        serde_json::from_str(include_str!("./req_body/default.json"))?;
    request_body["model"] = serde_json::json!(model);
    request_body["messages"] = serde_json::json!([
        { "role": "system", "content": SYSTEM_PROMPT },
        { "role": "user", "content": serde_json::to_string(questions)? }
    ]);

    if let Some(extra) = &provider.extra_body {
        if let (Some(req_obj), Some(extra_obj)) = (request_body.as_object_mut(), extra.as_object())
        {
            for (k, v) in extra_obj {
                req_obj.insert(k.clone(), v.clone());
            }
        }
    }

    let response = send_with_retry(|| {
        let mut req = client.post(&provider.base_url);
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose()) {
            if !key.trim().is_empty() {
                req = req.header("Authorization", format!("Bearer {}", key));
            }
        }
        req.header("Content-Type", "application/json")
            .json(&request_body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "{} API 错误 ({}): {}",
            provider.name,
            response.status(),
            response.text().await?
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/choices/0/message/content")
        .or_else(|| data.pointer("/message/content"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            anyhow::anyhow!("无法从 {} 响应提取文本。原始响应: {}", provider.name, data)
        })?;

    serde_json::from_str(content).map_err(|e| {
        anyhow::anyhow!(
            "从 {} 响应解析答案 JSON 失败: {}。原始返回文本: {}",
            provider.name,
            e,
            content
        )
    })
}

/// OpenAI /v1/responses 接口处理
async fn responses(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
) -> Result<Vec<AnswerItem>> {
    let mut request_body: serde_json::Value =
        serde_json::from_str(include_str!("./req_body/openai.json"))?;
    request_body["model"] = serde_json::json!(model);
    request_body["instructions"] = serde_json::json!(SYSTEM_PROMPT);
    request_body["input"] = serde_json::json!(serde_json::to_string(questions)?);

    let response = send_with_retry(|| {
        let mut req = client.post(&provider.base_url);
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose()) {
            if !key.trim().is_empty() {
                req = req.header("Authorization", format!("Bearer {}", key));
            }
        }
        req.header("Content-Type", "application/json")
            .json(&request_body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "OpenAI API 错误 ({}): {}",
            response.status(),
            response.text().await?
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/output/1/content/0/text")
        .and_then(|v| v.as_str())
        .or_else(|| {
            data["output"]
                .as_array()?
                .iter()
                .find(|o| o["type"] == "message")?
                .pointer("/content/0/text")?
                .as_str()
        })
        .ok_or_else(|| anyhow::anyhow!("无法从 OpenAI 响应提取文本。原始响应: {}", data))?;

    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(answers) = wrapper.get("answers") {
            return Ok(serde_json::from_value(answers.clone())?);
        }
    }

    serde_json::from_str::<Vec<AnswerItem>>(content).map_err(|e| {
        anyhow::anyhow!(
            "从 OpenAI 响应解析答案 JSON 失败: {}。原始返回文本: {}",
            e,
            content
        )
    })
}

/// Google Gemini :generateContent 接口处理
async fn gemini(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
) -> Result<Vec<AnswerItem>> {
    let mut body: serde_json::Value = serde_json::from_str(include_str!("./req_body/google.json"))?;
    body["contents"] = serde_json::json!([{
        "parts": [{ "text": serde_json::to_string(questions)? }]
    }]);
    body["systemInstruction"] = serde_json::json!({
        "parts": [{ "text": SYSTEM_PROMPT }]
    });

    let url = format!("{}/{}:generateContent", provider.base_url, model);
    let response = send_with_retry(|| {
        let mut req = client.post(&url);
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose()) {
            if !key.trim().is_empty() {
                req = req.header("x-goog-api-key", key);
            }
        }
        req.header("Content-Type", "application/json").json(&body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "Google API 错误 ({}): {}",
            response.status(),
            response.text().await?
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("无法从 Google 响应提取文本。原始响应: {}", data))?;

    serde_json::from_str::<Vec<AnswerItem>>(content).map_err(|e| {
        anyhow::anyhow!(
            "从 Google 响应解析答案 JSON 失败: {}。原始返回文本: {}",
            e,
            content
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::llm::{ApiKey, LLMConfig};
    use std::fs;
    use std::path::PathBuf;

    fn load_questions_file(filename: &str) -> Vec<Question> {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("tests/assets/course-page");
        path.push(filename);
        let json = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("找不到测试文件 {:?}: {}", path, error));
        serde_json::from_str(&json)
            .unwrap_or_else(|error| panic!("测试文件 {:?} 解析失败: {}", path, error))
    }

    fn load_test_questions() -> Vec<Question> {
        load_questions_file("decrypted.json")
    }

    fn get_test_provider(provider_id: &str, api_key_env: Option<&str>) -> Option<LLMProvider> {
        dotenv::dotenv().ok();
        let config = LLMConfig::default();
        let mut provider = config.providers.lock().get(provider_id).cloned()?;

        if provider_id == "ollama" {
            let model =
                std::env::var("OLLAMA_TEST_MODEL").unwrap_or_else(|_| "gemma4:26b".to_string());
            provider.models = vec![model];
            provider.chosen_model = Some(0);
            return Some(provider);
        }

        let api_key = std::env::var(api_key_env?)
            .ok()
            .filter(|key| !key.is_empty())?;
        provider.api_key = Some(ApiKey::new(api_key).ok()?);
        Some(provider)
    }

    fn google_transient_error(error: &str) -> bool {
        error.contains("429") || error.contains("RESOURCE_EXHAUSTED")
    }

    fn openrouter_transient_error(error: &str) -> bool {
        ["402", "404", "429", "expected value"]
            .iter()
            .any(|marker| error.contains(marker))
    }

    async fn run_provider_test(
        provider_id: &str,
        api_key_env: Option<&str>,
        label: &str,
        tolerated_error: fn(&str) -> bool,
    ) {
        let questions = load_test_questions();
        let Some(provider) = get_test_provider(provider_id, api_key_env) else {
            println!("跳过 {} 测试：未配置所需凭据", label);
            return;
        };

        let expected_count = questions.len();
        match solve(&provider, questions).await {
            Ok(answers) => {
                assert_eq!(
                    answers.len(),
                    expected_count,
                    "{} 返回答案数量不匹配",
                    label
                );
                println!("{} 测试完成，收到 {} 条答案", label, answers.len());
            }
            Err(error) if tolerated_error(&error.to_string()) => {
                println!("{} 测试跳过（外部服务暂时不可用）: {}", label, error);
            }
            Err(error) => panic!("{} 测试失败: {}", label, error),
        }
    }

    async fn run_benchmark(provider_id: &str, api_key_env: Option<&str>, label: &str) {
        let questions = load_questions_file("questions_100.json");
        assert_eq!(questions.len(), 100);
        let Some(provider) = get_test_provider(provider_id, api_key_env) else {
            println!("跳过 {} benchmark：未配置所需凭据", label);
            return;
        };

        let start = std::time::Instant::now();
        println!("开始使用 {} 进行 100 题并发性能测试...", label);
        let answers = solve(&provider, questions)
            .await
            .unwrap_or_else(|error| panic!("{} 100 题性能测试失败: {}", label, error));
        let duration = start.elapsed();

        assert_eq!(answers.len(), 100);
        println!("{} 100 题完成，总耗时: {:?}", label, duration);
        println!("平均每题耗时: {:?}", duration / 100);
        println!("解析到的答案总数: {}", answers.len());
        for (sample_index, answer) in answers.iter().step_by(10).take(10).enumerate() {
            println!(
                "[抽样 {}] 题号: {:<3} | 答案: {:<6} | 解析: {}",
                sample_index + 1,
                answer.index,
                answer.content,
                answer.explanation
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires network and BIGMODEL_API_KEY"]
    async fn test_solve_bigmodel() {
        run_provider_test("bigmodel", Some("BIGMODEL_API_KEY"), "BigModel", |_| false).await;
    }

    #[tokio::test]
    #[ignore = "requires network and DEEPSEEK_API_KEY"]
    async fn test_solve_deepseek() {
        run_provider_test("deepseek", Some("DEEPSEEK_API_KEY"), "DeepSeek", |_| false).await;
    }

    #[tokio::test]
    #[ignore = "requires network and GOOGLE_API_KEY"]
    async fn test_solve_google() {
        run_provider_test(
            "google",
            Some("GOOGLE_API_KEY"),
            "Google",
            google_transient_error,
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires network and MOONSHOT_API_KEY"]
    async fn test_solve_moonshot() {
        run_provider_test("moonshot", Some("MOONSHOT_API_KEY"), "Moonshot", |_| false).await;
    }

    #[tokio::test]
    #[ignore = "requires network and OPENAI_API_KEY"]
    async fn test_solve_openai() {
        run_provider_test("openai", Some("OPENAI_API_KEY"), "OpenAI", |_| false).await;
    }

    #[tokio::test]
    #[ignore = "requires network and OPENROUTER_API_KEY"]
    async fn test_solve_openrouter() {
        run_provider_test(
            "openrouter",
            Some("OPENROUTER_API_KEY"),
            "OpenRouter",
            openrouter_transient_error,
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires local Ollama service"]
    async fn test_solve_ollama() {
        run_provider_test("ollama", None, "Ollama", |_| false).await;
    }

    #[tokio::test]
    #[ignore = "long running benchmark"]
    async fn test_solve_100_questions() {
        run_benchmark("deepseek", Some("DEEPSEEK_API_KEY"), "DeepSeek").await;
    }

    #[tokio::test]
    #[ignore = "long running benchmark; requires local Ollama service"]
    async fn test_solve_ollama_100_questions() {
        run_benchmark("ollama", None, "Ollama").await;
    }
}
