use serde::{Deserialize, Serialize};

use super::{Question, QuestionImage};

/// 卷：保留页面题目层级及用于文字还原的字体。
#[derive(Deserialize, Debug, Clone, Default, specta::Type)]
pub struct Folio {
    pub entries: Vec<Entry>,
    pub font: Option<Vec<u8>>,
    #[serde(default)]
    pub context: FolioContext,
}

/// 卷面所属课业背景；只保留页面或课程缓存中真实存在的信息。
#[derive(Serialize, Deserialize, Debug, Clone, Default, specta::Type)]
pub struct FolioContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub course: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// 条目：篇负责组织关系，题负责表达需要作答的内容。
#[derive(Deserialize, Debug, Clone, specta::Type)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum Entry {
    Section(Section),
    Question(Question),
}

/// 篇：题型分区或材料题组；子篇可以拥有自己的材料。
#[derive(Deserialize, Debug, Clone, specta::Type)]
pub struct Section {
    pub title: String,
    pub passage: Option<Passage>,
    pub entries: Vec<Entry>,
}

/// 文：属于本篇的公共材料，不在解析阶段复制到子题。
#[derive(Deserialize, Debug, Clone, specta::Type)]
pub struct Passage {
    pub text: String,
    pub images: Vec<QuestionImage>,
}

#[cfg(test)]
#[path = "../../../tests/unit/core/quiz/folio.rs"]
mod tests;
