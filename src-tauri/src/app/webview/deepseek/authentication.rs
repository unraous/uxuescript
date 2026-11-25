//! Read-only identity query, independent of Adapter session binding and requests.
use super::{Observer, request::RequestState};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{sync::Arc, time::Duration};
use tauri::Webview;
use tokio::sync::oneshot;

#[derive(Debug, Deserialize, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthenticationStatus {
    Checking,
    Authenticated,
    Unauthenticated,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize, Type)]
pub struct Authentication {
    pub status: AuthenticationStatus,
    pub diagnostic: Option<String>,
}

impl Authentication {
    fn interrupted(code: &str) -> Self {
        Self {
            status: AuthenticationStatus::Checking,
            diagnostic: Some(code.into()),
        }
    }

    fn failed(code: &str) -> Self {
        log::warn!("DeepSeek authentication {code}");
        Self {
            status: AuthenticationStatus::Unknown,
            diagnostic: Some(code.into()),
        }
    }
}

// eval_with_callback does not await JavaScript promises on Windows. Start one
// bounded request in the document controller, then read its synchronous result.
const START: &str = r#"(() => {
  if (window.top !== window || window.location.origin !== 'https://chat.deepseek.com') return null;
  return globalThis.__UXS_DEEPSEEK_B1__?.startAuthenticationCheck() ?? null;
})()"#;

async fn evaluate(
    observer: &Observer,
    epoch: u64,
    webview: &Webview,
    script: &str,
) -> Result<String, &'static str> {
    let (send, receive) = oneshot::channel();
    let send = Mutex::new(Some(send));
    let mut dispatched = Ok(());
    if !observer.while_current(epoch, || {
        dispatched = webview.eval_with_callback(script, move |raw| {
            if let Some(send) = send.lock().take() {
                let _ = send.send(raw);
            }
        });
    }) {
        return Err("DOCUMENT_CHANGED");
    }
    dispatched.map_err(|_| "AUTH_EVAL_FAILED")?;
    let raw = tokio::time::timeout(Duration::from_secs(2), receive)
        .await
        .map_err(|_| "AUTH_CALLBACK_TIMEOUT")?
        .map_err(|_| "AUTH_CALLBACK_DROPPED")?;
    if !observer.is_current(epoch) {
        return Err("DOCUMENT_CHANGED");
    }
    Ok(raw)
}

pub(crate) async fn query(requests: &Arc<RequestState>, webview: &Webview) -> Authentication {
    let observer = &requests.observer;
    let epoch = {
        let page = observer.0.lock();
        if page.closed {
            return Authentication::failed("DOCUMENT_CLOSED");
        }
        if !page.loaded {
            return Authentication::interrupted("DOCUMENT_LOADING");
        }
        page.generation
    };
    match query_current(observer, epoch, webview).await {
        Ok(result) => result,
        Err("DOCUMENT_CHANGED" | "BOOTSTRAP_NOT_READY") => {
            Authentication::interrupted("DOCUMENT_LOADING")
        }
        Err(code) => Authentication::failed(code),
    }
}

async fn query_current(
    observer: &Observer,
    epoch: u64,
    webview: &Webview,
) -> Result<Authentication, &'static str> {
    let raw = evaluate(observer, epoch, webview, START).await?;
    let id: Option<u64> = serde_json::from_str(&raw).map_err(|_| "INVALID_AUTH_CHECK")?;
    let id = id.ok_or("BOOTSTRAP_NOT_READY")?;
    let script = format!("globalThis.__UXS_DEEPSEEK_B1__?.readAuthenticationCheck({id}) ?? null");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        let raw = evaluate(observer, epoch, webview, &script).await?;
        let result = parse_current(observer, epoch, &raw)?;
        if result.status != AuthenticationStatus::Checking || result.diagnostic.is_some() {
            if result.status == AuthenticationStatus::Unknown {
                log::warn!("DeepSeek authentication {:?}", result.diagnostic);
            }
            return Ok(result);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("AUTH_QUERY_TIMEOUT")
}

fn parse_current(
    observer: &Observer,
    epoch: u64,
    raw: &str,
) -> Result<Authentication, &'static str> {
    let mut result = Err("DOCUMENT_CHANGED");
    observer.while_current(epoch, || {
        result = serde_json::from_str(raw).map_err(|_| "INVALID_AUTH_RESPONSE");
    });
    result
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/webview/deepseek/authentication.rs"]
mod tests;
