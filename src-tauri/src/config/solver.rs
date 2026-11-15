use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum SolverKind {
    #[default]
    NativeLlm,
    DeepSeekWeb,
}

#[cfg(test)]
#[path = "../../tests/unit/config/solver.rs"]
mod tests;
