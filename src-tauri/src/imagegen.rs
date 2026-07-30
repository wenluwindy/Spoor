//! 生图：四种协议的适配器，全链路在 Rust 内闭环。
//!
//! 「闭环」的意思是请求、解析、下载原图、落盘都在这里完成，前端只拿到相对路径。
//! 收益：大二进制不穿过 IPC · 不受 CORS 约束 · 云端原始字节零损耗落盘（决策 17）·
//! 错误处理集中一处。
//!
//! 参考图同理走相对路径而不是 base64：画布上的图本来就在数据根里，
//! 再编码一遍塞进 IPC 是白花钱。旧的 data URL 节点仍然认。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::media;

/// 归一后的错误码。前端用 `t('imagegen.errors.' + code)` 翻译，`detail` 折叠显示。
#[derive(Serialize, Debug)]
pub struct ImageGenError {
    pub code: String,
    pub http_status: Option<u16>,
    pub detail: Option<String>,
}

impl ImageGenError {
    fn new(code: &str) -> Self {
        Self { code: code.into(), http_status: None, detail: None }
    }
    fn with_detail(code: &str, detail: impl Into<String>) -> Self {
        Self { code: code.into(), http_status: None, detail: Some(detail.into()) }
    }
    fn http(status: u16, body: &str) -> Self {
        // 服务商的报错正文动辄几 KB，截断后仍足够定位问题
        let detail: String = body.chars().take(600).collect();
        Self {
            code: classify_http(status, body).into(),
            http_status: Some(status),
            detail: Some(detail),
        }
    }
}

/// HTTP 失败细分。都归成 `http_error` 的话，用户看不出「该充值」还是「该改提示词」。
fn classify_http(status: u16, body: &str) -> &'static str {
    let lower = body.to_ascii_lowercase();
    if status == 401 || status == 403 {
        return "auth_failed";
    }
    if status == 429 || lower.contains("quota") || lower.contains("rate limit") {
        return "quota_exceeded";
    }
    if lower.contains("content_policy")
        || lower.contains("safety")
        || lower.contains("content filter")
        || lower.contains("审核")
    {
        return "content_filtered";
    }
    "http_error"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenRequest {
    /// `doubao_seedream` | `openai_images` | `gemini_image` | `custom_openai_images`
    pub api_kind: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    /// 参考图：数据根内的相对路径，或旧节点的 data URL。空则为文生图。
    #[serde(default)]
    pub ref_images: Vec<String>,
    pub size: Option<String>,
    pub n: Option<u32>,
    pub quality: Option<String>,
    /// 前端生成，用于取消。
    pub task_id: String,
}

// ───────────────────────────── 取消 ─────────────────────────────

type CancelRegistry = Mutex<HashMap<String, Arc<AtomicBool>>>;

fn cancel_registry() -> &'static CancelRegistry {
    static REGISTRY: OnceLock<CancelRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_task(task_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancel_registry().lock() {
        map.insert(task_id.to_string(), Arc::clone(&flag));
    }
    flag
}

fn unregister_task(task_id: &str) {
    if let Ok(mut map) = cancel_registry().lock() {
        map.remove(task_id);
    }
}

/// 取消一个进行中的生图任务。任务已结束时是空操作。
#[tauri::command]
pub fn image_generate_cancel(task_id: String) {
    if let Ok(map) = cancel_registry().lock() {
        if let Some(flag) = map.get(&task_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

fn check_cancelled(flag: &AtomicBool) -> Result<(), ImageGenError> {
    if flag.load(Ordering::SeqCst) {
        return Err(ImageGenError::new("aborted"));
    }
    Ok(())
}

// ───────────────────────────── 工具 ─────────────────────────────

fn trim_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// 猜扩展名。云端多数返回 PNG，但 Seedream 的 URL 常是 jpeg。
fn ext_from_mime(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        m if m.contains("jpeg") || m.contains("jpg") => "jpg",
        m if m.contains("webp") => "webp",
        m if m.contains("gif") => "gif",
        _ => "png",
    }
}

/// 按文件头判类型。服务商偶尔不给 Content-Type，或者给个 octet-stream。
fn ext_from_magic(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "webp"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        "png"
    }
}

/// 云端字节原样落盘，**不做任何重编码或压缩**（决策 17）。
fn store_image_bytes(bytes: Vec<u8>, ext: &str) -> Result<String, ImageGenError> {
    let root = media::data_root();
    let rel = media::new_relative_path(media::CATEGORY_GENERATED, ext);
    let dest = root.join(&rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ImageGenError::with_detail("disk_write_failed", e.to_string()))?;
    }
    std::fs::write(&dest, bytes)
        .map_err(|e| ImageGenError::with_detail("disk_write_failed", e.to_string()))?;
    Ok(rel)
}

/// 参考图 → (base64, mime)。相对路径读盘，data URL 就地拆。
fn load_reference(spec: &str) -> Option<(String, String)> {
    if let Some(rest) = spec.strip_prefix("data:") {
        let (mime, payload) = rest.split_once(";base64,")?;
        return Some((payload.to_string(), mime.to_string()));
    }
    let path = media::resolve_media_path(media::data_root(), spec)?;
    let bytes = std::fs::read(&path).ok()?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
    Some((b64().encode(bytes), mime))
}

fn load_references(specs: &[String], limit: usize) -> Vec<(String, String)> {
    specs.iter().take(limit).filter_map(|s| load_reference(s)).collect()
}

fn client() -> Result<reqwest::Client, ImageGenError> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| ImageGenError::with_detail("network", e.to_string()))
}

async fn post_json(
    url: &str,
    headers: Vec<(&str, String)>,
    body: Value,
) -> Result<Value, ImageGenError> {
    let mut req = client()?.post(url).json(&body);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let response = req.send().await.map_err(|e| {
        eprintln!("[Spoor] image_generate network error: {e} (url={url})");
        ImageGenError::with_detail("network", e.to_string())
    })?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        eprintln!("[Spoor] image_generate HTTP {status} url={url}");
        return Err(ImageGenError::http(status.as_u16(), &text));
    }
    serde_json::from_str(&text)
        .map_err(|e| ImageGenError::with_detail("bad_response", format!("{e}: {text:.400}")))
}

/// 下载 URL 型结果的原始字节。
async fn download(url: &str) -> Result<(Vec<u8>, String), ImageGenError> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| ImageGenError::with_detail("network", e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(ImageGenError::http(status.as_u16(), "download failed"));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| ImageGenError::with_detail("network", e.to_string()))?;
    Ok((bytes.to_vec(), mime))
}

fn decode_b64(payload: &str) -> Result<Vec<u8>, ImageGenError> {
    b64()
        .decode(payload.trim())
        .map_err(|e| ImageGenError::with_detail("bad_response", e.to_string()))
}

// ───────────────────────────── 响应解析 ─────────────────────────────

/// OpenAI 兼容响应里把图抠出来。
///
/// 自定义端点各家字段不一，按 `b64_json` → `url` → 顶层 `images[]` 逐级嗅探
/// （见计划 §11 的「自动嗅探」）。
pub fn extract_openai_style_images(body: &Value) -> Vec<ImagePayload> {
    let mut out = Vec::new();

    if let Some(items) = body.get("data").and_then(|d| d.as_array()) {
        for item in items {
            if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
                out.push(ImagePayload::Base64(b64.to_string()));
            } else if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
                out.push(ImagePayload::Url(url.to_string()));
            }
        }
    }

    if out.is_empty() {
        if let Some(items) = body.get("images").and_then(|d| d.as_array()) {
            for item in items {
                match item {
                    Value::String(s) if s.starts_with("http") => {
                        out.push(ImagePayload::Url(s.clone()))
                    }
                    Value::String(s) => out.push(ImagePayload::Base64(s.clone())),
                    _ => {
                        if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
                            out.push(ImagePayload::Url(url.to_string()));
                        } else if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
                            out.push(ImagePayload::Base64(b64.to_string()));
                        }
                    }
                }
            }
        }
    }
    out
}

/// Gemini 的图在 `candidates[].content.parts[].inlineData`。
pub fn extract_gemini_images(body: &Value) -> Vec<ImagePayload> {
    let mut out = Vec::new();
    let Some(candidates) = body.get("candidates").and_then(|v| v.as_array()) else {
        return out;
    };
    for candidate in candidates {
        let Some(parts) = candidate
            .get("content")
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        else {
            continue;
        };
        for part in parts {
            // camelCase 与 snake_case 都见过，两个都认
            let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
            if let Some(inline) = inline {
                if let Some(data) = inline.get("data").and_then(|v| v.as_str()) {
                    let mime = inline
                        .get("mimeType")
                        .or_else(|| inline.get("mime_type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("image/png");
                    out.push(ImagePayload::Base64WithMime(data.to_string(), mime.to_string()));
                }
            }
        }
    }
    out
}

#[derive(Debug, PartialEq)]
pub enum ImagePayload {
    Url(String),
    Base64(String),
    Base64WithMime(String, String),
}

async fn persist(payload: ImagePayload) -> Result<String, ImageGenError> {
    match payload {
        ImagePayload::Url(url) => {
            let (bytes, mime) = download(&url).await?;
            let ext = if mime.is_empty() { ext_from_magic(&bytes) } else { ext_from_mime(&mime) };
            store_image_bytes(bytes, ext)
        }
        ImagePayload::Base64(data) => {
            let bytes = decode_b64(&data)?;
            let ext = ext_from_magic(&bytes);
            store_image_bytes(bytes, ext)
        }
        ImagePayload::Base64WithMime(data, mime) => {
            let bytes = decode_b64(&data)?;
            store_image_bytes(bytes, ext_from_mime(&mime))
        }
    }
}

// ───────────────────────────── 四种适配器 ─────────────────────────────

/// 火山方舟 Seedream。参考图走 body 里的 `image`（单张字符串 / 多张数组）。
async fn generate_doubao(req: &ImageGenRequest) -> Result<Vec<ImagePayload>, ImageGenError> {
    let url = format!("{}/images/generations", trim_base(&req.base_url));
    let mut body = json!({
        "model": req.model,
        "prompt": req.prompt,
        "response_format": "url",
        "watermark": false,
    });
    if let Some(size) = &req.size {
        body["size"] = json!(size);
    }

    let refs = load_references(&req.ref_images, 4);
    if !refs.is_empty() {
        let urls: Vec<String> = refs
            .iter()
            .map(|(data, mime)| format!("data:{mime};base64,{data}"))
            .collect();
        // 单张时给字符串：部分版本不接受长度为 1 的数组
        body["image"] = if urls.len() == 1 { json!(urls[0]) } else { json!(urls) };
    }

    let response = post_json(
        &url,
        vec![("Authorization", format!("Bearer {}", req.api_key.trim()))],
        body,
    )
    .await?;
    Ok(extract_openai_style_images(&response))
}

/// OpenAI Images。有参考图时走 `/images/edits` 的 multipart，否则 `/images/generations`。
async fn generate_openai(req: &ImageGenRequest) -> Result<Vec<ImagePayload>, ImageGenError> {
    let base = trim_base(&req.base_url);
    let refs = load_references(&req.ref_images, 4);

    if refs.is_empty() {
        let mut body = json!({ "model": req.model, "prompt": req.prompt });
        if let Some(size) = &req.size {
            body["size"] = json!(size);
        }
        if let Some(n) = req.n {
            body["n"] = json!(n);
        }
        if let Some(quality) = &req.quality {
            body["quality"] = json!(quality);
        }
        let response = post_json(
            &format!("{base}/images/generations"),
            vec![("Authorization", format!("Bearer {}", req.api_key.trim()))],
            body,
        )
        .await?;
        return Ok(extract_openai_style_images(&response));
    }

    // 图生图：multipart，`image[]` 收多文件
    let mut form = reqwest::multipart::Form::new()
        .text("model", req.model.clone())
        .text("prompt", req.prompt.clone());
    if let Some(size) = &req.size {
        form = form.text("size", size.clone());
    }
    for (index, (data, mime)) in refs.iter().enumerate() {
        let bytes = decode_b64(data)?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(format!("ref{index}.{}", ext_from_mime(mime)))
            .mime_str(mime)
            .map_err(|e| ImageGenError::with_detail("bad_response", e.to_string()))?;
        form = form.part("image[]", part);
    }

    let response = client()?
        .post(format!("{base}/images/edits"))
        .header("Authorization", format!("Bearer {}", req.api_key.trim()))
        .multipart(form)
        .send()
        .await
        .map_err(|e| ImageGenError::with_detail("network", e.to_string()))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ImageGenError::http(status.as_u16(), &text));
    }
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| ImageGenError::with_detail("bad_response", e.to_string()))?;
    Ok(extract_openai_style_images(&parsed))
}

/// Gemini（Nano Banana）。走 REST 而非 SDK——请求在 Rust 侧发。
async fn generate_gemini(req: &ImageGenRequest) -> Result<Vec<ImagePayload>, ImageGenError> {
    let url = format!(
        "{}/models/{}:generateContent",
        trim_base(&req.base_url),
        req.model
    );

    let mut parts = vec![json!({ "text": req.prompt })];
    for (data, mime) in load_references(&req.ref_images, 3) {
        parts.push(json!({ "inlineData": { "mimeType": mime, "data": data } }));
    }

    let body = json!({
        "contents": [{ "parts": parts }],
        "generationConfig": { "responseModalities": ["IMAGE"] },
    });

    // Gemini 用 x-goog-api-key，不是 Bearer
    let response = post_json(&url, vec![("x-goog-api-key", req.api_key.trim().to_string())], body).await?;
    Ok(extract_gemini_images(&response))
}

// ───────────────────────────── 入口 ─────────────────────────────

async fn dispatch(req: &ImageGenRequest) -> Result<Vec<ImagePayload>, ImageGenError> {
    match req.api_kind.as_str() {
        "doubao_seedream" => generate_doubao(req).await,
        // 自定义端点按 OpenAI 兼容处理，解析时会自动嗅探字段
        "openai_images" | "custom_openai_images" => generate_openai(req).await,
        "gemini_image" => generate_gemini(req).await,
        other => Err(ImageGenError::with_detail("provider_unsupported", other.to_string())),
    }
}

/// 生成图片，返回数据根内的相对路径（最新在前由前端负责）。
#[tauri::command]
pub async fn image_generate(req: ImageGenRequest) -> Result<Vec<String>, ImageGenError> {
    if req.api_key.trim().is_empty() && req.api_kind != "custom_openai_images" {
        return Err(ImageGenError::new("no_api_key"));
    }
    if req.model.trim().is_empty() {
        return Err(ImageGenError::new("no_model"));
    }
    if req.prompt.trim().is_empty() {
        return Err(ImageGenError::new("no_prompt"));
    }

    let flag = register_task(&req.task_id);
    let result = run(&req, &flag).await;
    unregister_task(&req.task_id);
    result
}

async fn run(req: &ImageGenRequest, flag: &AtomicBool) -> Result<Vec<String>, ImageGenError> {
    check_cancelled(flag)?;
    let payloads = dispatch(req).await?;
    if payloads.is_empty() {
        return Err(ImageGenError::new("no_image"));
    }

    let mut out = Vec::with_capacity(payloads.len());
    for payload in payloads {
        // 每张之间检查一次：多图时用户点取消不该还得等完
        check_cancelled(flag)?;
        out.push(persist(payload).await?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_auth_failures() {
        assert_eq!(classify_http(401, ""), "auth_failed");
        assert_eq!(classify_http(403, ""), "auth_failed");
    }

    #[test]
    fn classifies_quota_by_status_or_body() {
        assert_eq!(classify_http(429, ""), "quota_exceeded");
        assert_eq!(classify_http(400, "insufficient quota"), "quota_exceeded");
        assert_eq!(classify_http(400, "Rate limit reached"), "quota_exceeded");
    }

    #[test]
    fn classifies_content_filter() {
        assert_eq!(classify_http(400, "content_policy_violation"), "content_filtered");
        assert_eq!(classify_http(400, "blocked by safety settings"), "content_filtered");
        assert_eq!(classify_http(400, "内容审核未通过"), "content_filtered");
    }

    #[test]
    fn falls_back_to_generic_http_error() {
        assert_eq!(classify_http(500, "internal error"), "http_error");
    }

    #[test]
    fn http_error_truncates_long_bodies() {
        let err = ImageGenError::http(500, &"x".repeat(5000));
        assert_eq!(err.detail.as_ref().unwrap().chars().count(), 600);
        assert_eq!(err.http_status, Some(500));
    }

    #[test]
    fn trims_trailing_slashes_from_base() {
        assert_eq!(trim_base("https://x/v1/"), "https://x/v1");
        assert_eq!(trim_base("  https://x/v1  "), "https://x/v1");
    }

    // ── 响应解析 ──

    #[test]
    fn extracts_openai_b64() {
        let body = json!({ "data": [{ "b64_json": "AAA" }, { "b64_json": "BBB" }] });
        assert_eq!(
            extract_openai_style_images(&body),
            vec![ImagePayload::Base64("AAA".into()), ImagePayload::Base64("BBB".into())]
        );
    }

    #[test]
    fn extracts_openai_url() {
        let body = json!({ "data": [{ "url": "https://cdn/x.png" }] });
        assert_eq!(
            extract_openai_style_images(&body),
            vec![ImagePayload::Url("https://cdn/x.png".into())]
        );
    }

    #[test]
    fn prefers_b64_over_url_when_both_present() {
        // 有 b64 就不必再跑一趟网络
        let body = json!({ "data": [{ "b64_json": "AAA", "url": "https://cdn/x.png" }] });
        assert_eq!(extract_openai_style_images(&body), vec![ImagePayload::Base64("AAA".into())]);
    }

    #[test]
    fn sniffs_custom_images_array() {
        let body = json!({ "images": ["https://cdn/a.png", "QUJD"] });
        assert_eq!(
            extract_openai_style_images(&body),
            vec![ImagePayload::Url("https://cdn/a.png".into()), ImagePayload::Base64("QUJD".into())]
        );
    }

    #[test]
    fn sniffs_custom_images_objects() {
        let body = json!({ "images": [{ "url": "https://cdn/a.png" }, { "b64_json": "QUJD" }] });
        assert_eq!(
            extract_openai_style_images(&body),
            vec![ImagePayload::Url("https://cdn/a.png".into()), ImagePayload::Base64("QUJD".into())]
        );
    }

    #[test]
    fn returns_empty_when_no_images() {
        assert!(extract_openai_style_images(&json!({ "data": [] })).is_empty());
        assert!(extract_openai_style_images(&json!({ "error": "x" })).is_empty());
    }

    #[test]
    fn extracts_gemini_inline_data() {
        let body = json!({
            "candidates": [{
                "content": { "parts": [
                    { "text": "here you go" },
                    { "inlineData": { "mimeType": "image/png", "data": "AAA" } }
                ]}
            }]
        });
        assert_eq!(
            extract_gemini_images(&body),
            vec![ImagePayload::Base64WithMime("AAA".into(), "image/png".into())]
        );
    }

    #[test]
    fn extracts_gemini_snake_case_variant() {
        let body = json!({
            "candidates": [{
                "content": { "parts": [
                    { "inline_data": { "mime_type": "image/jpeg", "data": "BBB" } }
                ]}
            }]
        });
        assert_eq!(
            extract_gemini_images(&body),
            vec![ImagePayload::Base64WithMime("BBB".into(), "image/jpeg".into())]
        );
    }

    #[test]
    fn gemini_text_only_response_yields_nothing() {
        // 模型只回了文字（多半是被安全策略挡了），要走 no_image 而不是崩
        let body = json!({ "candidates": [{ "content": { "parts": [{ "text": "sorry" }] } }] });
        assert!(extract_gemini_images(&body).is_empty());
    }

    #[test]
    fn gemini_missing_fields_yield_nothing() {
        assert!(extract_gemini_images(&json!({})).is_empty());
        assert!(extract_gemini_images(&json!({ "candidates": [] })).is_empty());
        assert!(extract_gemini_images(&json!({ "candidates": [{}] })).is_empty());
    }

    // ── 扩展名判定 ──

    #[test]
    fn maps_mime_to_extension() {
        assert_eq!(ext_from_mime("image/jpeg"), "jpg");
        assert_eq!(ext_from_mime("image/webp"), "webp");
        assert_eq!(ext_from_mime("image/gif"), "gif");
        assert_eq!(ext_from_mime("image/png"), "png");
        assert_eq!(ext_from_mime("application/octet-stream"), "png");
    }

    #[test]
    fn detects_extension_from_magic_bytes() {
        assert_eq!(ext_from_magic(&[0xFF, 0xD8, 0xFF, 0xE0]), "jpg");
        assert_eq!(ext_from_magic(b"GIF89a"), "gif");
        assert_eq!(ext_from_magic(b"RIFF\0\0\0\0WEBPVP8 "), "webp");
        assert_eq!(ext_from_magic(&[0x89, b'P', b'N', b'G']), "png");
        assert_eq!(ext_from_magic(&[]), "png");
    }

    // ── 参考图 ──

    #[test]
    fn parses_data_url_reference() {
        let (data, mime) = load_reference("data:image/png;base64,QUJD").unwrap();
        assert_eq!(data, "QUJD");
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn rejects_malformed_data_url() {
        assert!(load_reference("data:image/png,QUJD").is_none());
        assert!(load_reference("data:").is_none());
    }

    // ── 取消 ──

    #[test]
    fn cancel_flag_flips_and_unregisters() {
        let flag = register_task("t1");
        assert!(check_cancelled(&flag).is_ok());

        image_generate_cancel("t1".into());
        assert!(check_cancelled(&flag).is_err());
        assert_eq!(check_cancelled(&flag).unwrap_err().code, "aborted");

        unregister_task("t1");
        // 已结束的任务再取消是空操作，不该 panic
        image_generate_cancel("t1".into());
    }

    #[test]
    fn cancelling_unknown_task_is_noop() {
        image_generate_cancel("never-existed".into());
    }
}
