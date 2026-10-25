mod answers;
mod chat;
mod gemini;
mod pool;
mod responses;

use super::AnswerItem;
use crate::config::llm::{LLMProtocol, LLMProvider};
use crate::core::quiz::Question;
use answers::AnswerError;
use anyhow::{Context, Result};
use pool::{MAX_CONCURRENCY, RequestPool};
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue};
use std::sync::Arc;
use std::time::Duration;

const CHUNK_SIZE: usize = 5;
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
    let pool = Arc::new(RequestPool::new());
    let mut handles = Vec::new();

    for chunk in questions.chunks(CHUNK_SIZE) {
        let client = client.clone();
        let provider = provider.clone();
        let model = chosen_model.to_string();
        let question_ids = chunk.iter().map(|question| question.id.clone()).collect::<Vec<_>>();
        let chunk = chunk.to_vec();
        let pool = pool.clone();

        handles.push((
            question_ids,
            tokio::spawn(async move {
                solve_batch(&client, &provider, &model, &chunk, &pool)
                    .await
                    .with_context(|| {
                        format!(
                            "题号 {}–{} 求解失败，未提交答案",
                            chunk[0].id,
                            chunk[chunk.len() - 1].id
                        )
                    })
            }),
        ));
    }

    let mut all_answers = Vec::with_capacity(questions.len());
    let mut failures = Vec::new();
    let mut succeeded_batches = 0usize;
    for (question_ids, handle) in handles {
        match handle.await? {
            Ok(answers) if !answers.is_empty() => {
                succeeded_batches += 1;
                all_answers.extend(answers);
            }
            Ok(_) => {
                failures.push("模型未返回有效答案".to_owned());
                all_answers.extend(question_ids.into_iter().map(|id| AnswerItem {
                    index: id,
                    explanation: "该题生成失败；未提交。请重试或人工处理。".to_owned(),
                    content: String::new(),
                }));
            }
            Err(error) => {
                failures.push(format!("{error:#}"));
                all_answers.extend(question_ids.into_iter().map(|id| AnswerItem {
                    index: id,
                    explanation: "该题生成失败；未提交。请重试或人工处理。".to_owned(),
                    content: String::new(),
                }));
            }
        }
    }

    if succeeded_batches == 0 {
        anyhow::bail!(
            "所有批次均失败，本次未回填或提交。{}",
            failures.join("；")
        );
    }

    Ok(all_answers)
}

/// 只重新请求格式错误的批次，已成功批次留在原任务结果中。
async fn solve_batch(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    const MAX_RETRIES: u32 = 2;
    for attempt in 0..=MAX_RETRIES {
        let result = match provider.protocol {
            LLMProtocol::OpenAIChatCompletions => {
                chat::solve(client, provider, model, questions, pool).await
            }
            LLMProtocol::OpenAIResponses => {
                responses::solve(client, provider, model, questions, pool).await
            }
            LLMProtocol::GoogleGemini => {
                gemini::solve(client, provider, model, questions, pool).await
            }
        };
        match result {
            Err(error) if error.is::<AnswerError>() && attempt < MAX_RETRIES => {
                log::warn!(
                    "题号 {}–{} 的批次{}，重试 {}/{}",
                    questions[0].id,
                    questions[questions.len() - 1].id,
                    error,
                    attempt + 1,
                    MAX_RETRIES
                );
            }
            result => return result,
        }
    }
    unreachable!("最后一次求解直接返回结果")
}

#[cfg(test)]
#[path = "../../../../tests/unit/core/quiz/llm/dispatcher.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../../tests/live/core/quiz/llm/dispatcher.rs"]
mod live_tests;
