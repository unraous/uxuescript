use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeName {
    #[default]
    Gentian,
    Delphinium,
    Camellia,
    Gardenia,
    Marigold,
    Cornflower,
    Charcoal,
    Iris,
    Dahlia,
    Poppy,
    Peony,
    Wisteria,
    Lotus,
    Hydrangea,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(default)]
pub struct ThemeConfig {
    pub name: ThemeName,
}
