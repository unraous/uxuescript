use super::{AnswerItem, SYSTEM_PROMPT};
use crate::config::llm::{LLMProtocol, LLMProvider};
use crate::core::quiz::html::Question;

use anyhow::Result;
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const CHUNK_SIZE: usize = 5;
const MAX_CONCURRENCY: usize = 10;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

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

    let client = reqwest::Client::builder()
        .user_agent(concat!("uXueScript/", env!("CARGO_PKG_VERSION")))
        .timeout(REQUEST_TIMEOUT)
        .default_headers(HeaderMap::from_iter([(
            ACCEPT,
            HeaderValue::from_static("application/json"),
        )]))
        .build()?;
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut handles = Vec::new();

    for chunk in questions.chunks(CHUNK_SIZE) {
        let client = client.clone();
        let provider = provider.clone();
        let model = chosen_model.to_string();
        let question_ids = chunk.iter().map(|question| question.id.clone()).collect::<Vec<_>>();
        let chunk = chunk.to_vec();
        let permit = semaphore.clone().acquire_owned().await?;

        handles.push((
            question_ids,
            tokio::spawn(async move {
                let res = match provider.protocol {
                    LLMProtocol::OpenAIChatCompletions => {
                        chat_completions(&client, &provider, &model, &chunk).await
                    }
                    LLMProtocol::OpenAIResponses => {
                        responses(&client, &provider, &model, &chunk).await
                    }
                    LLMProtocol::GoogleGemini => {
                        gemini(&client, &provider, &model, &chunk).await
                    }
                };
                drop(permit);
                res
            }),
        ));
    }

    let mut all_answers = Vec::with_capacity(questions.len());
    let mut succeeded = 0usize;
    let mut first_error: Option<String> = None;
    for (question_ids, handle) in handles {
        match handle.await {
            Ok(Ok(chunk_answers)) if chunk_answers.is_empty() => {
                if first_error.is_none() {
                    first_error = Some("模型实际返回 0 道答案".to_owned());
                }
                log::warn!(
                    "一批题目返回 0 道答案（题目数 {}），保留其他批次结果",
                    question_ids.len()
                );
                all_answers.extend(question_ids.into_iter().map(|id| AnswerItem {
                    index: id,
                    explanation: "该题生成失败；未提交。请重试或人工处理。".to_owned(),
                    content: String::new(),
                }));
            }
            Ok(Ok(chunk_answers)) => {
                succeeded += 1;
                all_answers.extend(chunk_answers);
            }
            Ok(Err(error)) => {
                if first_error.is_none() {
                    first_error = Some(error.to_string());
                }
                // Keep successful batches; mark only this batch as unavailable.
                // Never auto-submit a partial or empty result.
                log::warn!(
                    "一批题目生成失败（题目数 {}），保留其他批次结果",
                    question_ids.len()
                );
                all_answers.extend(question_ids.into_iter().map(|id| AnswerItem {
                    index: id,
                    explanation: "该题生成失败；未提交。请重试或人工处理。".to_owned(),
                    content: String::new(),
                }));
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error.to_string());
                }
                log::warn!(
                    "一批题目生成任务异常（题目数 {}），保留其他批次结果",
                    question_ids.len()
                );
                all_answers.extend(question_ids.into_iter().map(|id| AnswerItem {
                    index: id,
                    explanation: "该题生成失败；未提交。请重试或人工处理。".to_owned(),
                    content: String::new(),
                }));
            }
        }
    }

    if succeeded == 0 {
        return Err(anyhow::anyhow!(
            "{}",
            first_error.unwrap_or_else(|| "所有题目生成失败".to_owned())
        ));
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

    if let Some(extra) = &provider.extra_body
        && let (Some(req_obj), Some(extra_obj)) = (request_body.as_object_mut(), extra.as_object())
    {
        for (k, v) in extra_obj {
            req_obj.insert(k.clone(), v.clone());
        }
    }

    let response = send_with_retry(|| {
        let mut req = client.post(&provider.base_url);
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose())
            && !key.trim().is_empty()
        {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
        req.header("Content-Type", "application/json")
            .json(&request_body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "{} API 返回 HTTP {}（响应体已隐藏）",
            provider.name,
            response.status()
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/choices/0/message/content")
        .or_else(|| data.pointer("/message/content"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("{} 响应未包含答案文本", provider.name))?;

    serde_json::from_str(content)
        .map_err(|_| anyhow::anyhow!("{} 响应无法解析为答案 JSON", provider.name))
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
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose())
            && !key.trim().is_empty()
        {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
        req.header("Content-Type", "application/json")
            .json(&request_body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "OpenAI API 返回 HTTP {}（响应体已隐藏）",
            response.status()
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
        .ok_or_else(|| anyhow::anyhow!("OpenAI 响应未包含答案文本"))?;

    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(content)
        && let Some(answers) = wrapper.get("answers")
    {
        return Ok(serde_json::from_value(answers.clone())?);
    }

    serde_json::from_str::<Vec<AnswerItem>>(content)
        .map_err(|_| anyhow::anyhow!("OpenAI 响应无法解析为答案 JSON"))
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
        if let Some(key) = provider.api_key.as_ref().map(|key| key.expose())
            && !key.trim().is_empty()
        {
            req = req.header("x-goog-api-key", key);
        }
        req.header("Content-Type", "application/json").json(&body)
    })
    .await?;

    if !response.status().is_success() {
        anyhow::bail!(
            "Google API 返回 HTTP {}（响应体已隐藏）",
            response.status()
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Google 响应未包含答案文本"))?;

    serde_json::from_str::<Vec<AnswerItem>>(content)
        .map_err(|_| anyhow::anyhow!("Google 响应无法解析为答案 JSON"))
}

#[cfg(test)]
#[path = "../../../../tests/unit/core/quiz/llm/dispatcher.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../../tests/live/core/quiz/llm/dispatcher.rs"]
mod live_tests;
