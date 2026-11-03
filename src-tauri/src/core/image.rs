use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{
    Url,
    header::{HeaderMap, HeaderValue, REFERER},
    redirect::Policy,
};

use crate::core::url::{Type, classify};

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const CHAOXING_REFERER: &str = "https://mooc1-api.chaoxing.com/";

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
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
}

pub(crate) fn client() -> reqwest::Result<reqwest::Client> {
    client_builder().build()
}

fn image_mime(mime: &str) -> &str {
    // 超星图片服务使用 image/jpg，模型接口需要标准的 image/jpeg。
    if mime == "image/jpg" {
        "image/jpeg"
    } else {
        mime
    }
}

pub(crate) async fn download(client: &reqwest::Client, url: &str) -> Result<(String, Vec<u8>)> {
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

/// 下载图片并生成可直接用于界面的 data URL。
pub(crate) async fn download_data_url(url: &str) -> Result<String> {
    let client = client()?;
    let (mime, bytes) = download(&client, url).await?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn normalizes_chaoxing_jpg_mime() {
        assert_eq!(image_mime("image/jpg"), "image/jpeg");
        assert_eq!(image_mime("image/png"), "image/png");
    }

    #[tokio::test]
    async fn downloads_trusted_image_with_chaoxing_referer() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let len = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..len]).to_lowercase();
            assert!(request.contains("referer: https://mooc1-api.chaoxing.com/"));
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\npng").unwrap();
        });
        let client = client_builder()
            .no_proxy()
            .resolve("p.cldisk.com", address)
            .build()
            .unwrap();
        let (mime, bytes) = download(
            &client,
            &format!("http://p.cldisk.com:{}/cover.png", address.port()),
        )
        .await
        .unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, b"png");
        server.join().unwrap();
    }
}
