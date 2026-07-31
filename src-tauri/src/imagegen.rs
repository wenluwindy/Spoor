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
    /// | `rightapi_draw`
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

async fn get_json(url: &str, headers: Vec<(&str, String)>) -> Result<Value, ImageGenError> {
    let mut req = client()?.get(url);
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

/// 从一段文字里抠出第一个 http(s) URL。
///
/// RightAPI 的 Gemini 型任务结果把图片地址放在 `parts[].text` 里，是**纯文本**而不是
/// `inlineData`，所以 [`extract_gemini_images`] 抠不到。多数时候整段就是一个 URL，
/// 但偶尔会被包在 markdown 里，因此按分隔符切一刀而不是直接整段当地址用。
fn first_url_in(text: &str) -> Option<String> {
    let start = text.find("http")?;
    let rest = &text[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || matches!(c, ')' | ']' | '"' | '\'' | '<' | '>'))
        .unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches(['.', ',', ';', '。', '，']);
    // `http://` 本身长 7，比它还短的一定是误报
    (url.len() > 8).then(|| url.to_string())
}

/// Gemini 型结果里以纯文本形式给出的图片 URL。
pub fn extract_gemini_text_urls(body: &Value) -> Vec<ImagePayload> {
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
            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                if let Some(url) = first_url_in(text) {
                    out.push(ImagePayload::Url(url));
                }
            }
        }
    }
    out
}

/// RightAPI 的任务结果按提交时的协议回：Images 型是 `data[]`，Gemini 型是
/// `candidates[]`（图在 `inlineData` 或 `parts[].text` 的 URL 里）。三种都试。
pub fn extract_rightapi_images(body: &Value) -> Vec<ImagePayload> {
    let mut out = extract_openai_style_images(body);
    if out.is_empty() {
        out = extract_gemini_images(body);
    }
    if out.is_empty() {
        out = extract_gemini_text_urls(body);
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

// ───────────────────────────── RightAPI（异步绘图） ─────────────────────────────

/// 轮询间隔与上限。生图普遍 10～60 秒，4K 图偶尔上分钟，5 分钟封顶足够，
/// 再久基本是服务端卡死而不是还在画。
const RIGHTAPI_POLL_INTERVAL_MS: u64 = 2_000;
const RIGHTAPI_POLL_TIMEOUT_MS: u64 = 300_000;

/// 任务查询是**站点层级**接口，路径里没有 `/draw`（见 RightAPI 文档「任务查询」）。
///
/// 用户填的 Base URL 是绘图基址 `https://www.rightapi.ai/draw/v1`，查询要的却是
/// `https://www.rightapi.ai/v1/tasks/{id}`，所以这里把 `/draw` 段摘掉。
/// 没有该段的自建网关原样拼，不去猜。
fn rightapi_task_url(base: &str, task_id: &str) -> String {
    let base = trim_base(base);
    let root = match base.rfind("/draw/") {
        Some(i) => format!("{}{}", &base[..i], &base[i + "/draw".len()..]),
        None => match base.strip_suffix("/draw") {
            Some(prefix) => prefix.to_string(),
            None => base,
        },
    };
    format!("{root}/tasks/{task_id}")
}

/// 任务失败时把服务端给的原因带出来，没有就退回状态本身。
fn rightapi_failure(body: &Value) -> ImageGenError {
    let message = body
        .get("error")
        .and_then(|e| e.get("message").or(Some(e)))
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string())))
        .unwrap_or_else(|| "task failed".to_string());
    ImageGenError {
        code: classify_http(200, &message).into(),
        http_status: None,
        detail: Some(message.chars().take(600).collect()),
    }
}

/// RightAPI 绘图。提交拿 `task_id`，再轮询任务直到出图。
///
/// 与 OpenAI Images 的差别（全部来自官方文档）：
/// - 请求体必须带 `"async": true`，响应只回 `task_id`，不含图
/// - `size` 是宽高比（`1:1` / `16:9` / …）而不是像素，另有 `imageSize`（`1K`/`2K`/`4K`）
/// - 参考图放请求体的 `image` 数组，走不到 `/images/edits` 的 multipart
async fn generate_rightapi(
    req: &ImageGenRequest,
    flag: &AtomicBool,
) -> Result<Vec<ImagePayload>, ImageGenError> {
    let base = trim_base(&req.base_url);
    let mut body = json!({
        "model": req.model,
        "prompt": req.prompt,
        "async": true,
    });
    if let Some(size) = &req.size {
        body["size"] = json!(size);
    }
    if let Some(n) = req.n {
        body["n"] = json!(n);
    }
    // 这家的画质旋钮叫 imageSize，取 1K/2K/4K，语义对应我们配置里的 quality
    if let Some(quality) = &req.quality {
        body["imageSize"] = json!(quality);
    }

    let refs = load_references(&req.ref_images, 4);
    if !refs.is_empty() {
        let urls: Vec<String> = refs
            .iter()
            .map(|(data, mime)| format!("data:{mime};base64,{data}"))
            .collect();
        body["image"] = json!(urls);
    }

    let auth = vec![("Authorization", format!("Bearer {}", req.api_key.trim()))];
    let submitted = post_json(&format!("{base}/images/generations"), auth.clone(), body).await?;

    // 文档说恒为异步，但真同步回了图就别白跑一趟轮询
    let direct = extract_rightapi_images(&submitted);
    if !direct.is_empty() {
        return Ok(direct);
    }

    let Some(task_id) = submitted.get("task_id").and_then(|v| v.as_str()) else {
        return Err(ImageGenError::with_detail(
            "bad_response",
            format!("missing task_id: {submitted:.400}"),
        ));
    };

    let url = rightapi_task_url(&req.base_url, task_id);
    let deadline = RIGHTAPI_POLL_TIMEOUT_MS / RIGHTAPI_POLL_INTERVAL_MS;
    for _ in 0..deadline {
        check_cancelled(flag)?;
        tokio::time::sleep(std::time::Duration::from_millis(RIGHTAPI_POLL_INTERVAL_MS)).await;
        check_cancelled(flag)?;

        let task = get_json(&url, auth.clone()).await?;
        if task.get("status").and_then(|v| v.as_str()) == Some("failed") {
            return Err(rightapi_failure(&task));
        }
        // 完成态不带 status 字段（直接就是 Images / Gemini 形状），所以以「抠到图」
        // 而不是以状态字符串作为结束条件
        let images = extract_rightapi_images(&task);
        if !images.is_empty() {
            return Ok(images);
        }
    }

    Err(ImageGenError::with_detail(
        "timeout",
        format!("task {task_id} still pending after {}s", RIGHTAPI_POLL_TIMEOUT_MS / 1000),
    ))
}

// ───────────────────────────── 入口 ─────────────────────────────

async fn dispatch(
    req: &ImageGenRequest,
    flag: &AtomicBool,
) -> Result<Vec<ImagePayload>, ImageGenError> {
    match req.api_kind.as_str() {
        "doubao_seedream" => generate_doubao(req).await,
        // 自定义端点按 OpenAI 兼容处理，解析时会自动嗅探字段
        "openai_images" | "custom_openai_images" => generate_openai(req).await,
        "gemini_image" => generate_gemini(req).await,
        "rightapi_draw" => generate_rightapi(req, flag).await,
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
    let payloads = dispatch(req, flag).await?;
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

    // ── RightAPI 异步绘图 ──

    #[test]
    fn task_url_drops_the_draw_segment() {
        // 绘图基址带 /draw，任务查询是站点层级接口，不带
        assert_eq!(
            rightapi_task_url("https://www.rightapi.ai/draw/v1", "task_1"),
            "https://www.rightapi.ai/v1/tasks/task_1"
        );
        assert_eq!(
            rightapi_task_url("https://www.rightapi.ai/draw/v1/", "task_1"),
            "https://www.rightapi.ai/v1/tasks/task_1"
        );
        assert_eq!(
            rightapi_task_url("https://www.rightapi.ai/draw", "task_1"),
            "https://www.rightapi.ai/tasks/task_1"
        );
    }

    #[test]
    fn task_url_leaves_gateways_without_draw_alone() {
        // 自建网关的路径形状未知，别去猜
        assert_eq!(
            rightapi_task_url("https://gw.internal/v1", "task_1"),
            "https://gw.internal/v1/tasks/task_1"
        );
    }

    #[test]
    fn extracts_rightapi_images_shape() {
        let body = json!({ "created": 1, "data": [{ "url": "https://cdn/x.png" }] });
        assert_eq!(
            extract_rightapi_images(&body),
            vec![ImagePayload::Url("https://cdn/x.png".into())]
        );
    }

    #[test]
    fn extracts_rightapi_gemini_text_url() {
        // 完成态的 Gemini 形状把地址放在 parts[].text，是纯文本不是 inlineData
        let body = json!({
            "candidates": [{
                "content": { "role": "model", "parts": [{ "text": "https://cdn/y.png" }] },
                "finishReason": "STOP"
            }],
            "modelVersion": "nano-banana-fast"
        });
        assert_eq!(
            extract_rightapi_images(&body),
            vec![ImagePayload::Url("https://cdn/y.png".into())]
        );
    }

    #[test]
    fn extracts_rightapi_gemini_inline_data_too() {
        let body = json!({
            "candidates": [{
                "content": { "parts": [{ "inlineData": { "mimeType": "image/png", "data": "AAA" } }] }
            }]
        });
        assert_eq!(
            extract_rightapi_images(&body),
            vec![ImagePayload::Base64WithMime("AAA".into(), "image/png".into())]
        );
    }

    #[test]
    fn pending_task_yields_no_images() {
        // 排队/进行中的任务不该被当成结果，否则会提前收尾报 no_image
        let queued = json!({ "task_id": "t", "status": "in_progress", "progress": 45 });
        assert!(extract_rightapi_images(&queued).is_empty());
        let submitted = json!({ "task_id": "t", "status": "processing", "progress": 0 });
        assert!(extract_rightapi_images(&submitted).is_empty());
    }

    #[test]
    fn submit_ack_message_is_not_mistaken_for_a_url() {
        // 提交回执的 message 是中文说明，里面没有 http，不能被当成图
        let body = json!({
            "task_id": "t",
            "status": "processing",
            "message": "任务id: t 已提交，正在处理中，请稍后在异步任务中查看结果"
        });
        assert!(extract_rightapi_images(&body).is_empty());
    }

    #[test]
    fn pulls_url_out_of_surrounding_text() {
        assert_eq!(first_url_in("![img](https://cdn/z.png)"), Some("https://cdn/z.png".into()));
        assert_eq!(first_url_in("好了：https://cdn/z.png。"), Some("https://cdn/z.png".into()));
        assert_eq!(first_url_in("  https://cdn/z.png  "), Some("https://cdn/z.png".into()));
        assert_eq!(first_url_in("no link here"), None);
        assert_eq!(first_url_in("http://"), None);
    }

    #[test]
    fn failure_surfaces_the_server_message() {
        let body = json!({
            "task_id": "t",
            "status": "failed",
            "error": { "message": "内容审核未通过", "code": "" }
        });
        let err = rightapi_failure(&body);
        assert_eq!(err.code, "content_filtered");
        assert_eq!(err.detail.as_deref(), Some("内容审核未通过"));
    }

    #[test]
    fn failure_without_message_still_reports_something() {
        let err = rightapi_failure(&json!({ "task_id": "t", "status": "failed" }));
        assert_eq!(err.code, "http_error");
        assert!(err.detail.is_some());
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
