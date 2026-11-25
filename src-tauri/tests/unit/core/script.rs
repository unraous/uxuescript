#[test]
fn embeds_the_deepseek_adapter_embedded_iife() {
    let script = include_script!("deepseek-web-adapter.js");
    assert!(!script.trim().is_empty());
    assert!(script.contains("DeepSeekWebAdapter"));
}
