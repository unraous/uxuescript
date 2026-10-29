mod metadata;
mod status;

pub use metadata::{CourseMetaMap, CourseMetadata};
pub use status::CourseStatus;

use super::CommandsResult;

use crate::config::CONFIG;
use crate::core::quiz::{
    Question, QuestionPayload,
    llm::{self, AnswerItem},
    solve,
};

use tauri::Emitter;

/// 用固定简答题检查当前 API 和模型，成功返回 ok，失败返回具体错误字符串。
#[uxs_commands::command]
pub async fn healthy() -> CommandsResult<String> {
    let active_id = CONFIG.llm.active_provider.lock().clone();
    let provider = CONFIG
        .llm
        .providers
        .lock()
        .get(&active_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("大模型提供商 [{}] 不存在", active_id))?;
    let general = *CONFIG.general.lock();
    let answers = llm::solve(
        &provider,
        vec![Question {
            id: "1".into(),
            kind: "简答题".into(),
            stem: "天空为什么是蓝色的？请用一句话回答。".into(),
            options: Vec::new(),
            images: Vec::new(),
        }],
        general,
    )
    .await
    .map_err(|error| anyhow::anyhow!("{error:#}"))?;
    if answers.len() != 1 {
        return Err(
            anyhow::anyhow!("健康检查应返回 1 道题的答案，实际返回 {} 道", answers.len()).into(),
        );
    }
    if answers[0].content.trim().is_empty() {
        return Err(anyhow::anyhow!("健康检查返回的答案为空").into());
    }
    Ok("ok".to_owned())
}

#[cfg(test)]
#[path = "../../tests/unit/commands/chaoxing.rs"]
mod tests;

#[uxs_commands::command(webview = "chaoxing")]
pub async fn solve_questions(payload: QuestionPayload) -> CommandsResult<Vec<AnswerItem>> {
    match solve(payload).await {
        Ok(answers) => {
            log::info!("solve_questions 答题成功，获得答案数量: {}", answers.len());
            Ok(answers)
        }
        Err(e) => {
            log::error!("solve_questions 答题失败，详细原因: {:?}", e);
            Err(e.into())
        }
    }
}

#[uxs_commands::command(webview = "chaoxing")]
pub fn insert_course_meta_map(
    state: tauri::State<CourseMetaMap>,
    course_id: String,
    metadata: CourseMetadata,
) {
    log::debug!("接收到课程元数据: {:?}", metadata);
    state.insert(course_id, metadata);
}

#[uxs_commands::command]
pub fn query_course_meta(
    state: tauri::State<CourseMetaMap>,
    course_id: String,
) -> Option<CourseMetadata> {
    let metadata = state.get(&course_id);
    if let Some(ref meta) = metadata {
        log::debug!("成功查询到课程元数据: {:?}，ID: {}", meta, course_id);
    } else {
        log::warn!("未查询到课程元数据，课程 ID: {}", course_id);
    }
    metadata
}

#[uxs_commands::command(webview = "chaoxing")]
pub fn send_status(webview: tauri::Webview, status: CourseStatus) -> CommandsResult<()> {
    log::debug!(
        "接收到来自 [{}] 的章节完成状态: {:?}",
        webview.label(),
        status
    );
    webview.emit_to("main", "status-update", status).ok();
    Ok(())
}

#[uxs_commands::command(webview = "chaoxing")]
pub fn platform() -> CommandsResult<String> {
    Ok(std::env::consts::OS.to_string())
}
