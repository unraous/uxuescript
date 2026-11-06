use super::url::{Type, classify};

use crate::app::webview::UrlStack;
use crate::commands::chaoxing::CourseStatus;

use tauri::{Emitter, Manager};

macro_rules! include_script {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../dist/scripts/embedded/",
            $name
        ))
    };
}

pub(crate) use include_script;

/// 根据 URL 类型获取对应的 JavaScript 静态脚本内容。
pub fn obtain(t: Type) -> Option<&'static str> {
    match t {
        Type::Course => Some(include_script!("core.js")),
        Type::Work => Some(include_script!("work.js")),
        Type::Exam => Some(include_script!("exam.js")),
        Type::Login => Some(include_script!("click-auto-login.js")),
        _ => None,
    }
}

/// 页面开始导航时结束旧确认框，加载完成后根据 URL 类型注入对应的脚本。
pub fn load_on(webview: tauri::Webview, payload: tauri::webview::PageLoadPayload) {
    if let tauri::webview::PageLoadEvent::Started = payload.event() {
        if let Err(error) = webview.emit_to("chaoxing-mask", "confirmation-dismissed", ()) {
            log::error!("关闭旧页面确认框失败: {error}");
        }
        return;
    }
    if let tauri::webview::PageLoadEvent::Finished = payload.event() {
        let url_type = classify(payload.url());
        log::debug!("URL \"{}\" 加载完成, 类别: {:?}", payload.url(), url_type);
        webview
            .emit_to("main", "url-update", payload.url().as_str())
            .ok();
        webview
            .emit_to("main", "status-update", CourseStatus::Cancel(()))
            .ok();
        let url_stack = webview.state::<UrlStack>();
        url_stack.push(payload.url().clone());

        if let Some(script) = obtain(url_type) {
            log::debug!("正在注入脚本到Webview \"{}\"...", webview.label());
            if let Err(e) = webview.eval(script) {
                log::error!("Webview \"{}\" 脚本注入失败: {}", webview.label(), e);
            }
        } else {
            log::debug!("当前URL不需要注入脚本, 跳过注入");
        }
    }
}
