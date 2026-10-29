use super::*;

#[test]
fn strict_answers_validate_ids_content_and_restore_order() {
    let questions: Vec<Question> = (1..=2)
        .map(|id| Question {
            id: id.to_string(),
            kind: "单选题".into(),
            stem: "Choose A".into(),
            options: vec!["A".into()],
            images: Vec::new(),
            blank_count: None,
        })
        .collect();
    let answers = parse(r#"{"answers":[{"index":"2","explanation":"","content":"B"},{"index":"1","explanation":"","content":"A"}]}"#, &questions).unwrap();
    assert_eq!(answers[0].index, "1");
    assert_eq!(answers[1].content, "B");
    for text in [
        r#"[{"index":"1","explanation":"unescaped "quote"","content":"A"}]"#,
        r#"[{"index":"1","explanation":"","content":"A"}]"#,
        r#"[{"index":"1","explanation":"","content":"A"},{"index":"1","explanation":"","content":"A"}]"#,
        r#"[{"index":"1","explanation":"","content":"A"},{"index":"3","explanation":"","content":"A"}]"#,
        r#"[{"index":"1","explanation":"","content":"A"},{"index":"2","explanation":"","content":" "}]"#,
    ] {
        assert!(parse(text, &questions).unwrap_err().is::<AnswerError>());
    }
}

#[test]
fn completion_requires_exactly_ten_nonempty_values() {
    let question = Question {
        id: "1".into(),
        kind: "填空题".into(),
        stem: "十空段落匹配".into(),
        options: vec![],
        images: vec![],
        blank_count: Some(10),
    };
    let output = |content: &str| {
        serde_json::json!([
            {"index":"1", "explanation":"", "content":content}
        ])
        .to_string()
    };
    let valid = "B;H;C;E;D;G;I;F;J;A";
    assert_eq!(
        parse(&output(valid), [&question]).unwrap()[0].content,
        valid
    );
    for content in [
        "B;H;C;E;D;G;I;F;J",
        "B;H;C;E;D;G;I;F;J;A;B",
        "B;H;C;E;D;G;I;F;J; ",
        "B；H；C；E；D；G；I；F；J；A",
    ] {
        assert!(
            parse(&output(content), [&question])
                .unwrap_err()
                .is::<AnswerError>()
        );
    }
}
