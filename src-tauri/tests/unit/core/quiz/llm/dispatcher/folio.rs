use super::*;
use crate::test_support::http::serve_sequence;

#[tokio::test]
async fn all_protocols_preserve_archived_context_material_references_and_blank_count() {
    for protocol in [
        LLMProtocol::OpenAIChatCompletions,
        LLMProtocol::OpenAIResponses,
        LLMProtocol::GoogleGemini,
    ] {
        let mut folio: Folio =
            serde_json::from_str(include_str!("../../../../../assets/course-page/folio.json"))
                .unwrap();
        folio.context.course = Some("外刊精读".into());
        folio.context.chapter = Some("城市与自然".into());
        folio.context.title = Some("期中测试".into());
        let batches = batch::prepare(folio, 2).unwrap();
        for batch in batches {
            let expected: Vec<_> = batch.questions.iter().map(|item| json!({
                "index": item.question.id,
                "content": if item.question.blank_count.is_some() { "B;H;C;E;D;G;I;F;J;A" } else { "A" },
                "explanation": "mock"
            })).collect();
            let mut reversed = expected.clone();
            reversed.reverse();
            let (url, request) = serve(200, response(&protocol, json!(reversed))).await;
            let provider = LLMProvider {
                name: "Folio mock".into(),
                is_custom: true,
                protocol: protocol.clone(),
                base_url: url,
                api_key: None,
                models: vec!["model".into()],
                chosen_model: Some(0),
                extra_body: None,
            };
            let result = solve_batch(
                &reqwest::Client::new(),
                &provider,
                "model",
                &batch,
                &RequestPool::new(1),
            )
            .await
            .unwrap();
            assert_eq!(serde_json::to_value(result).unwrap(), json!(expected));
            let request = request.await.unwrap();
            let (system, parts) = match protocol {
                LLMProtocol::OpenAIChatCompletions => (
                    &request.body["messages"][0]["content"],
                    &request.body["messages"][1]["content"],
                ),
                LLMProtocol::OpenAIResponses => (
                    &request.body["instructions"],
                    &request.body["input"][0]["content"],
                ),
                LLMProtocol::GoogleGemini => (
                    &request.body["systemInstruction"]["parts"][0]["text"],
                    &request.body["contents"][0]["parts"],
                ),
            };
            let blocks: Vec<serde_json::Value> = parts
                .as_array()
                .unwrap()
                .iter()
                .map(|part| serde_json::from_str(part["text"].as_str().unwrap()).unwrap())
                .collect();
            assert_eq!(
                blocks[0],
                json!({"context":{"course":"外刊精读","chapter":"城市与自然","title":"期中测试"}})
            );
            assert_eq!(
                input_questions(&request.body),
                serde_json::to_value(&batch.questions).unwrap()
            );
            assert_eq!(blocks.len(), batch.materials.len() + 2);
            for (material, block) in batch.materials.iter().zip(&blocks[1..]) {
                assert_eq!(block, &json!({"passage":material}));
            }
            let system = system.as_str().unwrap();
            let kind = &batch.questions[0].question.kind;
            for (name, needle) in [
                ("单选", "【单选题】"),
                ("填空", "【填空题】"),
                ("翻译", "【翻译题】"),
            ] {
                assert_eq!(system.contains(needle), kind.contains(name));
            }
            assert!(!system.contains("【连线题】"));
        }
    }
}

#[tokio::test]
async fn retries_wrong_blank_count_without_changing_the_prompt() {
    let mut question = questions(1).remove(0);
    question.kind = "填空题".into();
    question.blank_count = Some(10);
    let protocol = LLMProtocol::OpenAIChatCompletions;
    let output = |content: &str| {
        response(
            &protocol,
            json!([{"index":"1","content":content,"explanation":""}]),
        )
    };
    let (url, requests) = serve_sequence(vec![
        (200, output("B;H;C;E;D;G;I;F;J")),
        (200, output("B;H;C;E;D;G;I;F;J;A")),
    ])
    .await;
    let provider = LLMProvider {
        name: "Folio mock".into(),
        is_custom: true,
        protocol,
        base_url: url,
        api_key: None,
        models: vec!["model".into()],
        chosen_model: Some(0),
        extra_body: None,
    };
    assert_eq!(
        solve(&provider, vec![question]).await.unwrap()[0].content,
        "B;H;C;E;D;G;I;F;J;A"
    );
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].body, requests[1].body);
    assert_eq!(input_questions(&requests[0].body)[0]["blank_count"], 10);
}
