mod chat;
mod error;
mod gemini;
mod responses;

use super::{batch::Batch, pool::RequestPool, prompt::Prompt};
use crate::config::llm::{LLMProtocol, LLMProvider};
use crate::core::quiz::llm::AnswerItem;
use anyhow::Result;

pub(super) async fn solve(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    batch: &Batch,
    prompt: &Prompt,
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    match provider.protocol {
        LLMProtocol::OpenAIChatCompletions => {
            chat::solve(client, provider, model, batch, prompt, pool).await
        }
        LLMProtocol::OpenAIResponses => {
            responses::solve(client, provider, model, batch, prompt, pool).await
        }
        LLMProtocol::GoogleGemini => {
            gemini::solve(client, provider, model, batch, prompt, pool).await
        }
    }
}
