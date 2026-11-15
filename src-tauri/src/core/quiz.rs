mod mapper;
mod payload;
mod typr;

pub mod folio;
pub mod llm;

pub use folio::{Entry, Folio};
use llm::AnswerItem;
use mapper::decrypt;
pub use payload::{Question, QuestionData, QuestionImage};

use crate::config::{CONFIG, solver::SolverKind};
use anyhow::Result;

/// 根据本次入口选定的求解方式生成测验答案。
pub async fn solve(payload: Folio, allow_partial: bool) -> Result<Vec<AnswerItem>> {
    let solver = *CONFIG.solver.lock();
    match solver {
        SolverKind::NativeLlm => {
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
            llm::solve(&provider, decrypted, general, allow_partial).await
        }
        SolverKind::DeepSeekWeb => anyhow::bail!("DeepSeek Web Solver 尚未接入"),
    }
}

#[cfg(test)]
#[path = "../../tests/live/core/quiz.rs"]
mod live_tests;
