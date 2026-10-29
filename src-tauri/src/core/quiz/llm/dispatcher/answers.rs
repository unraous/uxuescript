use crate::core::quiz::{Question, llm::AnswerItem};
use anyhow::Result;

#[derive(Debug, thiserror::Error)]
#[error("答案格式错误: {0}")]
pub(super) struct AnswerError(String);

pub(super) fn parse<'a>(
    content: &str,
    questions: impl IntoIterator<Item = &'a Question>,
) -> Result<Vec<AnswerItem>> {
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Output {
        Array(Vec<AnswerItem>),
        Object { answers: Vec<AnswerItem> },
    }
    let questions: Vec<_> = questions.into_iter().collect();
    let parsed = serde_json::from_str::<Output>(content)
        .map_err(|error| AnswerError(format!("JSON 解析失败: {error}")))?;
    let mut answers = match parsed {
        Output::Array(answers) | Output::Object { answers } => answers,
    };
    if answers.len() != questions.len() {
        return Err(AnswerError(format!(
            "预期 {} 题，收到 {} 个答案",
            questions.len(),
            answers.len()
        ))
        .into());
    }
    let mut ordered = Vec::with_capacity(questions.len());
    for question in questions {
        let index = answers
            .iter()
            .position(|answer| answer.index == question.id)
            .ok_or_else(|| AnswerError(format!("题号 {} 缺失或重复", question.id)))?;
        let answer = answers.remove(index);
        if answer.content.trim().is_empty() {
            return Err(AnswerError(format!("题号 {} 的答案为空", question.id)).into());
        }
        if let Some(count) = question.blank_count {
            let blanks: Vec<_> = answer.content.split(';').map(str::trim).collect();
            if blanks.len() != count as usize || blanks.iter().any(|value| value.is_empty()) {
                return Err(AnswerError(format!(
                    "题号 {} 需要 {} 个非空答案，收到 {} 项",
                    question.id,
                    count,
                    blanks.len()
                ))
                .into());
            }
        }
        ordered.push(answer);
    }
    Ok(ordered)
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/dispatcher/answers.rs"]
mod tests;
