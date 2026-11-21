use super::DEEPSEEK_ADAPTER_SCRIPT;

#[test]
fn embeds_the_deepseek_adapter_iife() {
    assert!(!DEEPSEEK_ADAPTER_SCRIPT.trim().is_empty());
    assert!(DEEPSEEK_ADAPTER_SCRIPT.contains("DeepSeekWebAdapter"));
}
