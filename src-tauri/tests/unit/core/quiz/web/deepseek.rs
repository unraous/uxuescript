use super::*;
use serde_json::{Value, json};

fn folio() -> Folio {
    let mut folio: Folio =
        serde_json::from_str(include_str!("../../../../assets/course-page/folio.json")).unwrap();
    folio.context.course = Some("外刊精读".into());
    folio.context.title = Some("纯文本练习".into());
    folio
}

fn answer(questions: &[Value]) -> Generation {
    let answers: Vec<_> = questions
        .iter()
        .rev()
        .map(|question| {
            let content = match question["blank_count"].as_u64() {
                Some(count) => vec!["word"; count as usize].join(";"),
                None => "A".into(),
            };
            json!({"index": question["id"], "explanation": "mock", "content": content})
        })
        .collect();
    completed(json!(answers).to_string())
}

fn completed(content: String) -> Generation {
    Generation::Completed {
        request_id: "local-test".into(),
        content,
        duration_ms: 1,
    }
}

#[tokio::test]
async fn text_pipeline_preserves_materials_and_restores_answer_order() {
    let mut sent = Vec::new();
    let answers = solve_with(folio(), 2, |text| {
        assert!(text.starts_with("你是答题助手"));
        assert!(!text.contains('\r'));
        assert!(text.contains("不输出 Markdown 代码块"));
        let parts: Vec<Value> = text
            .split("\n\n")
            .filter_map(|part| serde_json::from_str(part).ok())
            .collect();
        assert_eq!(parts[0]["context"]["course"], "外刊精读");
        let questions = parts.last().unwrap()["questions"].as_array().unwrap();
        for question in questions {
            for id in question["passages"].as_array().unwrap() {
                assert!(parts.iter().any(|part| {
                    part["passage"]["id"] == *id
                        && part["passage"]["text"]
                            .as_str()
                            .is_some_and(|text| !text.is_empty())
                }));
            }
        }
        let result = answer(questions);
        sent.push(parts);
        std::future::ready(Ok(result))
    })
    .await
    .unwrap();
    assert_eq!(sent.len(), 8);
    assert_eq!(
        answers
            .iter()
            .map(|answer| answer.index.as_str())
            .collect::<Vec<_>>(),
        [
            "1", "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "3.4", "3.5", "4"
        ]
    );
    assert_eq!(answers[0].content.split(';').count(), 10);
}

#[tokio::test]
async fn invalid_or_uncertain_batch_stops_without_retry_or_partial_answers() {
    let uncertain: Generation = serde_json::from_value(json!({
        "status": "uncertain", "requestId": "local-test", "durationMs": 1,
        "error": {"code": "SEND_UNCERTAIN", "message": "private upstream detail", "stage": "sending",
            "delivery": "unknown", "remote": "unknown", "retryable": true, "diagnostics": {}}
    })).unwrap();
    for result in [completed("```json\n[]\n```".into()), uncertain] {
        let mut second = Some(result);
        let mut calls = 0;
        let error = solve_with(folio(), 2, |_text| {
            calls += 1;
            std::future::ready(Ok(if calls == 1 {
                completed(json!([{"index":"1", "explanation":"mock", "content":vec!["word";10].join(";")}]).to_string())
            } else {
                second.take().unwrap()
            }))
        })
        .await
        .unwrap_err()
        .to_string();
        assert_eq!(calls, 2);
        assert!(error.contains("未返回部分答案"), "{error}");
        assert!(
            error.contains("INVALID_ANSWER") || error.contains("SEND_UNCERTAIN"),
            "{error}"
        );
        assert!(!error.contains("private upstream detail"));
        if error.contains("SEND_UNCERTAIN") {
            assert!(
                error.contains("status=uncertain delivery=unknown remote=unknown quarantined=true"),
                "{error}"
            );
        }
    }
}

#[tokio::test]
async fn whole_folio_preflight_rejects_late_images_and_unsupported_types_before_send() {
    let image = crate::core::quiz::QuestionImage {
        marker: "图片1".into(),
        url: "https://example.invalid/image.png".into(),
    };
    let mut question_image = folio();
    let Entry::Section(section) = question_image.entries.last_mut().unwrap() else {
        panic!("section expected")
    };
    let Entry::Question(question) = section.entries.last_mut().unwrap() else {
        panic!("question expected")
    };
    question.images.push(image.clone());
    let mut material_image = folio();
    material_image
        .entries
        .push(Entry::Section(crate::core::quiz::folio::Section {
            title: "空材料组仍不可丢图".into(),
            passage: Some(crate::core::quiz::folio::Passage {
                text: "材料".into(),
                images: vec![image],
            }),
            entries: Vec::new(),
        }));
    let mut unsupported = folio();
    let Entry::Section(section) = unsupported.entries.last_mut().unwrap() else {
        panic!("section expected")
    };
    let Entry::Question(question) = section.entries.last_mut().unwrap() else {
        panic!("question expected")
    };
    question.data.kind = "未知题型".into();
    for (input, expected) in [
        (question_image, "UNSUPPORTED_IMAGES"),
        (material_image, "UNSUPPORTED_IMAGES"),
        (unsupported, "尚未支持"),
    ] {
        let mut calls = 0;
        let error = solve_with(input, 2, |_text| {
            calls += 1;
            std::future::ready(Ok(completed("[]".into())))
        })
        .await
        .unwrap_err();
        assert_eq!(calls, 0);
        assert!(error.to_string().contains(expected), "{error}");
    }
}
