use super::*;

fn metadata(title: &str, cover: &str) -> CourseMetadata {
    CourseMetadata {
        title: title.into(),
        cover: cover.into(),
    }
}

#[test]
fn stores_and_overwrites_metadata_without_affecting_other_courses() {
    let map = CourseMetaMap::default();
    assert!(map.get("missing-course").is_none());

    map.insert("course-1".into(), metadata("First title", "first.png"));
    map.insert("course-2".into(), metadata("Second", "second.png"));
    let first = map.get("course-1").expect("metadata should be stored");
    assert_eq!(first.title, "First title");
    assert_eq!(first.cover, "first.png");

    map.insert("course-1".into(), metadata("Updated title", "updated.png"));
    let updated = map
        .get("course-1")
        .expect("updated metadata should be stored");
    assert_eq!(updated.title, "Updated title");
    assert_eq!(updated.cover, "updated.png");
    assert_eq!(
        map.get("course-2").expect("course-2 exists").title,
        "Second"
    );
}
