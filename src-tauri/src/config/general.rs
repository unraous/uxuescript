use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Type)]
#[serde(rename_all = "lowercase")]
pub enum LabelLanguage {
    #[default]
    En,
    Zh,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralConfig {
    pub label_language: LabelLanguage,
    #[specta(type = u32)]
    pub concurrency: std::num::NonZeroU32,
    #[specta(type = u32)]
    pub batch_size: std::num::NonZeroU32,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            label_language: LabelLanguage::default(),
            concurrency: std::num::NonZeroU32::new(10).unwrap(),
            batch_size: std::num::NonZeroU32::new(5).unwrap(),
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/config/general.rs"]
mod tests;
