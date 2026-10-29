use super::*;
use crate::config::llm::{ApiKey, LLMConfig};
use std::fs;
use std::path::PathBuf;

async fn solve(provider: &LLMProvider, questions: Vec<Question>) -> anyhow::Result<Vec<AnswerItem>> {
    super::solve(provider, questions, Default::default()).await
}

fn load_questions_file(filename: &str) -> Vec<Question> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/assets/course-page");
    path.push(filename);
    let json = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("找不到测试文件 {:?}: {}", path, error));
    serde_json::from_str(&json)
        .unwrap_or_else(|error| panic!("测试文件 {:?} 解析失败: {}", path, error))
}

fn load_test_questions() -> Vec<Question> {
    load_questions_file("decrypted.json")
}

fn get_test_provider(provider_id: &str, api_key_env: Option<&str>) -> Option<LLMProvider> {
    dotenv::dotenv().ok();
    let config = LLMConfig::default();
    let mut provider = config.providers.lock().get(provider_id).cloned()?;

    if provider_id == "ollama" {
        let model = std::env::var("OLLAMA_TEST_MODEL").unwrap_or_else(|_| "gemma4:26b".to_string());
        provider.models = vec![model];
        provider.chosen_model = Some(0);
        return Some(provider);
    }

    let api_key = std::env::var(api_key_env?)
        .ok()
        .filter(|key| !key.is_empty())?;
    provider.api_key = Some(ApiKey::new(api_key).ok()?);
    Some(provider)
}

fn google_transient_error(error: &str) -> bool {
    error.contains("429") || error.contains("RESOURCE_EXHAUSTED")
}

fn openrouter_transient_error(error: &str) -> bool {
    ["402", "404", "429", "expected value"]
        .iter()
        .any(|marker| error.contains(marker))
}

async fn run_provider_test(
    provider_id: &str,
    api_key_env: Option<&str>,
    label: &str,
    tolerated_error: fn(&str) -> bool,
) {
    let questions = load_test_questions();
    let Some(provider) = get_test_provider(provider_id, api_key_env) else {
        println!("跳过 {} 测试：未配置所需凭据", label);
        return;
    };

    let expected_count = questions.len();
    match solve(&provider, questions).await {
        Ok(answers) => {
            assert_eq!(
                answers.len(),
                expected_count,
                "{} 返回答案数量不匹配",
                label
            );
            println!("{} 测试完成，收到 {} 条答案", label, answers.len());
        }
        Err(error) if tolerated_error(&error.to_string()) => {
            println!("{} 测试跳过（外部服务暂时不可用）: {}", label, error);
        }
        Err(error) => panic!("{} 测试失败: {}", label, error),
    }
}

async fn run_benchmark(provider_id: &str, api_key_env: Option<&str>, label: &str) {
    let questions = load_questions_file("questions_100.json");
    assert_eq!(questions.len(), 100);
    let Some(provider) = get_test_provider(provider_id, api_key_env) else {
        println!("跳过 {} benchmark：未配置所需凭据", label);
        return;
    };

    let start = std::time::Instant::now();
    println!("开始使用 {} 进行 100 题并发性能测试...", label);
    let answers = solve(&provider, questions)
        .await
        .unwrap_or_else(|error| panic!("{} 100 题性能测试失败: {}", label, error));
    let duration = start.elapsed();

    assert_eq!(answers.len(), 100);
    println!("{} 100 题完成，总耗时: {:?}", label, duration);
    println!("平均每题耗时: {:?}", duration / 100);
    println!("解析到的答案总数: {}", answers.len());
    for (sample_index, answer) in answers.iter().step_by(10).take(10).enumerate() {
        println!(
            "[抽样 {}] 题号: {:<3} | 答案: {:<6} | 解析: {}",
            sample_index + 1,
            answer.index,
            answer.content,
            answer.explanation
        );
    }
}

#[tokio::test]
#[ignore = "requires network and DASHSCOPE_API_KEY"]
async fn test_solve_bailian() {
    run_provider_test("bailian", Some("DASHSCOPE_API_KEY"), "Bailian", |_| false).await;
}

#[tokio::test]
#[ignore = "requires network and SILICONFLOW_API_KEY"]
async fn test_solve_siliconflow() {
    run_provider_test(
        "siliconflow",
        Some("SILICONFLOW_API_KEY"),
        "SiliconFlow",
        |_| false,
    )
    .await;
}

#[tokio::test]
#[ignore = "requires network and BIGMODEL_API_KEY"]
async fn test_solve_bigmodel() {
    run_provider_test("bigmodel", Some("BIGMODEL_API_KEY"), "BigModel", |_| false).await;
}

#[tokio::test]
#[ignore = "requires network and DEEPSEEK_API_KEY"]
async fn test_solve_deepseek() {
    run_provider_test("deepseek", Some("DEEPSEEK_API_KEY"), "DeepSeek", |_| false).await;
}

#[tokio::test]
#[ignore = "requires network and GOOGLE_API_KEY"]
async fn test_solve_google() {
    run_provider_test(
        "google",
        Some("GOOGLE_API_KEY"),
        "Google",
        google_transient_error,
    )
    .await;
}

#[tokio::test]
#[ignore = "requires network and MOONSHOT_API_KEY"]
async fn test_solve_moonshot() {
    run_provider_test("moonshot", Some("MOONSHOT_API_KEY"), "Moonshot", |_| false).await;
}

#[tokio::test]
#[ignore = "requires network and OPENAI_API_KEY"]
async fn test_solve_openai() {
    run_provider_test("openai", Some("OPENAI_API_KEY"), "OpenAI", |_| false).await;
}

#[tokio::test]
#[ignore = "requires network and OPENROUTER_API_KEY"]
async fn test_solve_openrouter() {
    run_provider_test(
        "openrouter",
        Some("OPENROUTER_API_KEY"),
        "OpenRouter",
        openrouter_transient_error,
    )
    .await;
}

#[tokio::test]
#[ignore = "requires local Ollama service"]
async fn test_solve_ollama() {
    run_provider_test("ollama", None, "Ollama", |_| false).await;
}

#[tokio::test]
#[ignore = "long running benchmark"]
async fn test_solve_100_questions() {
    run_benchmark("deepseek", Some("DEEPSEEK_API_KEY"), "DeepSeek").await;
}

#[tokio::test]
#[ignore = "long running benchmark; requires local Ollama service"]
async fn test_solve_ollama_100_questions() {
    run_benchmark("ollama", None, "Ollama").await;
}
