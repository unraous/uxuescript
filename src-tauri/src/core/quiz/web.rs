mod deepseek;

use crate::{
    app::webview::deepseek::request::RequestState,
    config::CONFIG,
    core::quiz::{Folio, llm::AnswerItem, mapper::decrypt},
};
use anyhow::Result;

pub(super) async fn solve(payload: Folio, requests: &RequestState) -> Result<Vec<AnswerItem>> {
    let folio = decrypt(payload);
    let size = CONFIG.general.lock().batch_size.get() as usize;
    deepseek::solve(folio, size, requests).await
}
