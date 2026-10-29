use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone, specta::Type)]
pub struct QuestionImage {
    pub marker: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
pub struct Question {
    /// 页面显示题号，不是平台内部题目 ID。
    pub id: String,
    pub kind: String,
    pub stem: String,
    pub options: Vec<String>,
    /// 填空题实际填写位置数；其他题型不提供。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blank_count: Option<u32>,
    /// 图片地址只用于后端加载媒体；模型文本通过题干中的占位符引用图片。
    #[serde(default, skip_serializing)]
    pub images: Vec<QuestionImage>,
}
