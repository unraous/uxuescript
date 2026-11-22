mod mapper;
mod payload;
mod typr;
mod web;

pub mod folio;
pub mod llm;

pub use folio::{Entry, Folio};
use llm::AnswerItem;
use mapper::decrypt;
pub use payload::{Question, QuestionData, QuestionImage};

use crate::app::webview::deepseek::request::RequestState;
use crate::config::{CONFIG, solver::SolverKind};
use anyhow::Result;

/// 根据本次入口选定的求解方式生成测验答案。
pub async fn solve(
    payload: Folio,
    allow_partial: bool,
    requests: &RequestState,
) -> Result<Vec<AnswerItem>> {
    let solver = *CONFIG.solver.lock();
    solve_with_solver(solver, payload, allow_partial, Some(requests)).await
}

/// The command snapshots selection before ensuring native resources; keep that
/// choice through routing even if settings change while the view is created.
pub(crate) async fn solve_with_solver(
    solver: SolverKind,
    payload: Folio,
    allow_partial: bool,
    requests: Option<&RequestState>,
) -> Result<Vec<AnswerItem>> {
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
        // Web 第一版只交付整卷成功结果；allow_partial 仅沿用 Native 语义。
        SolverKind::DeepSeekWeb => {
            let requests = requests.ok_or_else(|| anyhow::anyhow!("DeepSeek 实例未就绪"))?;
            web::solve(payload, requests).await
        }
    }
}

#[cfg(test)]
#[path = "../../tests/live/core/quiz.rs"]
mod live_tests;
