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

/// 一道待作答题及其从外到内的祖先材料链；借用卷面内容，收集阶段不复制正文或图片。
struct Leaf<'a> {
    question: &'a Question,
    passages: Vec<(String, &'a Section)>,
}

/// 按条目顺序深度优先遍历卷面，将可作答题依次追加到 `leaves`。
///
/// - `entries` 是当前层的条目。遇到题目就记录，遇到篇就先遍历其全部子条目，
///   返回后再处理当前层的下一个条目；空篇不产生题目，也不改变已有结果。
/// - `path` 是父层的结构路径，根层为 `p`。篇的路径追加其在当前 `entries` 中
///   从 1 开始的位置，例如 `p.2.1`；位置同时计入题和篇。无材料的篇也占据路径，
///   但不会成为材料引用。此路径只标识材料，题目的显示编号 `question.id` 保持原值。
/// - `passages` 仅包含当前层已继承的、有材料的祖先篇，按外层到内层排列。
///   进入篇时为该分支复制材料链，按需追加本篇材料；后代继承这条新链，兄弟分支
///   继续使用原链。每个叶子保存自己的链快照，避免材料泄漏到作用域之外。
/// - `leaves` 是整次遍历共用的输出，只追加、不排序。每个题目记录在原卷面顺序中，
///   后续分组和拆批不会改变该顺序。
///
/// 材料路径在同一份卷面拆批时保持稳定；重新排列卷面条目可能改变路径。
/// 真实页面样本已验证“无材料分区 → 材料题组 → 子题”；多层材料同时继承仅有构造测试。
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
                // 分支单独持有材料链；递归返回时无需 pop，也不会改变父层或兄弟分支的链。
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
    validate(&leaves)?;

    let mut batches = Vec::new();
    for group in leaves.chunk_by(same_passages) {
        for chunk in group.chunks(size) {
            batches.push(assemble(chunk, &folio.context));
        }
    }
    Ok(batches)
}

fn validate(leaves: &[Leaf<'_>]) -> Result<()> {
    if leaves.is_empty() {
        bail!("接收到空的题目列表");
    }
    let mut ids = HashSet::new();
    for leaf in leaves {
        if !ids.insert(&leaf.question.id) {
            bail!("题号 {} 重复", leaf.question.id);
        }
        if (leaf.question.kind.contains("填空") || leaf.question.kind.contains("分录"))
            && !matches!(leaf.question.blank_count, Some(1..))
        {
            bail!("{} {} 缺少有效空数", leaf.question.kind, leaf.question.id);
        }
    }
    Ok(())
}

/// 按顺序比较完整的祖先材料链，用于界定可以一起拆批的连续题组。
fn same_passages(left: &Leaf<'_>, right: &Leaf<'_>) -> bool {
    if left.passages.len() != right.passages.len() {
        return false;
    }
    for ((left_id, _), (right_id, _)) in left.passages.iter().zip(&right.passages) {
        if left_id != right_id {
            return false;
        }
    }
    true
}

/// 接收 prepare 拆出的非空批次；各题材料链相同，因此从首题提取一次公共材料。
fn assemble(leaves: &[Leaf<'_>], context: &FolioContext) -> Batch {
    let mut materials = Vec::new();
    for (id, section) in &leaves[0].passages {
        // collect 只把 passage 为 Some 的篇加入材料链。
        let passage = section
            .passage
            .as_ref()
            .expect("collected material section");
        materials.push(Material {
            id: id.clone(),
            title: section.title.clone(),
            text: passage.text.clone(),
            images: passage.images.clone(),
        });
    }

    let mut questions = Vec::new();
    for leaf in leaves {
        let mut passages = Vec::new();
        for (id, _) in &leaf.passages {
            passages.push(id.clone());
        }
        questions.push(ScopedQuestion {
            question: leaf.question.clone(),
            passages,
        });
    }

    Batch {
        context: context.clone(),
        materials,
        questions,
    }
}

#[cfg(test)]
#[path = "../../../../../tests/unit/core/quiz/llm/dispatcher/batch.rs"]
mod tests;
