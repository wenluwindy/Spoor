mod imagegen;
mod local_llama;
mod media;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use local_llama::LocalLlamaChatPayload;

/// OpenAI-compatible POST to `url` (e.g. Xiaomi MiMo Token Plan: https://token-plan-cn.xiaomimimo.com/v1/chat/completions).
/// Bypasses browser CORS when running in the Tauri webview.
#[tauri::command]
async fn openai_compatible_chat(api_key: String, url: String, body: Value) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  let response = client
    .post(&url)
    .header("Authorization", format!("Bearer {api_key}"))
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  let text = response.text().await.map_err(|e| e.to_string())?;

  if !status.is_success() {
    let preview: String = text.chars().take(800).collect();
    eprintln!("[Spoor] openai_compatible_chat HTTP {status} url={url} body_preview={preview}");
    return Err(text);
  }

  let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
  let content = json["choices"]
    .get(0)
    .and_then(|c| c.get("message")?.get("content"));

  match content {
    Some(Value::String(s)) => Ok(s.clone()),
    Some(v) => Ok(v.to_string()),
    None => Err(format!("Unexpected API response: {text}")),
  }
}

/// Same as [`openai_compatible_chat`] but `stream: true` + SSE; emits JSON `{ id, text }` on `lab-ai-stream` as tokens arrive.
#[tauri::command]
async fn openai_compatible_chat_stream(
  app: AppHandle,
  api_key: String,
  url: String,
  mut body: Value,
  stream_id: String,
) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  if let Some(obj) = body.as_object_mut() {
    obj.insert("stream".to_string(), Value::Bool(true));
  }

  let response = client
    .post(&url)
    .header(
      "Authorization",
      format!("Bearer {}", api_key.trim()),
    )
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat_stream network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  if !status.is_success() {
    let text = response.text().await.unwrap_or_default();
    let preview: String = text.chars().take(800).collect();
    eprintln!(
      "[Spoor] openai_compatible_chat_stream HTTP {status} url={url} body_preview={preview}"
    );
    return Err(text);
  }

  let mut stream = response.bytes_stream();
  let mut pending = String::new();
  let mut full = String::new();

  while let Some(chunk_result) = stream.next().await {
    let chunk = chunk_result.map_err(|e| e.to_string())?;
    pending.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      let nl = match pending.find('\n') {
        Some(i) => i,
        None => break,
      };
      let line = pending[..nl].trim_end_matches('\r').to_string();
      pending = pending[nl + 1..].to_string();

      let trimmed = line.trim();
      let data = match trimmed.strip_prefix("data:") {
        Some(rest) => rest.trim_start(),
        None => continue,
      };
      if data == "[DONE]" {
        continue;
      }
      let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => continue,
      };
      let delta = v["choices"]
        .get(0)
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str());
      if let Some(d) = delta {
        if !d.is_empty() {
          full.push_str(d);
          let payload = serde_json::json!({ "id": &stream_id, "text": &full });
          let _ = app.emit("lab-ai-stream", payload);
        }
      }
    }
  }

  Ok(full)
}

/// Anthropic Messages API proxy.
///
/// Same reason as [`openai_compatible_chat`]: api.anthropic.com sends no CORS
/// headers, so a direct fetch from the webview fails as an opaque
/// "Failed to fetch" with no status code to show the user.
///
/// Returns the raw response body rather than the extracted text — the block
/// joining lives in `services/ai.ts` and is shared with the web path; doing it
/// twice in two languages would be two places to get it wrong.
#[tauri::command]
async fn anthropic_messages(api_key: String, url: String, body: Value) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  let response = client
    .post(&url)
    .header("x-api-key", api_key)
    .header("anthropic-version", "2023-06-01")
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] anthropic_messages network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  let text = response.text().await.map_err(|e| e.to_string())?;

  if !status.is_success() {
    let preview: String = text.chars().take(800).collect();
    eprintln!("[Spoor] anthropic_messages HTTP {status} url={url} body_preview={preview}");
    return Err(text);
  }

  Ok(text)
}

/// Metaso (秘塔) search API proxy.
/// POST https://metaso.cn/api/v1/search — bypasses browser CORS in Tauri webview.
#[tauri::command]
async fn metaso_search(api_key: String, query: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "q": query,
        "scope": "webpage",
        "size": 5,
    });

    let response = client
        .post("https://metaso.cn/api/v1/search")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] metaso_search network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] metaso_search HTTP {status} body_preview={preview}");
        return Err(text);
    }

    Ok(text)
}

/// Open an http(s) URL in the system default browser. Webview `target=_blank` is unreliable in Tauri.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

/// 内置 llama.cpp：加载本地 GGUF，使用模型自带 chat 模板完成一轮对话（桌面端离线）。
#[tauri::command]
async fn local_llama_chat(payload: LocalLlamaChatPayload) -> Result<String, String> {
  tokio::task::spawn_blocking(move || local_llama::chat(payload))
    .await
    .map_err(|e| format!("推理任务异常: {e}"))?
}

/// 返回本地 LLM 日志文件路径（每次推理的命令行/stdout/stderr/耗时都会写入此文件）。
#[tauri::command]
fn get_local_llama_log_path() -> String {
  local_llama::log_path().to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 原生文件对话框：`open()` 返回**绝对路径**，Rust 侧直接 fs::copy 入库，
    // 大文件不用先读进 JS 再走 IPC
    .plugin(tauri_plugin_dialog::init())
    // 画布里的图片/视频/文档都走这个协议直接流式读盘：
    // 数据根是运行时解析的，`assetProtocol` 的静态 scope 对不上。
    .register_asynchronous_uri_scheme_protocol("spoor-media", |ctx, request, responder| {
      let root = media::init_data_root(ctx.app_handle()).to_path_buf();
      let path = request.uri().path().to_string();
      let range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

      // 读盘是阻塞的，别占住 webview 的 IPC 线程
      std::thread::spawn(move || {
        responder.respond(media::serve_media(&root, &path, range.as_deref()));
      });
    })
    .setup(|app| {
      let root = media::init_data_root(app.handle());
      println!("[Spoor] 媒体数据根：{}", root.display());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      openai_compatible_chat,
      openai_compatible_chat_stream,
      anthropic_messages,
      metaso_search,
      open_external_url,
      local_llama_chat,
      get_local_llama_log_path,
      media::media_store_info,
      media::media_list,
      media::media_import,
      media::media_import_bytes,
      media::media_export,
      media::media_delete,
      media::media_reveal,
      media::media_open_root,
      media::media_gc,
      imagegen::image_generate,
      imagegen::image_generate_cancel
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
