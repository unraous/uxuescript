use super::Config;

#[test]
fn old_metadata_only_migrates_log_level_and_preserves_user_options() {
    let loaded = Config::parse(
        r#"
        [metadata]
        author = "changed"
        title = "changed"
        version = "0.0.0"
        homeUrl = "https://example.com/"
        logLevel = "Warn"
        [options]
        muteWebview = true
    "#,
    )
    .unwrap();
    assert_eq!(loaded.log_level, log::LevelFilter::Warn);
    assert!(loaded.options.lock().mute_webview);
    let saved: toml::Table = toml::from_str(&toml::to_string(&loaded).unwrap()).unwrap();
    assert!(!saved.contains_key("metadata"));
    assert!(saved.contains_key("log_level"));
}

#[test]
fn old_config_without_theme_uses_default_theme() {
    let loaded = Config::parse("[options]\nmuteWebview = true").unwrap();
    assert!(matches!(
        loaded.theme.lock().name,
        super::theme::ThemeName::Gentian
    ));
    assert!(loaded.options.lock().mute_webview);
}

#[test]
fn old_config_without_solver_uses_native_llm() {
    let loaded = Config::parse("[options]\nmuteWebview = true").unwrap();
    let solver: &parking_lot::Mutex<super::solver::SolverKind> = &loaded.solver;
    assert_eq!(*solver.lock(), super::solver::SolverKind::NativeLlm);
}

#[test]
fn solver_kind_round_trip_preserves_deep_seek_web() {
    let mut config = Config::default();
    *config.solver.get_mut() = super::solver::SolverKind::DeepSeekWeb;
    let deepseek = config.llm.providers.get_mut().get_mut("deepseek").unwrap();
    deepseek.api_key = Some(super::llm::ApiKey::new("test-api-key".into()).unwrap());
    deepseek.base_url = "https://example.com/chat/completions".into();

    let saved = toml::to_string_pretty(&config).unwrap();
    assert!(saved.contains("solver = \"deep_seek_web\""));

    let loaded = Config::parse(&saved).unwrap();
    assert_eq!(
        *loaded.solver.lock(),
        super::solver::SolverKind::DeepSeekWeb
    );
    let providers = loaded.llm.providers.lock();
    assert_eq!(
        providers["deepseek"].api_key.as_ref().unwrap().expose(),
        "test-api-key"
    );
    assert_eq!(
        providers["deepseek"].base_url,
        "https://example.com/chat/completions"
    );
}

#[test]
fn solver_selection_saves_to_file_and_restores_native_configuration() {
    let mut config = Config::default();
    *config.llm.active_provider.get_mut() = "deepseek".into();
    let provider = config.llm.providers.get_mut().get_mut("deepseek").unwrap();
    provider.models = vec!["saved-model".into()];
    provider.chosen_model = Some(0);
    provider.base_url = "https://example.com/chat/completions".into();
    provider.api_key = Some(super::llm::ApiKey::new("saved-native-api-key".into()).unwrap());
    let native = serde_json::to_value(&config.llm).unwrap();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "uxuescript-solver-{}-{unique}.toml",
        std::process::id()
    ));
    std::fs::File::create_new(&path).unwrap();
    config.paths.files.insert("config".into(), path.clone());

    for solver in [
        super::solver::SolverKind::DeepSeekWeb,
        super::solver::SolverKind::NativeLlm,
    ] {
        *config.solver.lock() = solver;
        config.save().unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        let loaded = Config::parse(&saved).unwrap();
        assert_eq!(*loaded.solver.lock(), solver);
        assert_eq!(serde_json::to_value(&loaded.llm).unwrap(), native);
        assert_eq!(serde_json::to_value(&config.llm).unwrap(), native);
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn migration_and_round_trip_preserve_selected_theme() {
    let loaded = Config::parse("[metadata]\nlogLevel = 'Warn'\n[theme]\nname = 'iris'").unwrap();
    let saved = toml::to_string_pretty(&loaded).unwrap();
    let reloaded = Config::parse(&saved).unwrap();
    assert!(matches!(
        reloaded.theme.lock().name,
        super::theme::ThemeName::Iris
    ));
    assert_eq!(reloaded.log_level, log::LevelFilter::Warn);
}

#[test]
fn explicit_log_level_takes_precedence_over_old_metadata() {
    let loaded = Config::parse("log_level = 'Error'\n[metadata]\nlogLevel = 'Warn'").unwrap();
    assert_eq!(loaded.log_level, log::LevelFilter::Error);
}

#[test]
fn version_change_refreshes_builtin_models_and_preserves_user_settings() {
    let mut previous = Config {
        version: "2.1.4".into(),
        ..Config::default()
    };
    *previous.llm.active_provider.get_mut() = "deepseek".into();
    let providers = previous.llm.providers.get_mut();
    let provider = providers.get_mut("deepseek").unwrap();
    provider.api_key = Some(super::llm::ApiKey::new("test-api-key-value".into()).unwrap());
    provider.base_url = "https://example.com/chat/completions".into();
    provider.models = vec!["removed-model".into()];
    provider.chosen_model = Some(0);
    let mut custom = provider.clone();
    custom.is_custom = true;
    custom.name = "My Provider".into();
    let custom_value = serde_json::to_value(&custom).unwrap();
    providers.insert("My Provider".into(), custom);
    let original_key = provider_key(&previous, "deepseek");

    let loaded = Config::parse(&toml::to_string(&previous).unwrap()).unwrap();
    assert_eq!(loaded.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(*loaded.llm.active_provider.lock(), "deepseek");
    assert_eq!(provider_key(&loaded, "deepseek"), original_key);
    let presets = super::LLMConfig::default();
    let providers = loaded.llm.providers.lock();
    for (id, preset) in presets.providers.lock().iter() {
        assert_eq!(providers[id].models, preset.models);
        assert_eq!(providers[id].chosen_model, preset.chosen_model);
    }
    assert_eq!(
        providers["deepseek"].base_url,
        "https://example.com/chat/completions"
    );
    assert_eq!(
        serde_json::to_value(&providers["My Provider"]).unwrap(),
        custom_value
    );
    assert_eq!(
        providers["bigmodel"].extra_body,
        presets.providers.lock()["bigmodel"].extra_body
    );
}

fn provider_key(config: &Config, id: &str) -> Option<super::llm::ApiKey> {
    config.llm.providers.lock()[id].api_key.clone()
}

#[test]
fn saved_configs_gain_new_presets_without_resetting_existing_providers() {
    for version in [env!("CARGO_PKG_VERSION"), "2.1.4"] {
        let mut previous = Config {
            version: version.into(),
            ..Config::default()
        };
        previous.llm.providers.get_mut().remove("bailian");
        previous.llm.providers.get_mut().remove("siliconflow");
        *previous.llm.active_provider.get_mut() = "deepseek".into();
        let provider = previous
            .llm
            .providers
            .get_mut()
            .get_mut("deepseek")
            .unwrap();
        provider.api_key = Some(super::llm::ApiKey::new("existing-api-key".into()).unwrap());
        provider.base_url = "https://example.com/chat/completions".into();

        let loaded = Config::parse(&toml::to_string(&previous).unwrap()).unwrap();
        assert_eq!(*loaded.llm.active_provider.lock(), "deepseek");
        assert_eq!(
            provider_key(&loaded, "deepseek"),
            provider_key(&previous, "deepseek")
        );
        let providers = loaded.llm.providers.lock();
        assert_eq!(providers["bailian"].name, "Bailian");
        assert!(!providers["bailian"].is_custom);
        assert_eq!(providers["siliconflow"].name, "SiliconFlow");
        assert!(!providers["siliconflow"].is_custom);
        assert_eq!(
            providers["deepseek"].base_url,
            "https://example.com/chat/completions"
        );
    }
}

#[test]
fn version_change_preserves_selected_model_by_name_after_reordering() {
    let mut previous = Config {
        version: "2.1.4".into(),
        ..Config::default()
    };
    let provider = previous
        .llm
        .providers
        .get_mut()
        .get_mut("bigmodel")
        .unwrap();
    let selected = provider.models[1].clone();
    provider.models = vec![selected.clone()];
    provider.chosen_model = Some(0);

    let loaded = Config::parse(&toml::to_string(&previous).unwrap()).unwrap();
    let providers = loaded.llm.providers.lock();
    let provider = &providers["bigmodel"];
    assert_eq!(provider.models[provider.chosen_model.unwrap()], selected);
    assert_eq!(provider.chosen_model, Some(1));
}

#[test]
fn same_version_and_round_trip_do_not_reset_models() {
    let mut previous = Config::default();
    let provider = previous.llm.providers.get_mut().get_mut("ollama").unwrap();
    provider.models = vec!["local-model".into()];
    provider.chosen_model = Some(0);
    for _ in 0..2 {
        previous = Config::parse(&toml::to_string(&previous).unwrap()).unwrap();
        let providers = previous.llm.providers.lock();
        assert_eq!(providers["ollama"].models, ["local-model"]);
        assert_eq!(providers["ollama"].chosen_model, Some(0));
    }
}

#[test]
fn legacy_and_unversioned_configs_refresh_models() {
    let mut previous = Config::default();
    previous
        .llm
        .providers
        .get_mut()
        .get_mut("bigmodel")
        .unwrap()
        .models = vec!["old-model".into()];
    let mut value: toml::Table = toml::from_str(&toml::to_string(&previous).unwrap()).unwrap();
    value.remove("version");
    let expected = super::LLMConfig::default().providers.lock()["bigmodel"]
        .models
        .clone();
    let unversioned = Config::parse(&toml::to_string(&value).unwrap()).unwrap();
    assert_eq!(
        unversioned.llm.providers.lock()["bigmodel"].models,
        expected
    );

    value.insert(
        "metadata".into(),
        toml::Value::Table(toml::Table::from_iter([(
            "version".into(),
            toml::Value::String("2.1.4".into()),
        )])),
    );
    let legacy = Config::parse(&toml::to_string(&value).unwrap()).unwrap();
    assert_eq!(legacy.llm.providers.lock()["bigmodel"].models, expected);
}
