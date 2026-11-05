use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
#[derive(Serialize, Deserialize, Default, Debug, Clone, Type)]
pub struct CourseMetadata {
    pub title: String,
    pub cover: String,
}

#[derive(Default, Debug)]
pub struct CourseMetaMap(Mutex<HashMap<String, CourseMetadata>>);

impl CourseMetaMap {
    pub fn insert(&self, course_id: String, metadata: CourseMetadata) {
        self.0.lock().insert(course_id, metadata);
    }

    pub fn get(&self, course_id: &str) -> Option<CourseMetadata> {
        self.0.lock().get(course_id).cloned()
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/commands/chaoxing/metadata.rs"]
mod tests;
