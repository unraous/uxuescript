use anyhow::{Result, bail};
use serde_json::json;

use super::{
    batch::Batch,
    media::{self, Image},
};

pub(super) enum Part {
    Text(String),
    Image(Image),
}

pub(super) struct Prompt {
    pub system: String,
    pub parts: Vec<Part>,
}

// 固定排列；同一批出现多道同类题时只附加一次说明。
const RULES: &[(&str, &str)] = &[
    ("单选", include_str!("../prompts/single.txt")),
    ("多选", include_str!("../prompts/multiple.txt")),
    ("判断", include_str!("../prompts/judgment.txt")),
    ("填空", include_str!("../prompts/completion.txt")),
    ("分录", include_str!("../prompts/entry.txt")),
    ("简答", include_str!("../prompts/short.txt")),
    ("论述", include_str!("../prompts/essay.txt")),
    ("计算", include_str!("../prompts/calculation.txt")),
    ("翻译", include_str!("../prompts/translation.txt")),
    ("连线", include_str!("../prompts/matching.txt")),
];

pub(super) fn instructions(batch: &Batch) -> Result<String> {
    for item in &batch.questions {
        if !RULES
            .iter()
            .any(|(kind, _)| item.question.kind.contains(kind))
        {
            bail!(
                "题号 {} 的题型 {} 尚未支持",
                item.question.id,
                item.question.kind
            );
        }
    }
    let mut text = include_str!("../prompts/common.txt").to_owned();
    for (kind, rule) in RULES {
        if batch
            .questions
            .iter()
            .any(|item| item.question.kind.contains(kind))
        {
            text.push_str("\n\n");
            text.push_str(rule);
        }
    }
    Ok(text)
}

/// 文本与图片按课业背景、材料、题目排列，协议层只负责编码。
pub(super) fn assemble(batch: &Batch, images: Vec<Image>) -> Result<Prompt> {
    let system = instructions(batch)?;
    let mut parts = Vec::new();
    let context = serde_json::to_value(&batch.context)?;
    if context.as_object().is_some_and(|value| !value.is_empty()) {
        parts.push(Part::Text(json!({"context": context}).to_string()));
    }
    let mut images = images.into_iter();
    for material in &batch.materials {
        parts.push(Part::Text(json!({"passage": material}).to_string()));
        append_images(&mut parts, images.by_ref().take(material.images.len()));
    }
    parts.push(Part::Text(
        json!({"questions": batch.questions}).to_string(),
    ));
    append_images(&mut parts, images);
    Ok(Prompt { system, parts })
}

fn append_images(parts: &mut Vec<Part>, images: impl Iterator<Item = Image>) {
    for image in images {
        parts.push(Part::Text(format!("{} 的 [{}]", image.owner, image.marker)));
        parts.push(Part::Image(image));
    }
}

pub(super) async fn build(batch: &Batch) -> Result<Prompt> {
    // 先检查题型，避免不支持的批次仍下载图片。
    instructions(batch)?;
    let sources: Vec<_> = batch
        .materials
        .iter()
        .map(|p| (format!("材料 {}", p.id), p.images.as_slice()))
        .chain(batch.questions.iter().map(|q| {
            (
                format!("题号 {}", q.question.id),
                q.question.images.as_slice(),
            )
        }))
        .collect();
    assemble(batch, media::load(&sources).await?)
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/dispatcher/prompt.rs"]
mod tests;
