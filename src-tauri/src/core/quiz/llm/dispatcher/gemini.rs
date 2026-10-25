use super::{answers::parse, pool::RequestPool};
use crate::config::llm::LLMProvider;
use crate::core::quiz::{
    Question,
    llm::{AnswerItem, SYSTEM_PROMPT},
};
use anyhow::Result;

/// Google Gemini :generateContent 接口处理
pub(super) async fn solve(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    let mut body: serde_json::Value =
        serde_json::from_str(include_str!("../req_body/google.json"))?;
    body["contents"] = serde_json::json!([{
        "parts": [{ "text": serde_json::to_string(questions)? }]
    }]);
    body["systemInstruction"] = serde_json::json!({
        "parts": [{ "text": SYSTEM_PROMPT }]
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
            "Google API 错误 ({}); 响应体已隐藏",
            response.status()
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("无法从 Google 响应提取文本"))?;

    parse(content, questions)
}
