use crate::{commands::CommandsResult, config::CONFIG};

/// 从本地 Ollama 服务拉取可用模型列表更新至内存配置。
#[uxs_commands::command]
pub async fn fetch_ollama_models() -> CommandsResult<()> {
    log::debug!("正在从 Ollama 服务拉取最新模型列表...");
    let base_url = {
        let providers = CONFIG.llm.providers.lock();
        let p = providers
            .get("ollama")
            .ok_or_else(|| anyhow::anyhow!("找不到 Ollama 提供商"))?;
        p.base_url.clone()
    };

    let models = crate::config::llm::ollama::fetch_models(&base_url).await;
    if models.is_empty() {
        return Err(anyhow::anyhow!("未能从 Ollama 服务 [{}] 获取到可用模型列表", base_url).into());
    }

    let mut providers = CONFIG.llm.providers.lock();
    if let Some(p) = providers.get_mut("ollama") {
        p.models = models;
        p.chosen_model = Some(0);
    }
    log::info!("Ollama 模型列表更新完成");
    Ok(())
}
