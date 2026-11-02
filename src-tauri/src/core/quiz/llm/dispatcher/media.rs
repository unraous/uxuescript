use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{
    Url,
    header::{HeaderMap, HeaderValue, REFERER},
    redirect::Policy,
};

use crate::core::{
    quiz::QuestionImage,
    url::{Type, classify},
};

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
// Base64 还会膨胀约三分之一，为 Gemini 的 20 MB 请求上限预留正文空间。
const MAX_BATCH_BYTES: usize = 14 * 1024 * 1024;
const CHAOXING_REFERER: &str = "https://mooc1-api.chaoxing.com/";

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

fn image_mime(mime: &str) -> &str {
    // 超星图片服务使用 image/jpg，模型接口需要标准的 image/jpeg。
    if mime == "image/jpg" {
        "image/jpeg"
    } else {
        mime
    }
}

async fn download(client: &reqwest::Client, url: &str) -> Result<(String, Vec<u8>)> {
    let url = Url::parse(url).context("图片地址无效")?;
    if classify(&url) == Type::Unknown {
        bail!("图片地址不属于可信超星域名: {url}");
    }
    let mut response = client.get(url.clone()).send().await?;
    if !response.status().is_success() {
        bail!("图片下载失败 ({}): {url}", response.status());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("");
    let mime = image_mime(mime).to_owned();
    if !matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        bail!("不支持的图片格式 {mime}: {url}");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            bail!("图片超过 5 MiB 限制: {url}");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((mime, bytes))
}

pub(super) async fn load(sources: &[(String, &[QuestionImage])]) -> Result<Vec<Image>> {
    if sources.iter().all(|(_, images)| images.is_empty()) {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .default_headers(HeaderMap::from_iter([(
            REFERER,
            HeaderValue::from_static(CHAOXING_REFERER),
        )]))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || classify(attempt.url()) == Type::Unknown {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()?;
    let mut total = 0;
    let mut result = Vec::new();
    for (owner, images) in sources {
        for image in *images {
            let (mime, bytes) = download(&client, &image.url)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_chaoxing_jpg_mime() {
        assert_eq!(image_mime("image/jpg"), "image/jpeg");
        assert_eq!(image_mime("image/png"), "image/png");
    }
}
