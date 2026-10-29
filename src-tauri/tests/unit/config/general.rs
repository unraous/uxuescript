use super::*;

#[test]
fn label_language_defaults_and_round_trips() {
    let defaults: GeneralConfig = toml::from_str("").unwrap();
    assert_eq!(defaults.label_language, LabelLanguage::En);
    for language in [LabelLanguage::En, LabelLanguage::Zh] {
        let config = GeneralConfig {
            label_language: language,
            ..GeneralConfig::default()
        };
        let saved = toml::to_string(&config).unwrap();
        let loaded: GeneralConfig = toml::from_str(&saved).unwrap();
        assert_eq!(loaded.label_language, language);
    }
}

#[test]
fn request_settings_default_validate_and_round_trip() {
    let defaults: GeneralConfig = toml::from_str("").unwrap();
    assert_eq!(defaults.concurrency.get(), 10);
    assert_eq!(defaults.batch_size.get(), 5);
    for value in ["concurrency = 0", "batchSize = 0"] {
        assert!(toml::from_str::<GeneralConfig>(value).is_err());
    }
    let config: GeneralConfig = toml::from_str("concurrency = 2\nbatchSize = 3").unwrap();
    let reloaded: GeneralConfig = toml::from_str(&toml::to_string(&config).unwrap()).unwrap();
    assert_eq!(reloaded.concurrency.get(), 2);
    assert_eq!(reloaded.batch_size.get(), 3);
}
