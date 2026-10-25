use super::*;

#[test]
fn test_api_key_display_is_fully_redacted() {
    let key = ApiKey::new("sk-1234567890abcdef".to_string()).unwrap();

    assert_eq!(key.to_string(), "***REDACTED***");
    assert_eq!(format!("{:?}", key), "ApiKey(***REDACTED***)");
}

#[test]
fn test_api_key_rejects_too_short_value() {
    assert_eq!(
        ApiKey::new("12345678".to_owned()).unwrap_err().to_string(),
        "API Key 长度不能少于 12 个字符"
    );
}

#[test]
fn test_api_key_serialization_is_protected_and_round_trips() {
    let key = ApiKey::new("secret-value".to_string()).unwrap();

    let encoded = serde_json::to_string(&key).unwrap();
    assert!(encoded.starts_with("\"dpapi:v1:"), "{encoded}");
    let decoded: ApiKey = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, key);
    assert_eq!(
        serde_json::from_str::<ApiKey>("\"secret-value\"").unwrap(),
        key
    );
}

#[test]
fn test_llm_default_config_preset_providers() {
    let config = LLMConfig::default();
    assert_eq!(*config.active_provider.lock(), "bigmodel");

    let providers = config.providers.lock();
    let expected_online_providers = [
        ("bailian", "Bailian", LLMProtocol::OpenAIChatCompletions),
        ("bigmodel", "BigModel", LLMProtocol::OpenAIChatCompletions),
        ("deepseek", "DeepSeek", LLMProtocol::OpenAIChatCompletions),
        ("google", "Google", LLMProtocol::GoogleGemini),
        ("moonshot", "Moonshot", LLMProtocol::OpenAIChatCompletions),
        ("openai", "OpenAI", LLMProtocol::OpenAIResponses),
        (
            "openrouter",
            "OpenRouter",
            LLMProtocol::OpenAIChatCompletions,
        ),
        (
            "siliconflow",
            "SiliconFlow",
            LLMProtocol::OpenAIChatCompletions,
        ),
    ];

    for (id, expected_name, expected_protocol) in expected_online_providers {
        let provider = providers
            .get(id)
            .unwrap_or_else(|| panic!("默认预设必须包含提供商: {}", id));
        assert_eq!(provider.name, expected_name);
        assert_eq!(provider.protocol, expected_protocol);
        assert!(
            provider.base_url.starts_with("https://"),
            "提供商 {} 的 URL 必须以 https:// 开头: {}",
            id,
            provider.base_url
        );
        assert!(
            !provider.models.is_empty(),
            "提供商 {} 的支持模型列表不能为空",
            id
        );
        let chosen_idx = provider
            .chosen_model
            .unwrap_or_else(|| panic!("提供商 {} 必须有默认选中的模型索引", id));
        assert!(
            chosen_idx < provider.models.len(),
            "提供商 {} 的选择索引超出范围: {} >= {}",
            id,
            chosen_idx,
            provider.models.len()
        );
    }
}

#[test]
fn test_llm_provider_uses_camel_case_serialization() {
    let provider = LLMConfig::default()
        .providers
        .lock()
        .get("bigmodel")
        .cloned()
        .unwrap();

    let value = serde_json::to_value(provider).unwrap();
    assert!(value.get("isCustom").is_some());
    assert!(value.get("baseUrl").is_some());
    assert!(value.get("apiKey").is_some());
    assert!(value.get("chosenModel").is_some());
    assert!(value.get("is_custom").is_none());
}
