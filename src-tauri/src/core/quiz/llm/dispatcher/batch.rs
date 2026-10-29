use anyhow::{Result, bail};
use serde::Serialize;
use std::collections::HashSet;

use crate::core::quiz::{
    Entry, Folio, Question, QuestionImage,
    folio::{FolioContext, Section},
};

#[derive(Serialize)]
pub(super) struct ScopedQuestion {
    #[serde(flatten)]
    pub question: Question,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub passages: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct Material {
    pub id: String,
    pub title: String,
    pub text: String,
    #[serde(skip)]
    pub images: Vec<QuestionImage>,
}

pub(super) struct Batch {
    pub context: FolioContext,
    pub materials: Vec<Material>,
    pub questions: Vec<ScopedQuestion>,
}

struct Leaf<'a> {
    question: &'a Question,
    passages: Vec<(String, &'a Section)>,
}

fn collect<'a>(
    entries: &'a [Entry],
    path: &str,
    passages: &[(String, &'a Section)],
    leaves: &mut Vec<Leaf<'a>>,
) {
    for (index, entry) in entries.iter().enumerate() {
        match entry {
            Entry::Question(question) => leaves.push(Leaf {
                question,
                passages: passages.to_vec(),
            }),
            Entry::Section(section) => {
                let id = format!("{path}.{}", index + 1);
                let mut ancestors = passages.to_vec();
                if section.passage.is_some() {
                    ancestors.push((id.clone(), section));
                }
                collect(&section.entries, &id, &ancestors, leaves);
            }
        }
    }
}

/// 同一材料的题优先同批；按题数拆分时保留全部祖先材料和稳定引用。
pub(super) fn prepare(folio: Folio, size: usize) -> Result<Vec<Batch>> {
    let mut leaves = Vec::new();
    collect(&folio.entries, "p", &[], &mut leaves);
    if leaves.is_empty() {
        bail!("接收到空的题目列表");
    }
    let mut ids = HashSet::new();
    for leaf in &leaves {
        if !ids.insert(&leaf.question.id) {
            bail!("题号 {} 重复", leaf.question.id);
        }
        if leaf.question.kind.contains("填空") && !leaf.question.blank_count.is_some_and(|n| n > 0)
        {
            bail!("填空题 {} 缺少有效空数", leaf.question.id);
        }
    }
    let groups = leaves.chunk_by(|a, b| {
        a.passages
            .iter()
            .map(|(id, _)| id)
            .eq(b.passages.iter().map(|(id, _)| id))
    });
    Ok(groups
        .flat_map(|group| group.chunks(size))
        .map(|chunk| {
            let materials = chunk[0]
                .passages
                .iter()
                .map(|(id, section)| {
                    let passage = section
                        .passage
                        .as_ref()
                        .expect("collected material section");
                    Material {
                        id: id.clone(),
                        title: section.title.clone(),
                        text: passage.text.clone(),
                        images: passage.images.clone(),
                    }
                })
                .collect();
            let questions = chunk
                .iter()
                .map(|leaf| ScopedQuestion {
                    question: leaf.question.clone(),
                    passages: leaf.passages.iter().map(|(id, _)| id.clone()).collect(),
                })
                .collect();
            Batch {
                context: folio.context.clone(),
                materials,
                questions,
            }
        })
        .collect())
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/dispatcher/batch.rs"]
mod tests;
