mod answers;
mod chat;
mod gemini;
mod media;
mod pool;
mod responses;

use super::AnswerItem;
use crate::config::{
    general::GeneralConfig,
    llm::{LLMProtocol, LLMProvider},
};
use crate::core::quiz::Question;
use answers::AnswerError;
use anyhow::{Context, Result};
use pool::RequestPool;
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue};
use std::sync::Arc;

/// LLM 求解入口分发器
pub async fn solve(
    provider: &LLMProvider,
    questions: Vec<Question>,
    settings: GeneralConfig,
) -> Result<Vec<AnswerItem>> {
    let chosen_model = provider
        .chosen_model
        .and_then(|idx| provider.models.get(idx))
        .ok_or_else(|| anyhow::anyhow!("未为提供商 [{}] 选择有效模型", provider.name))?;

    log::debug!(
        "将使用 [{}] 提供商模型 [{}] 进行推理 (题目总数: {}, 分组大小: {}, 最大并发: {})",
        provider.name,
        chosen_model,
        questions.len(),
        settings.batch_size,
        settings.concurrency
    );

    if questions.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(concat!("uXueScript/", env!("CARGO_PKG_VERSION")))
        .default_headers(HeaderMap::from_iter([(
            ACCEPT,
            HeaderValue::from_static("application/json"),
        )]))
        .build()?;
    let pool = Arc::new(RequestPool::new(settings.concurrency.get() as usize));
    let mut handles = Vec::new();

    for chunk in questions.chunks(settings.batch_size.get() as usize) {
        let client = client.clone();
        let provider = provider.clone();
        let model = chosen_model.to_string();
        let chunk = chunk.to_vec();
        let pool = pool.clone();

        handles.push(tokio::spawn(async move {
            solve_batch(&client, &provider, &model, &chunk, &pool)
                .await
                .with_context(|| {
                    format!(
                        "题号 {}–{} 求解失败，未提交答案",
                        chunk[0].id,
                        chunk[chunk.len() - 1].id
                    )
                })
        }));
    }

    let mut all_answers = Vec::with_capacity(questions.len());
    let mut failures = Vec::new();
    for handle in handles {
        match handle.await? {
            Ok(answers) => all_answers.extend(answers),
            Err(error) => failures.push(format!("{error:#}")),
        }
    }
    if !failures.is_empty() {
        anyhow::bail!(
            "成功求解 {} 题，失败 {} 批；本次未回填或提交。{}",
            all_answers.len(),
            failures.len(),
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
    let images = media::load(questions).await?;
    for attempt in 0..=MAX_RETRIES {
        let result = match provider.protocol {
            LLMProtocol::OpenAIChatCompletions => {
                chat::solve(client, provider, model, questions, &images, pool).await
            }
            LLMProtocol::OpenAIResponses => {
                responses::solve(client, provider, model, questions, &images, pool).await
            }
            LLMProtocol::GoogleGemini => {
                gemini::solve(client, provider, model, questions, &images, pool).await
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
