use super::config::CONFIG;
use crate::core::{
    script::{include_script, load_on},
    url::{classify, Type},
};

use anyhow::anyhow;
use parking_lot::Mutex;
use tauri::{LogicalPosition, LogicalSize, Url, Webview, WebviewBuilder, WebviewUrl};
use tauri::utils::config::BackgroundThrottlingPolicy;

/// 课程主视图与课堂小窗共用默认浏览数据存储。
pub struct CourseWebviews {
    pub main: Webview,
    pub mini: Webview,
}

impl CourseWebviews {
    pub fn init_on(window: &tauri::Window) -> Result<Self, Box<dyn std::error::Error>> {
        let main = init_on(window, "chaoxing")?;
        main.hide()?;
        let mini = init_on(window, "chaoxing-mini")?;
        mini.hide()?;
        mini.set_zoom(0.2)?;
        Ok(Self { main, mini })
    }
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
            WebviewBuilder::new(
                label,
                WebviewUrl::External(CONFIG.home_url.clone()),
            )
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
        "chaoxing-mini" => (
            WebviewBuilder::new(label, WebviewUrl::External("about:blank".parse()?))
                .background_color((242, 244, 247).into())
                .devtools(true)
                .on_navigation(|url| url.as_str() == "about:blank" || classify(url) != Type::Unknown),
            LogicalPosition::new(logical_size.width * 0.884, logical_size.height * 0.834),
            LogicalSize::new(logical_size.width * 0.096, logical_size.height * 0.096),
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
