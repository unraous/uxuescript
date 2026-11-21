use crate::{
    app::webview::deepseek::request::{Generation, Options, RequestState, TextBinding},
    core::quiz::{
        Entry, Folio,
        llm::{AnswerItem, answers, batch, prompt},
    },
};
use anyhow::Result;

pub(super) async fn solve(
    folio: Folio,
    size: usize,
    requests: &RequestState,
) -> Result<Vec<AnswerItem>> {
    let binding = TextBinding::default();
    let binding = &binding;
    solve_with(folio, size, |text| async move {
        requests
            .generate_text(&text, Options::default(), binding)
            .await
    })
    .await
}

/// 先完成整卷预检与 Prompt 组装，再串行请求；任何失败不交付部分答案。
async fn solve_with<F, Fut>(folio: Folio, size: usize, mut generate: F) -> Result<Vec<AnswerItem>>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<Generation, &'static str>> + Send,
{
    require_text(&folio.entries)?;
    let batches = batch::prepare(folio, size)?;
    let mut prepared = Vec::with_capacity(batches.len());
    for batch in batches {
        let text = prompt::text(&batch)?;
        prepared.push((batch, text));
    }
    let mut all_answers = Vec::new();
    for (batch, text) in prepared {
        let generation = generate(text).await.map_err(|code| {
            let state = if code == "QUARANTINED" {
                "delivery=not_sent remote=unknown quarantined=true"
            } else {
                "delivery=not_sent remote=not_started quarantined=false"
            };
            anyhow::anyhow!("DeepSeek Web {code}: {state}；本次任务停止，未返回部分答案")
        })?;
        if let Some(summary) = generation.failure_summary() {
            anyhow::bail!("DeepSeek Web {summary}；本次任务停止，未返回部分答案");
        }
        let Generation::Completed { content, .. } = generation else {
            unreachable!("failure_summary 已处理所有非 completed 终态")
        };
        // parse 的 Serde 错误可能回显回答片段；Web 只交付固定阶段，不记录模型正文。
        let answers = answers::parse(&content, batch.questions.iter().map(|item| &item.question))
            .map_err(|_| anyhow::anyhow!(
                "DeepSeek Web INVALID_ANSWER: stage=parsing；答案未通过 JSON、题号、数量或空数校验；本次任务停止，未返回部分答案"
            ))?;
        log::debug!("DeepSeek B3 batch_parsed answers={}", answers.len());
        all_answers.extend(answers);
    }
    Ok(all_answers)
}

/// 材料中的图片即使位于空题组也不能被丢弃；全卷发送前检查。
fn require_text(entries: &[Entry]) -> Result<()> {
    for entry in entries {
        match entry {
            Entry::Question(question) if !question.images.is_empty() => {
                anyhow::bail!(
                    "DeepSeek Web UNSUPPORTED_IMAGES: 题号 {} 含图片，仅支持纯文本；本次未发送",
                    question.data.id
                );
            }
            Entry::Section(section) => {
                if section
                    .passage
                    .as_ref()
                    .is_some_and(|passage| !passage.images.is_empty())
                {
                    anyhow::bail!(
                        "DeepSeek Web UNSUPPORTED_IMAGES: 材料含图片，仅支持纯文本；本次未发送"
                    );
                }
                require_text(&section.entries)?;
            }
            Entry::Question(_) => {}
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../../tests/unit/core/quiz/web/deepseek.rs"]
mod tests;
