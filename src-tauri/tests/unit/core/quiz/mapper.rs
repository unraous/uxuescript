use super::*;
use serde_json::to_value;
use std::collections::HashMap;

#[test]
fn test_map_basic() {
    let mut font_map = HashMap::new();
    font_map.insert('a', 'x');
    font_map.insert('b', 'y');
    let out = map("abc", &font_map);
    assert_eq!(out, "xyc");
}

#[test]
fn test_map_unmapped_chars_unchanged() {
    let font_map = HashMap::new();
    let out = map("héllo", &font_map);
    assert_eq!(out, "héllo");
}

#[test]
fn decrypts_questions_and_nested_material_with_the_same_font() {
    use crate::core::quiz::{
        Question,
        folio::{Passage, Section},
    };
    let questions: Vec<Question> =
        serde_json::from_str(include_str!("../../../assets/course-page/questions.json")).unwrap();
    let expected: Vec<Question> =
        serde_json::from_str(include_str!("../../../assets/course-page/decrypted.json")).unwrap();
    let raw = Folio {
        entries: vec![Entry::Section(Section {
            title: questions[0].stem.clone(),
            passage: Some(Passage {
                text: questions[0].stem.clone(),
                images: vec![],
            }),
            entries: questions.into_iter().map(Entry::Question).collect(),
        })],
        font: Some(include_bytes!("../../../assets/course-page/cxs-font.ttf").to_vec()),
        ..Default::default()
    };
    let decrypted = decrypt(raw);
    assert!(decrypted.font.is_none());
    let Entry::Section(section) = &decrypted.entries[0] else {
        panic!()
    };
    assert_eq!(section.title, expected[0].stem);
    assert_eq!(section.passage.as_ref().unwrap().text, expected[0].stem);
    let actual: Vec<_> = section
        .entries
        .iter()
        .map(|entry| match entry {
            Entry::Question(q) => q,
            _ => panic!(),
        })
        .collect();
    assert_eq!(to_value(actual).unwrap(), to_value(expected).unwrap());
    let unchanged = decrypt(decrypted.clone());
    let Entry::Section(unchanged_section) = &unchanged.entries[0] else {
        panic!()
    };
    assert_eq!(
        unchanged_section.passage.as_ref().unwrap().text,
        section.passage.as_ref().unwrap().text
    );
}
