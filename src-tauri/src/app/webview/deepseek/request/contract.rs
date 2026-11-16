use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

#[derive(Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
}

#[derive(Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    NotSent,
    Unknown,
    Confirmed,
}

#[derive(Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum Scalar {
    Text(String),
    Number(f64),
    Boolean(bool),
    Null,
}

#[derive(Serialize, Deserialize, Type)]
pub struct RequestError {
    pub code: String,
    pub message: String,
    pub stage: String,
    pub delivery: Delivery,
    pub remote: String,
    pub retryable: bool,
    pub diagnostics: BTreeMap<String, Scalar>,
}

// SDK 的 failed / uncertain / Promise reject 保持不同终态，内容只交给本地调用者。
#[derive(Serialize, Deserialize, Type)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Generation {
    Completed {
        request_id: String,
        content: String,
        duration_ms: u32,
    },
    Failed {
        request_id: String,
        error: RequestError,
        duration_ms: u32,
    },
    Uncertain {
        request_id: String,
        error: RequestError,
        duration_ms: u32,
    },
    Rejected {
        request_id: String,
        error: RequestError,
        duration_ms: u32,
    },
    Interrupted {
        request_id: String,
        code: String,
        delivery: Delivery,
        remote: String,
        quarantined: bool,
    },
}

impl Generation {
    pub(super) fn request_id(&self) -> &str {
        match self {
            Self::Completed { request_id, .. }
            | Self::Failed { request_id, .. }
            | Self::Uncertain { request_id, .. }
            | Self::Rejected { request_id, .. }
            | Self::Interrupted { request_id, .. } => request_id,
        }
    }
    pub(super) fn needs_quarantine(&self) -> bool {
        match self {
            Self::Completed { .. } => false,
            Self::Failed { error, .. } | Self::Rejected { error, .. } => {
                error.delivery != Delivery::NotSent && error.remote != "stopped"
            }
            Self::Uncertain { .. } | Self::Interrupted { .. } => true,
        }
    }
    pub(super) fn status(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "completed",
            Self::Failed { .. } => "failed",
            Self::Uncertain { .. } => "uncertain",
            Self::Rejected { .. } => "rejected",
            Self::Interrupted { .. } => "interrupted",
        }
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Identity {
    pub(super) document_token: String,
    pub(super) binding_generation: u64,
    pub(super) request_id: String,
}

#[derive(Serialize)]
pub(super) struct Envelope<'a> {
    #[serde(flatten)]
    pub(super) identity: &'a Identity,
    pub(super) text: &'a str,
    pub(super) options: &'a Options,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Ack {
    Accepted {
        #[serde(flatten)]
        identity: Identity,
    },
    Rejected {
        code: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Poll {
    Pending {
        #[serde(flatten)]
        identity: Identity,
    },
    Terminal {
        #[serde(flatten)]
        identity: Identity,
        result: Generation,
    },
    Interrupted {
        #[serde(flatten)]
        identity: Identity,
        code: String,
    },
    Rejected {
        code: String,
    },
}

pub(super) fn parse_poll(raw: &str, expected: &Identity) -> Result<Poll, &'static str> {
    let poll: Poll = serde_json::from_str(raw).map_err(|_| "INVALID_RESULT")?;
    let identity = match &poll {
        Poll::Pending { identity }
        | Poll::Terminal { identity, .. }
        | Poll::Interrupted { identity, .. } => identity,
        Poll::Rejected { .. } => return Ok(poll),
    };
    if identity != expected {
        return Err("IDENTITY_MISMATCH");
    }
    if let Poll::Terminal { result, .. } = &poll {
        if result.request_id() != expected.request_id
            || matches!(result, Generation::Interrupted { .. })
        {
            return Err("IDENTITY_MISMATCH");
        }
    }
    Ok(poll)
}

pub(super) fn bridge_script(method: &str, value: &impl Serialize) -> Result<String, &'static str> {
    let json = serde_json::to_string(value).map_err(|_| "SERIALIZE_FAILED")?;
    let operation = if matches!(method, "ack" | "cancel") {
        format!("({{kind: 'confirmed', confirmed: controller.{method}({json})}})")
    } else {
        format!("controller.{method}({json})")
    };
    Ok(format!(
        r#"(() => {{
      try {{
        if (window.top !== window || window.location.origin !== 'https://chat.deepseek.com') return {{kind: 'target_skipped'}};
        const controller = globalThis.__UXS_DEEPSEEK_B1__;
        if (!controller) return {{kind: 'bootstrap_missing'}};
        return {operation};
      }} catch {{ return {{kind: 'bridge_failed'}}; }}
    }})()"#
    ))
}
