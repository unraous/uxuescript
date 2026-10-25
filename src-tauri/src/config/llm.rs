pub(crate) mod ollama;

use anyhow::{bail, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use specta::Type;
use std::collections::HashMap;
use std::fmt;

/// API 密钥。
///
/// 落盘时使用 Windows DPAPI（当前用户）加密；旧明文可读取一次并在下次保存迁移。
/// Display/Debug 始终完全脱敏。
#[derive(Clone, PartialEq, Eq, Type)]
pub struct ApiKey(String);

const MIN_API_KEY_LENGTH: usize = 12;

impl Serialize for ApiKey {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let protected =
            crate::secret_store::protect(&self.0).map_err(serde::ser::Error::custom)?;
        serializer.serialize_str(&protected)
    }
}

impl<'de> Deserialize<'de> for ApiKey {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let plain =
            crate::secret_store::unprotect(&value).map_err(serde::de::Error::custom)?;
        Ok(Self(plain))
    }
}

impl ApiKey {
    pub fn new(value: String) -> Result<Self> {
        let value = value.trim();

        if !value.is_ascii() {
            bail!("API Key 必须为 ASCII 字符");
        }

        if value.len() < MIN_API_KEY_LENGTH {
            bail!("API Key 长度不能少于 12 个字符");
        }

        Ok(Self(value.to_owned()))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "***REDACTED***")
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ApiKey(***REDACTED***)")
    }
}

/// 支持的大模型 API 发包协议族
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash, Type)]
pub enum LLMProtocol {
    OpenAIChatCompletions, // 通用 OpenAI 兼容协议 (Chat Completions)
    OpenAIResponses,       // OpenAI Responses 特殊协议 (/v1/responses)
    GoogleGemini,          // Google Gemini 协议 (:generateContent)
}

/// 统一的大模型提供商结构体（内置与用户自定义提供商通用纯数据 DTO）
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct LLMProvider {
    pub name: String,            // 提供商显示名称 (如 "DeepSeek 官方", "我的私有中转站")
    pub is_custom: bool,         // 是否为用户自定义的提供商
    pub protocol: LLMProtocol,   // 采用的 API 协议族
    pub base_url: String,        // 接口基础 URL
    pub api_key: Option<ApiKey>, // API Key (Option 允许免 Key / 未配置)
    pub models: Vec<String>,     // 支持的模型列表
    #[specta(type = Option<u32>)]
    pub chosen_model: Option<usize>, // 当前选择的模型在 models 列表中的索引
    #[serde(default)]
    #[specta(skip)]
    pub extra_body: Option<serde_json::Value>, // 协议特定额外 Body 参数 (如 temperature, stream)
}

#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub name: String,
    pub is_custom: bool,
    pub protocol: LLMProtocol,
    pub base_url: String,
    pub models: Vec<String>,
    #[specta(type = Option<u32>)]
    pub chosen_model: Option<usize>,
    pub has_key: bool,
}

impl From<&LLMProvider> for ProviderView {
    fn from(provider: &LLMProvider) -> Self {
        Self {
            name: provider.name.clone(),
            is_custom: provider.is_custom,
            protocol: provider.protocol.clone(),
            base_url: provider.base_url.clone(),
            models: provider.models.clone(),
            chosen_model: provider.chosen_model,
            has_key: provider.api_key.is_some(),
        }
    }
}

/// 应用全局大语言模型配置
#[derive(Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct LLMConfig {
    pub active_provider: Mutex<String>,
    pub providers: Mutex<HashMap<String, LLMProvider>>,
}

impl Default for LLMConfig {
    fn default() -> Self {
        let providers: HashMap<String, LLMProvider> =
            serde_json::from_str(include_str!("./llm/providers.default.json"))
                .expect("无法解析默认 LLM 提供商预设配置文件 (providers.default.json)");

        Self {
            active_provider: Mutex::new("bigmodel".to_string()),
            providers: Mutex::new(providers),
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/config/llm.rs"]
mod tests;
