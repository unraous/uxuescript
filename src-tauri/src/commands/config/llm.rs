pub mod ollama;

use super::CommandsResult;

use crate::config::{llm::LLMProvider, CONFIG};

/// 获取当前可用的全部大语言模型提供商列表。
#[tauri::command]
#[specta::specta]
pub fn providers() -> Vec<LLMProvider> {
    log::debug!("正在获取可用 AI Provider 列表...");
    let mut providers: Vec<LLMProvider> = CONFIG.llm.providers.lock().values().cloned().collect();
    providers.sort_by(|left, right| {
        left.is_custom
            .cmp(&right.is_custom)
            .then_with(|| left.name.cmp(&right.name))
    });
    log::info!("成功获取 AI Provider 列表: {:?}", providers);
    providers
}

/// 获取当前选中的大语言模型提供商。
#[tauri::command]
#[specta::specta]
pub fn current_provider() -> String {
    let provider = CONFIG.llm.active_provider.lock().clone();
    log::debug!("正在获取当前 AI Provider: {}", provider);
    provider
}

fn find_provider_id(
    providers: &std::collections::HashMap<String, LLMProvider>,
    name: &str,
) -> Option<String> {
    let normalized_name = name.trim().to_lowercase();
    providers.iter().find_map(|(id, provider)| {
        (id.to_lowercase() == normalized_name || provider.name.to_lowercase() == normalized_name)
            .then(|| id.clone())
    })
}

/// 新增或更新一个自定义大语言模型提供商。
#[tauri::command]
#[specta::specta]
pub fn upsert_provider(mut provider: LLMProvider) -> CommandsResult<()> {
    provider.name = provider.name.trim().to_owned();
    if provider.name.is_empty() {
        return Err(anyhow::anyhow!("AI Provider 名称不能为空").into());
    }
    if !provider.is_custom {
        return Err(anyhow::anyhow!("只能新增或更新自定义 AI Provider").into());
    }
    if let Some(api_key) = provider.api_key.take() {
        provider.api_key = Some(crate::config::llm::ApiKey::new(
            api_key.expose().to_owned(),
        )?);
    }

    let mut providers = CONFIG.llm.providers.lock();
    let name = provider.name.clone();
    if let Some(existing) = providers.get(&name) {
        if !existing.is_custom {
            return Err(anyhow::anyhow!("内置 AI Provider [{}] 不允许覆盖", name).into());
        }
    }

    let was_updated = providers.insert(name.clone(), provider).is_some();
    if was_updated {
        log::info!("成功更新 AI Provider: {}", name);
    } else {
        log::info!("成功添加 AI Provider: {}", name);
    }
    Ok(())
}

/// 移除一个自定义大语言模型提供商。
#[tauri::command]
#[specta::specta]
pub fn remove_provider(name: String) -> CommandsResult<()> {
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Err(anyhow::anyhow!("AI Provider 名称不能为空").into());
    }

    let mut providers = CONFIG.llm.providers.lock();
    let provider = providers
        .get(&name)
        .ok_or_else(|| anyhow::anyhow!("AI Provider [{}] 不存在", name))?;
    if !provider.is_custom {
        return Err(anyhow::anyhow!("内置 AI Provider [{}] 不允许移除", name).into());
    }

    providers.remove(&name);
    log::info!("成功移除自定义 AI Provider: {}", name);
    Ok(())
}

/// 将当前大语言模型提供商切换为指定提供商。
#[tauri::command]
#[specta::specta]
pub fn switch_provider(name: String) -> CommandsResult<()> {
    log::debug!("正在切换 AI Provider 到 [{}]", name);
    let providers = CONFIG.llm.providers.lock();
    if let Some(provider_id) = find_provider_id(&providers, &name) {
        *CONFIG.llm.active_provider.lock() = provider_id.clone();
        log::info!("成功切换 AI Provider 到 [{}]", provider_id);
        Ok(())
    } else {
        Err(anyhow::anyhow!("找不到 ID 为 [{}] 的大模型提供商", name).into())
    }
}

/// 将当前大语言模型提供商的选用模型切换为指定模型。
#[tauri::command]
#[specta::specta]
pub fn switch_model(index: u32) {
    let active_id = CONFIG.llm.active_provider.lock();
    let mut providers = CONFIG.llm.providers.lock();
    if let Some(p) = providers.get_mut(&*active_id) {
        let index = index as usize;
        if let Some(model) = p.models.get(index) {
            p.chosen_model = Some(index);
            log::info!(
                "AI Provider [{}] 已切换至模型 [{}]（索引：{}）",
                p.name,
                model,
                index
            );
        } else {
            p.chosen_model = None;
            log::warn!(
                "无法切换 AI Provider [{}] 的模型：索引 [{}] 超出 {} 个模型的范围，已清空模型选择",
                p.name,
                index,
                p.models.len()
            );
        }
    } else {
        log::warn!("当前 AI Provider [{}] 不存在，无法切换模型", *active_id);
    }
}

/// 设置当前大语言模型提供商的 API 密钥。
#[tauri::command]
#[specta::specta]
pub fn set_key(key: String) -> CommandsResult<()> {
    log::debug!("正在设置 API 密钥...");
    let active_id = CONFIG.llm.active_provider.lock();
    let mut providers = CONFIG.llm.providers.lock();
    if let Some(p) = providers.get_mut(&*active_id) {
        p.api_key = if key.trim().is_empty() {
            None
        } else {
            Some(crate::config::llm::ApiKey::new(key)?)
        };
    }
    log::info!("成功设置 API 密钥");
    Ok(())
}
