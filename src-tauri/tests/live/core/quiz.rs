use super::*;

#[tokio::test]
#[ignore = "requires network and BIGMODEL_API_KEY"]
async fn test_solve_payload_integration() {
    dotenv::dotenv().ok();
    let api_key =
        std::env::var("BIGMODEL_API_KEY").expect("请在 .env 文件或环境变量中设置 BIGMODEL_API_KEY");

    let payload = QuestionPayload {
        questions: serde_json::from_str(include_str!("../../assets/course-page/questions.json"))
            .unwrap(),
        font: Some(include_bytes!("../../assets/course-page/cxs-font.ttf").to_vec()),
    };
    let decrypted = decrypt(payload);
    assert!(!decrypted.is_empty(), "解密后的题目列表不应为空");

    let mut provider = CONFIG
        .llm
        .providers
        .lock()
        .get("bigmodel")
        .cloned()
        .unwrap();
    provider.api_key = Some(crate::config::llm::ApiKey::new(api_key).unwrap());

    println!("正在使用内存局部配置变量调用 BigModel 求解器...");
    match llm::solve(&provider, decrypted, Default::default()).await {
        Ok(answers) => {
            assert!(!answers.is_empty(), "返回的答案列表不应为空");
            for (i, item) in answers.iter().enumerate() {
                println!("[{}] 题号: {}, 答案: {}", i + 1, item.index, item.content);
                println!("    解析: {}", item.explanation);
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("429") || err_msg.contains("速率限制") {
                println!(
                    "BigModel 题目集成测试跳过 (触发 API 速率限制 429): {}",
                    err_msg
                );
            } else {
                panic!("无状态局部求解器执行测试失败: {}", e);
            }
        }
    }
}
