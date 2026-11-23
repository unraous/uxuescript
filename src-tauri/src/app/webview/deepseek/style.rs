use tauri::{Manager, Webview};

const SCROLLBAR_CSS: &str = r#"
::-webkit-scrollbar { width: 5px !important; height: 5px !important; }
::-webkit-scrollbar-track { background: transparent !important; }
::-webkit-scrollbar-thumb {
  background-color: var(--uxs-scrollbar-thumb) !important;
  border-radius: 0 !important;
}
::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }
"#;

pub(crate) fn sync_scrollbar(webview: &Webview) {
    let Some(main) = webview.window().get_webview("main") else {
        log::warn!("DeepSeek scrollbar theme source main WebView is missing");
        return;
    };
    let remote = webview.clone();
    if let Err(error) = main.eval_with_callback(
        "getComputedStyle(document.documentElement).getPropertyValue('--theme-brand-deep').trim()",
        move |raw| {
            let color = match serde_json::from_str::<String>(&raw) {
                Ok(color) if !color.is_empty() => color,
                _ => {
                    log::warn!("DeepSeek scrollbar theme color read failed");
                    return;
                }
            };
            let color = serde_json::to_string(&color).expect("theme color JSON");
            let css = serde_json::to_string(SCROLLBAR_CSS).expect("scrollbar CSS JSON");
            let script = format!(
                r#"(() => {{
  // The native color callback can arrive after navigation to another origin.
  if (window.location.origin !== 'https://chat.deepseek.com') return;
  let style = document.getElementById('uxs-deepseek-scrollbar');
  if (!style) {{
    style = document.createElement('style');
    style.id = 'uxs-deepseek-scrollbar';
    document.head.appendChild(style);
  }}
  style.textContent = {css};
  document.documentElement.style.setProperty('--uxs-scrollbar-thumb', {color});
}})()"#
            );
            if let Err(error) = remote.eval(&script) {
                log::warn!("DeepSeek scrollbar style dispatch failed: {error}");
            }
        },
    ) {
        log::warn!("DeepSeek scrollbar theme read dispatch failed: {error}");
    }
}
