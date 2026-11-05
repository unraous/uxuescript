mod answers;
mod batch;
mod media;
mod pool;
mod prompt;
mod protocol;

use crate::config::{general::GeneralConfig, llm::LLMProvider};
use crate::core::quiz::Folio;
use answers::AnswerError;
use anyhow::{Context, Result};
use batch::Batch;
use pool::RequestPool;
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct AnswerItem {
    pub index: String,
    pub explanation: String,
    pub content: String,
}

/// 按配置分批求解整份卷面。
pub async fn solve(
    provider: &LLMProvider,
    folio: Folio,
    settings: GeneralConfig,
) -> Result<Vec<AnswerItem>> {
    let chosen_model = provider
        .chosen_model
        .and_then(|idx| provider.models.get(idx))
        .ok_or_else(|| anyhow::anyhow!("未为提供商 [{}] 选择有效模型", provider.name))?;

    let batches = batch::prepare(folio, settings.batch_size.get() as usize)?;
    let question_count: usize = batches.iter().map(|batch| batch.questions.len()).sum();
    log::debug!(
        "将使用 [{}] 提供商模型 [{}] 进行推理 (题目总数: {}, 分组大小: {}, 最大并发: {})",
        provider.name,
        chosen_model,
        question_count,
        settings.batch_size,
        settings.concurrency
    );

    let client = reqwest::Client::builder()
        .user_agent(concat!("uXueScript/", env!("CARGO_PKG_VERSION")))
        .default_headers(HeaderMap::from_iter([(
            ACCEPT,
            HeaderValue::from_static("application/json"),
        )]))
        .build()?;
    let pool = Arc::new(RequestPool::new(settings.concurrency.get() as usize));
    let mut handles = Vec::new();

    for chunk in batches {
        let client = client.clone();
        let provider = provider.clone();
        let model = chosen_model.to_string();
        let pool = pool.clone();

        handles.push(tokio::spawn(async move {
            solve_batch(&client, &provider, &model, &chunk, &pool)
                .await
                .with_context(|| {
                    format!(
                        "题号 {}–{} 求解失败，未提交答案",
                        chunk.questions[0].question.data.id,
                        chunk.questions[chunk.questions.len() - 1].question.data.id
                    )
                })
        }));
    }

    let mut all_answers = Vec::with_capacity(question_count);
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
    batch: &Batch,
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    const MAX_RETRIES: u32 = 2;
    let prompt = prompt::build(batch).await?;
    for attempt in 0..=MAX_RETRIES {
        let result = protocol::solve(client, provider, model, batch, &prompt, pool).await;
        match result {
            Err(error) if error.is::<AnswerError>() && attempt < MAX_RETRIES => {
                log::warn!(
                    "题号 {}–{} 的批次{}，重试 {}/{}",
                    batch.questions[0].question.data.id,
                    batch.questions[batch.questions.len() - 1].question.data.id,
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
#[path = "../../../tests/unit/core/quiz/llm.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../tests/live/core/quiz/llm.rs"]
mod live_tests;
