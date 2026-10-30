use super::*;
use crate::core::quiz::llm::dispatcher::batch;
use crate::core::quiz::{Entry, Folio, Question};

#[test]
#[ignore = "手动查看组装后的提示词"]
fn preview_folio_prompt() {
    let mut folio: Folio =
        serde_json::from_str(include_str!("../../../../../assets/course-page/folio.json")).unwrap();
    folio.context.course = Some("外刊精读".into());
    folio.context.chapter = Some("城市与自然".into());

    for (index, batch) in batch::prepare(folio, 5).unwrap().iter().enumerate() {
        let prompt = assemble(batch, vec![]).unwrap();
        println!(
            "\n===== 第 {} 批：系统提示词 =====\n{}",
            index + 1,
            prompt.system
        );
        println!("\n===== 第 {} 批：用户内容 =====", index + 1);
        for part in prompt.parts {
            match part {
                Part::Text(text) => println!("{text}"),
                Part::Image(image) => {
                    println!("[图片：{} {}，{}]", image.owner, image.marker, image.mime)
                }
            }
        }
    }
}

#[test]
fn selects_detailed_rules_only_for_present_types_in_fixed_order() {
    let kinds = [
        "单选题",
        "多选题",
        "判断题",
        "填空题",
        "分录题",
        "简答题",
        "论述题",
        "计算题",
        "句子翻译题",
        "连线题",
    ];
    for (index, kind) in kinds.iter().enumerate() {
        let folio = Folio {
            entries: vec![Entry::Question(Question {
                id: "1".into(),
                kind: (*kind).into(),
                stem: "题干".into(),
                options: vec![],
                images: vec![],
                blank_count: (kind.contains("填空") || kind.contains("分录")).then_some(10),
            })],
            ..Default::default()
        };
        let batches = batch::prepare(folio, 5).unwrap();
        let text = instructions(&batches[0]).unwrap();
        for (rule_index, (_, rule)) in RULES.iter().enumerate() {
            assert_eq!(
                text.contains(rule.lines().next().unwrap()),
                index == rule_index
            );
        }
        assert!(text.contains("示例输入："));
        assert!(text.contains("示例输出："));
    }
}

#[test]
fn mixed_batches_deduplicate_rules_and_keep_order_independent_of_question_order() {
    let entries: Vec<_> = ["句子翻译题", "单选题", "填空题", "单选题"]
        .iter()
        .enumerate()
        .map(|(index, kind)| {
            Entry::Question(Question {
                id: index.to_string(),
                kind: (*kind).into(),
                stem: "题干".into(),
                options: vec![],
                images: vec![],
                blank_count: kind.contains("填空").then_some(10),
            })
        })
        .collect();
    let mut reversed = entries.clone();
    reversed.reverse();
    let first = batch::prepare(
        Folio {
            entries,
            ..Default::default()
        },
        5,
    )
    .unwrap();
    let second = batch::prepare(
        Folio {
            entries: reversed,
            ..Default::default()
        },
        5,
    )
    .unwrap();
    let text = instructions(&first[0]).unwrap();
    assert_eq!(text, instructions(&second[0]).unwrap());
    assert_eq!(text.matches("【单选题】").count(), 1);
    assert!(text.find("【单选题】").unwrap() < text.find("【填空题】").unwrap());
    assert!(text.find("【填空题】").unwrap() < text.find("【翻译题】").unwrap());
    assert!(!text.contains("【多选题】"));
}

#[test]
fn orders_context_material_images_questions_and_question_images_with_stable_prefixes() {
    let mut folio: Folio =
        serde_json::from_str(include_str!("../../../../../assets/course-page/folio.json")).unwrap();
    folio.context.course = Some("外刊精读".into());
    folio.context.chapter = Some("城市与自然".into());
    let mut batches = batch::prepare(folio, 2).unwrap();
    let image = |owner: &str| Image {
        owner: owner.into(),
        marker: "图片1".into(),
        mime: "image/png".into(),
        data: "AQID".into(),
    };
    batches[1].materials[0]
        .images
        .push(crate::core::quiz::QuestionImage {
            marker: "图片1".into(),
            url: "https://p.cldisk.com/a.png".into(),
        });
    let prompt = assemble(&batches[1], vec![image("材料 p.2.1"), image("题号 2.1")]).unwrap();
    let Part::Text(context) = &prompt.parts[0] else {
        panic!()
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(context).unwrap(),
        json!({"context":{"course":"外刊精读","chapter":"城市与自然"}})
    );
    let Part::Text(material) = &prompt.parts[1] else {
        panic!()
    };
    assert!(material.contains("Why Urban Wildlife"));
    assert!(!material.contains("questions"));
    assert!(matches!(&prompt.parts[3], Part::Image(_)));
    let Part::Text(questions) = &prompt.parts[4] else {
        panic!()
    };
    let questions: serde_json::Value = serde_json::from_str(questions).unwrap();
    assert_eq!(questions["questions"][0]["passages"], json!(["p.2.1"]));
    assert!(matches!(&prompt.parts[6], Part::Image(_)));
    let next = assemble(&batches[2], vec![]).unwrap();
    assert_eq!(prompt.system, next.system);
    let Part::Text(next_material) = &next.parts[1] else {
        panic!()
    };
    assert_eq!(material, next_material);
    let empty = assemble(&batches[0], vec![]).unwrap();
    assert!(empty.system.contains("【填空题】"));
    assert!(!empty.system.contains("【单选题】"));
}
