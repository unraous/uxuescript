mod mapper;
mod payload;
mod typr;

pub mod folio;
pub mod llm;

pub use folio::{Entry, Folio};
use llm::AnswerItem;
use mapper::decrypt;
pub use payload::{Question, QuestionImage};

use crate::config::CONFIG;
use anyhow::Result;

/// 使用字体哈希字典解密混淆题目，并结合当前全局配置的大语言模型自动生成测验答案。
pub async fn solve(payload: Folio) -> Result<Vec<AnswerItem>> {
    let decrypted = decrypt(payload);
    if decrypted.entries.is_empty() {
        anyhow::bail!("题目解析失败");
    }

    let active_id = CONFIG.llm.active_provider.lock().clone();
    let provider = CONFIG
        .llm
        .providers
        .lock()
        .get(&active_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("大模型提供商 [{}] 不存在", active_id))?;
    let general = *CONFIG.general.lock();
    llm::solve(&provider, decrypted, general).await
}

#[cfg(test)]
#[path = "../../tests/live/core/quiz.rs"]
mod live_tests;
