use super::{
    answers::parse,
    batch::Batch,
    pool::RequestPool,
    prompt::{Part, Prompt},
};
use crate::config::llm::LLMProvider;
use crate::core::quiz::llm::AnswerItem;
use anyhow::Result;

/// OpenAI /v1/responses 接口处理
pub(super) async fn solve(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    batch: &Batch,
    prompt: &Prompt,
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    let mut request_body: serde_json::Value =
        serde_json::from_str(include_str!("../req_body/openai.json"))?;
    request_body["model"] = serde_json::json!(model);
    request_body["instructions"] = serde_json::json!(format!(
        "{}\n本次输出遵循 JSON Schema，将答案数组放在 answers 字段中。",
        prompt.system
    ));
    let content: Vec<_> = prompt
        .parts
        .iter()
        .map(|part| match part {
            Part::Text(text) => serde_json::json!({"type": "input_text", "text": text}),
            Part::Image(image) => {
                serde_json::json!({"type": "input_image", "image_url": image.data_url()})
            }
        })
        .collect();
    request_body["input"] = serde_json::json!([{ "role": "user", "content": content }]);

    let response = pool
        .send(|| {
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

    parse(content, batch.questions.iter().map(|item| &item.question))
}
