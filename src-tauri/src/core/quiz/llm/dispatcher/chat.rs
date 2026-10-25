use super::{answers::parse, pool::RequestPool};
use crate::config::llm::LLMProvider;
use crate::core::quiz::{
    Question,
    llm::{AnswerItem, SYSTEM_PROMPT},
};
use anyhow::Result;

/// 通用 OpenAI ChatCompletions 接口处理
pub(super) async fn solve(
    client: &reqwest::Client,
    provider: &LLMProvider,
    model: &str,
    questions: &[Question],
    pool: &RequestPool,
) -> Result<Vec<AnswerItem>> {
    let mut request_body: serde_json::Value =
        serde_json::from_str(include_str!("../req_body/default.json"))?;
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

    if request_body
        .pointer("/response_format/type")
        .and_then(|value| value.as_str())
        == Some("json_object")
    {
        request_body["messages"][0]["content"] = serde_json::json!(format!(
            "{SYSTEM_PROMPT}\n本次使用 JSON 对象模式：将输出数组放在 answers 字段中，只返回 {{\"answers\": [...]}} 对象。"
        ));
    }

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
            "{} API 错误 ({}); 响应体已隐藏",
            provider.name,
            response.status()
        );
    }

    let data: serde_json::Value = response.json().await?;
    let content = data
        .pointer("/choices/0/message/content")
        .or_else(|| data.pointer("/message/content"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("无法从 {} 响应提取文本", provider.name))?;

    parse(content, questions)
}
