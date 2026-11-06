use super::config::CONFIG;
use crate::core::{
    script::{include_script, load_on},
    url::{Type, classify},
};

use anyhow::anyhow;
use parking_lot::Mutex;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{LogicalPosition, LogicalSize, Url, Webview, WebviewBuilder, WebviewUrl};

/// 课程主视图句柄，供课程相关命令使用。
pub struct CourseWebview {
    pub main: Webview,
}

#[derive(Default)]
pub struct UrlStack(Mutex<(Vec<Url>, usize)>);

impl UrlStack {
    pub fn push(&self, url: Url) {
        if url.as_str() == "about:blank" {
            return;
        }
        let (urls, index) = &mut *self.0.lock();
        if urls.get(*index) != Some(&url) {
            urls.truncate(*index + 1);
            urls.push(url);
            *index = urls.len().saturating_sub(1);
        }
    }

    pub fn can_back(&self) -> bool {
        let (_, index) = &*self.0.lock();
        *index > 0
    }

    pub fn can_forward(&self) -> bool {
        let (urls, index) = &*self.0.lock();
        *index + 1 < urls.len()
    }

    pub fn back(&self) -> Option<Url> {
        if !self.can_back() {
            return None;
        }
        let (urls, index) = &mut *self.0.lock();
        *index -= 1;
        urls.get(*index).cloned()
    }

    pub fn current(&self) -> Option<Url> {
        let (urls, index) = &*self.0.lock();
        urls.get(*index).cloned()
    }

    pub fn forward(&self) -> Option<Url> {
        if !self.can_forward() {
            return None;
        }
        let (urls, index) = &mut *self.0.lock();
        *index += 1;
        urls.get(*index).cloned()
    }
}

pub fn init_on(window: &tauri::Window, label: &str) -> Result<Webview, Box<dyn std::error::Error>> {
    log::debug!("开始初始化Webview [{}]", label);
    let logical_size: LogicalSize<f64> =
        tauri::LogicalSize::from_physical(window.inner_size()?, window.scale_factor()?);

    let (builder, position, size) = match label {
        "main" => (
            WebviewBuilder::new(label, WebviewUrl::App("main.html".into()))
                .background_color((0, 0, 0, 0).into())
                .devtools(cfg!(debug_assertions)),
            LogicalPosition::new(0.0, 0.0),
            logical_size,
        ),
        "mask" => (
            WebviewBuilder::new(label, WebviewUrl::App("mask.html".into()))
                .background_color((0, 0, 0, 0).into())
                .devtools(true),
            LogicalPosition::new(0.0, 0.0),
            logical_size,
        ),
        "chaoxing" => (
            WebviewBuilder::new(label, WebviewUrl::External(CONFIG.home_url.clone()))
                .background_color((242, 244, 247).into())
                .devtools(true)
                .initialization_script(include_script!("webview-log.js"))
                .initialization_script_for_all_frames(include_script!("iframe-init.js"))
                .initialization_script_for_all_frames(include_script!("classroom-mute.js"))
                .initialization_script_for_all_frames(include_script!("course-list-metadata.js"))
                .on_navigation(|url| {
                    log::debug!("检测到页面导航: {}", url);
                    classify(url) != Type::Unknown
                })
                .on_page_load(load_on),
            LogicalPosition::new(logical_size.width * 0.51, logical_size.height * 0.46),
            LogicalSize::new(logical_size.width * 0.48, logical_size.height * 0.48),
        ),
        "chaoxing-mask" => (
            WebviewBuilder::new(label, WebviewUrl::App("mask.chaoxing.html".into()))
                .background_color((0, 0, 0, 0).into())
                .devtools(true)
                .initialization_script(include_script!("webview-log.js")),
            LogicalPosition::new(logical_size.width * 0.51, logical_size.height * 0.46),
            LogicalSize::new(logical_size.width * 0.48, logical_size.height * 0.48),
        ),
        _ => return Err(anyhow!("未知的Webview标签").into()),
    };

    log::debug!(
        "Webview [{}] 初始化参数 - 位置: ({}, {}), 大小: ({}x{})",
        label,
        position.x,
        position.y,
        size.width,
        size.height
    );
    Ok(window.add_child(
        builder.background_throttling(BackgroundThrottlingPolicy::Disabled),
        position,
        size,
    )?)
}

#[cfg(test)]
#[path = "../../tests/unit/app/webview.rs"]
mod tests;
