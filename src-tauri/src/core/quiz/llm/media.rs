use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};

use crate::core::{image, quiz::QuestionImage};

// Base64 还会膨胀约三分之一，为 Gemini 的 20 MB 请求上限预留正文空间。
const MAX_BATCH_BYTES: usize = 14 * 1024 * 1024;

pub(super) struct Image {
    pub owner: String,
    pub marker: String,
    pub mime: String,
    pub data: String,
}

impl Image {
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.mime, self.data)
    }
}

pub(super) async fn load(sources: &[(String, &[QuestionImage])]) -> Result<Vec<Image>> {
    if sources.iter().all(|(_, images)| images.is_empty()) {
        return Ok(Vec::new());
    }
    let client = image::client()?;
    let mut total = 0;
    let mut result = Vec::new();
    for (owner, images) in sources {
        for image in *images {
            let (mime, bytes) = image::download(&client, &image.url)
                .await
                .with_context(|| format!("{} 的 [{}] 无法读取", owner, image.marker))?;
            total += bytes.len();
            if total > MAX_BATCH_BYTES {
                bail!("当前批次图片总大小超过 14 MiB");
            }
            result.push(Image {
                owner: owner.clone(),
                marker: image.marker.clone(),
                mime,
                data: STANDARD.encode(bytes),
            });
        }
    }
    Ok(result)
}
