use super::*;
use crate::core::quiz::folio::Passage;

fn archived() -> Folio {
    serde_json::from_str(include_str!("../../../../../assets/course-page/folio.json")).unwrap()
}

#[test]
fn splits_reading_groups_without_losing_material_or_renumbering_questions() {
    let batches = prepare(archived(), 2).unwrap();
    assert_eq!(
        batches
            .iter()
            .map(|b| b.questions.len())
            .collect::<Vec<_>>(),
        [1, 2, 2, 1, 2, 2, 1, 1]
    );
    assert_eq!(batches[0].questions[0].question.blank_count, Some(10));
    let mut ids = Vec::new();
    for batch in &batches {
        for item in &batch.questions {
            ids.push(item.question.id.as_str());
        }
    }
    assert_eq!(
        ids,
        [
            "1", "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "3.4", "3.5", "4"
        ]
    );
    assert!(batches[0].materials.is_empty());
    assert_eq!(batches[1].questions[0].question.id, "2.1");
    assert_eq!(batches[2].questions[0].question.id, "2.3");
    assert_eq!(batches[1].materials[0].id, batches[2].materials[0].id);
    assert_eq!(batches[1].materials[0].text, batches[2].materials[0].text);
    assert_ne!(batches[1].materials[0].id, batches[4].materials[0].id);
    for batch in &batches[1..7] {
        assert_eq!(batch.materials.len(), 1);
        for item in &batch.questions {
            assert_eq!(item.passages, vec![batch.materials[0].id.clone()]);
        }
    }
}

#[test]
fn includes_outer_and_inner_material_once_per_batch() {
    // 人工给真实归档包一层材料，仅验证模型的递归能力；没有对应的真实页面样本。
    let mut folio = archived();
    folio.entries = vec![Entry::Section(Section {
        title: "共同要求".into(),
        passage: Some(Passage {
            text: "外层材料".into(),
            images: vec![],
        }),
        entries: folio.entries,
    })];
    let batches = prepare(folio, 5).unwrap();
    assert_eq!(batches[1].materials.len(), 2);
    assert_eq!(batches[1].materials[0].text, "外层材料");
    assert!(batches[1].materials[1].text.contains("Why Urban Wildlife"));
    assert_eq!(batches[1].questions[0].passages.len(), 2);
}

#[test]
fn rejects_missing_blank_counts_and_duplicate_ids_before_requests() {
    for kind in ["填空题", "分录题"] {
        let mut folio = archived();
        let Entry::Section(section) = &mut folio.entries[0] else {
            panic!()
        };
        let Entry::Question(question) = &mut section.entries[0] else {
            panic!()
        };
        question.kind = kind.into();
        question.blank_count = None;
        assert!(
            prepare(folio, 5)
                .err()
                .unwrap()
                .to_string()
                .contains("空数")
        );
    }
    let mut folio = archived();
    folio.entries.push(folio.entries[0].clone());
    assert!(
        prepare(folio, 5)
            .err()
            .unwrap()
            .to_string()
            .contains("重复")
    );
}
