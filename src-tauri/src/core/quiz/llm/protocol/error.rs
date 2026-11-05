use crate::config::llm::LLMProvider;
use anyhow::Result;
use reqwest::{Response, StatusCode};

/// 将最终失败响应转换为操作建议，保留服务端内容供排查。
pub(super) async fn check(response: Response, provider: &LLMProvider) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = response.text().await?;
    let code = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|data| data.pointer("/error/code")?.as_str().map(str::to_owned));
    let hint = hint(status, code.as_deref());
    // 上游可能将请求中的密钥写回错误信息，避免将其显示在界面或日志中。
    let body = match provider.api_key.as_ref().map(|key| key.expose()) {
        Some(key) if !key.is_empty() => body.replace(key, "[已隐藏 API Key]"),
        _ => body,
    };
    anyhow::bail!(
        "{} API 请求失败（HTTP {}）：{} 服务端响应：{}",
        provider.name,
        status.as_u16(),
        hint,
        body
    )
}

fn hint(status: StatusCode, code: Option<&str>) -> &'static str {
    match (status.as_u16(), code) {
        (429, Some("insufficient_quota" | "quota_exceeded")) => {
            "账户额度不足，请检查服务商的额度和账单。"
        }
        (400, Some("context_length_exceeded")) => {
            "请求内容超过模型长度限制，请减少每批题数或更换模型。"
        }
        (400, _) | (422, _) => "服务商拒绝了请求，请查看服务端错误信息并检查请求内容与模型配置。",
        (401, _) => "身份验证失败，请检查 API Key。",
        (403, _) => "服务商拒绝访问，请检查账户权限、API Key 和模型权限。",
        (404, _) => "未找到请求的接口或模型，请检查 Endpoint 和模型名称。",
        (408, _) | (504, _) => "服务处理超时，请稍后重试。",
        (413, _) => "请求内容过大，请减少每批题数后重试。",
        (429, _) => "请求受到限制，请稍后重试，并检查账户额度和请求频率。",
        (500..=599, _) => "模型服务暂时无法处理请求，请稍后重试。",
        _ => "模型服务返回错误，请检查服务商的错误信息和接口配置。",
    }
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/error.rs"]
mod tests;
