//! 抓一个网页回来。
//!
//! 走 Rust 而不是前端 `fetch`，理由和搜索命令一样：渲染进程发跨域请求会被 CORS 挡住，
//! 而这里要抓的是任意站点，不可能指望人家给你配 `Access-Control-Allow-Origin`。
//!
//! 只负责**取回文本**，标题、正文、封面的提取在前端做——那边有现成的 DOM 解析器，
//! 在 Rust 里再引一套 HTML 解析库不划算。
//!
//! 三条限制都是为了不让一次误点把应用拖垮：只认 http/https、有超时、有体积上限。

use std::time::Duration;

use serde::Serialize;

/// 请求超时。网页比 API 慢得多，但超过这个数基本就是对面挂了。
const TIMEOUT_SECS: u64 = 20;

/// 最多读这么多字节。正文提取只需要开头那部分，一个塞了几十兆内联数据的页面不值得等。
const MAX_BYTES: usize = 5 * 1024 * 1024;

/// 有些站点对没有 UA 的请求直接返回 403。
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

#[derive(Serialize)]
pub struct WebPageFetch {
    /** 跟完重定向之后的最终地址：相对链接要按它来解析。 */
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub html: String,
}

/// 只放行 http/https。`file://` 能读本地任意文件，`data:` 能绕过一切检查——
/// 这个命令的输入来自用户粘贴的文本，不能假设它是干净的。
pub fn is_fetchable_url(raw: &str) -> bool {
    let lowered = raw.trim().to_ascii_lowercase();
    lowered.starts_with("http://") || lowered.starts_with("https://")
}

#[tauri::command]
pub async fn fetch_webpage(url: String) -> Result<WebPageFetch, String> {
    if !is_fetchable_url(&url) {
        return Err("unsupported_scheme".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("network: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] fetch_webpage network error: {e}");
            format!("network: {e}")
        })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = response.bytes().await.map_err(|e| format!("network: {e}"))?;
    let truncated = if bytes.len() > MAX_BYTES {
        &bytes[..MAX_BYTES]
    } else {
        &bytes[..]
    };
    // 页面编码五花八门；from_utf8_lossy 至少保证不会因为几个坏字节整页失败
    let html = String::from_utf8_lossy(truncated).to_string();

    if !status.is_success() {
        eprintln!("[Spoor] fetch_webpage HTTP {status} url={final_url}");
        return Err(format!("http_{}", status.as_u16()));
    }

    Ok(WebPageFetch {
        final_url,
        status: status.as_u16(),
        content_type,
        html,
    })
}

#[cfg(test)]
mod tests {
    use super::is_fetchable_url;

    #[test]
    fn accepts_http_and_https() {
        assert!(is_fetchable_url("https://example.com"));
        assert!(is_fetchable_url("  HTTP://example.com/a "));
    }

    #[test]
    fn rejects_schemes_that_could_read_local_state() {
        assert!(!is_fetchable_url("file:///C:/Windows/win.ini"));
        assert!(!is_fetchable_url("data:text/html,<script>"));
        assert!(!is_fetchable_url("javascript:alert(1)"));
        assert!(!is_fetchable_url("spoor-media://x"));
        assert!(!is_fetchable_url(""));
    }
}
