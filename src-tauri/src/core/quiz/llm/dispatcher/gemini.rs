use super::{
    answers::parse,
    batch::Batch,
    pool::RequestPool,
    prompt::{Part, Prompt},
};
use crate::config::llm::LLMProvider;
use crate::core::quiz::llm::AnswerItem;
use anyhow::Result;

/// Google Gemini :generateContent 接口处理
pub(super) async fn solve(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    batch: &Batch,
    prompt: &Prompt,
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    let mut body: serde_json::Value =
        serde_json::from_str(include_str!("../req_body/google.json"))?;
    let parts: Vec<_> = prompt
        .parts
        .iter()
        .map(|part| match part {
            Part::Text(text) => serde_json::json!({"text": text}),
            Part::Image(image) => {
                serde_json::json!({"inline_data": {"mime_type": image.mime, "data": image.data}})
            }
        })
        .collect();
    body["contents"] = serde_json::json!([{ "parts": parts }]);
    body["systemInstruction"] = serde_json::json!({
        "parts": [{ "text": prompt.system }]
    });

    let url = format!("{}/{}:generateContent", provider.base_url, model);
    let response = pool
        .send(|| {
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

    parse(content, batch.questions.iter().map(|item| &item.question))
}
