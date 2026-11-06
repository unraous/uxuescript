use super::CommandsResult;
use crate::app::webview::CourseWebview;
use crate::core::quiz::{Folio, llm::AnswerItem};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Url;

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExamRun {
    pub phase: ExamPhase,
    pub index: u32,
    pub config: ExamConfig,
    pub entries: Vec<ExamEntry>,
    pub pages: Vec<Folio>,
    pub answers: Vec<AnswerItem>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExamPhase {
    Collect,
    Answer,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExamConfig {
    pub switching_cd: Option<f32>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
pub struct ExamEntry {
    pub id: String,
    pub start: u32,
}

#[derive(Default)]
struct TaskData {
    course_active: bool,
    return_trip: Option<(Url, Url)>,
    completed_task: Option<Url>,
    resume: bool,
    exam: Option<(String, ExamRun)>,
}

/// 跨页面保留当前任务的临时状态；手动导航或任务结束后清除。
#[derive(Default)]
pub struct TaskSession(Mutex<TaskData>);

impl TaskSession {
    pub fn clear(&self) {
        *self.0.lock() = TaskData::default();
    }

    pub fn start_course(&self) {
        self.0.lock().course_active = true;
    }

    pub fn resume_course(&self) -> bool {
        let mut state = self.0.lock();
        let resume = std::mem::take(&mut state.resume) && state.course_active;
        state.course_active = resume;
        if !resume {
            state.completed_task = None;
        }
        resume
    }
}

/// 在课程视图跳转到任务页面，并保存返回地址。
#[uxs_commands::command(webview = "chaoxing")]
pub fn navigate_to_task(
    course: tauri::State<CourseWebview>,
    session: tauri::State<TaskSession>,
    url: String,
) -> CommandsResult<()> {
    let url = Url::parse(&url).map_err(anyhow::Error::from)?;
    if crate::core::url::classify(&url) == crate::core::url::Type::Unknown {
        return Err(anyhow::anyhow!("不支持的任务地址: {url}").into());
    }
    let return_url = course.main.url()?;
    {
        let mut state = session.0.lock();
        state.return_trip = Some((return_url, url.clone()));
        state.completed_task = None;
        state.resume = false;
        state.exam = None;
    }
    if let Err(error) = course.main.navigate(url) {
        session.0.lock().return_trip = None;
        return Err(error.into());
    }
    Ok(())
}

/// 任务完成后返回之前的页面，并发放一次性恢复凭证。
#[uxs_commands::command(webview = "chaoxing")]
pub fn return_from_task(
    course: tauri::State<CourseWebview>,
    session: tauri::State<TaskSession>,
) -> CommandsResult<()> {
    let (url, task_url) = session
        .0
        .lock()
        .return_trip
        .take()
        .ok_or_else(|| anyhow::anyhow!("当前没有需要返回的任务"))?;
    // 页面可能在命令返回前加载完成，先发放凭证；导航失败时撤销。
    {
        let mut state = session.0.lock();
        state.resume = true;
        state.completed_task = Some(task_url.clone());
    }
    if let Err(error) = course.main.navigate(url.clone()) {
        let mut state = session.0.lock();
        state.resume = false;
        state.completed_task = None;
        state.return_trip = Some((url, task_url));
        return Err(error.into());
    }
    Ok(())
}

/// 识别刚返回的任务，避免平台尚未更新完成标记时再次打开。
#[uxs_commands::command(webview = "chaoxing")]
pub fn take_completed_task(
    session: tauri::State<TaskSession>,
    url: String,
) -> CommandsResult<bool> {
    let url = Url::parse(&url).map_err(anyhow::Error::from)?;
    let mut state = session.0.lock();
    if state.completed_task.as_ref() == Some(&url) {
        state.completed_task = None;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 保存任务下一页面需要的状态。
#[uxs_commands::command(webview = "chaoxing")]
pub fn save_exam_state(session: tauri::State<TaskSession>, key: String, value: ExamRun) {
    session.0.lock().exam = Some((key, value));
}

/// 读取本次任务的状态，供页面刷新后恢复。
#[uxs_commands::command(webview = "chaoxing")]
pub fn read_exam_state(session: tauri::State<TaskSession>, key: String) -> Option<ExamRun> {
    session
        .0
        .lock()
        .exam
        .as_ref()
        .and_then(|(stored_key, value)| {
            if stored_key == &key {
                Some(value.clone())
            } else {
                None
            }
        })
}

/// 清除指定任务的状态。
#[uxs_commands::command(webview = "chaoxing")]
pub fn clear_exam_state(session: tauri::State<TaskSession>, key: String) {
    let mut state = session.0.lock();
    if state
        .exam
        .as_ref()
        .is_some_and(|(stored_key, _)| stored_key == &key)
    {
        state.exam = None;
    }
}

#[cfg(test)]
#[path = "../../tests/unit/commands/task.rs"]
mod tests;
