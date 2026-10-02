mod metadata;
mod status;

pub use metadata::{CourseMetaMap, CourseMetadata};
pub use status::CourseStatus;

use super::CommandsResult;

use crate::core::quiz::{llm::AnswerItem, solve};

use tauri::Emitter;

#[tauri::command]
#[specta::specta]
pub async fn solve_quiz(html: String) -> CommandsResult<Vec<AnswerItem>> {
    match solve(&html).await {
        Ok(answers) => {
            log::info!("solve_quiz 答题成功，获得答案数量: {}", answers.len());
            Ok(answers)
        }
        Err(e) => {
            log::error!("solve_quiz 答题失败，详细原因: {:?}", e);
            Err(e.into())
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn insert_course_meta_map(
    state: tauri::State<CourseMetaMap>,
    course_id: String,
    metadata: CourseMetadata,
) {
    log::debug!("接收到课程元数据: {:?}", metadata);
    state.insert(course_id, metadata);
}

#[tauri::command]
#[specta::specta]
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

#[tauri::command]
#[specta::specta]
pub fn send_status(webview: tauri::Webview, status: CourseStatus) -> CommandsResult<()> {
    log::debug!(
        "接收到来自 [{}] 的章节完成状态: {:?}",
        webview.label(),
        status
    );
    webview.emit_to("main", "status-update", status).ok();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn platform() -> CommandsResult<String> {
    Ok(std::env::consts::OS.to_string())
}
