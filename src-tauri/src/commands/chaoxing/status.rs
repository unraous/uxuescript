use serde::{Deserialize, Serialize};
use specta::Type;
#[derive(Debug, Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterProgressPayload {
    pub title: String,
    pub index: i32,
    pub completed: i32,
    pub total: i32,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TabProgressPayload {
    pub total: i32,
    pub index: i32,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressPayload {
    pub index: i32,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase", tag = "kind", content = "payload")]
pub enum CourseStatus {
    Waiting(()),
    Start(()),
    Chapter(ChapterProgressPayload),
    Tab(TabProgressPayload),
    Task(TaskProgressPayload),
    Cancel(()),
    Finish(()),
}

#[cfg(test)]
#[path = "../../../tests/unit/commands/chaoxing/status.rs"]
mod tests;
