use super::*;
use serde_json::{Value, json};

const ARCHIVED: &str = include_str!("../../../assets/course-page/folio.json");

fn questions(entries: &[Entry]) -> Vec<&Question> {
    entries
        .iter()
        .flat_map(|entry| match entry {
            Entry::Section(section) => questions(&section.entries),
            Entry::Question(question) => vec![question],
        })
        .collect()
}

#[test]
fn reads_the_same_structured_homework_as_the_dom_parser() {
    let folio: Folio = serde_json::from_str(ARCHIVED).unwrap();
    assert!(folio.font.is_none());
    assert_eq!(folio.entries.len(), 3);
    let leaves = questions(&folio.entries);
    assert_eq!(
        leaves.iter().map(|q| q.id.as_str()).collect::<Vec<_>>(),
        [
            "1", "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "3.4", "3.5", "4"
        ]
    );
    assert_eq!(leaves[0].kind, "填空题");
    assert_eq!(leaves[11].kind, "句子翻译题");
    let Entry::Section(reading) = &folio.entries[1] else {
        panic!("Expected reading section")
    };
    assert!(reading.passage.is_none());
    let Entry::Section(first) = &reading.entries[0] else {
        panic!("Expected passage section")
    };
    assert!(
        first
            .passage
            .as_ref()
            .unwrap()
            .text
            .contains("Why Urban Wildlife Is on the Rise")
    );
    assert_eq!(first.entries.len(), 5);
}

#[test]
fn retains_material_images_question_images_and_original_font_bytes() {
    let mut input: Value = serde_json::from_str(ARCHIVED).unwrap();
    input["font"] = json!([0, 128, 255]);
    let reading = &mut input["entries"][1]["data"]["entries"][0]["data"];
    reading["passage"]["images"] =
        json!([{"marker": "图片1", "url": "https://p.cldisk.com/passage.png"}]);
    reading["entries"][0]["data"]["images"] =
        json!([{"marker": "图片1", "url": "https://p.cldisk.com/choice.png"}]);

    let folio: Folio = serde_json::from_value(input).unwrap();
    assert_eq!(folio.font, Some(vec![0, 128, 255]));
    let Entry::Section(reading) = &folio.entries[1] else {
        panic!("Expected reading section")
    };
    let Entry::Section(first) = &reading.entries[0] else {
        panic!("Expected passage section")
    };
    let image = &first.passage.as_ref().unwrap().images[0];
    assert_eq!(image.marker, "图片1");
    assert_eq!(image.url, "https://p.cldisk.com/passage.png");
    let leaves = questions(&folio.entries);
    assert_eq!(leaves[1].images[0].url, "https://p.cldisk.com/choice.png");
    assert!(leaves[2].images.is_empty());
}
