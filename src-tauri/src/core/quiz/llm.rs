mod dispatcher;

pub use dispatcher::solve;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Type)]
pub struct AnswerItem {
    pub index: String,
    pub explanation: String,
    pub content: String,
}
