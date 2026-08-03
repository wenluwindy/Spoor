mod cc_switch;
mod dataroot;
mod engine;
mod gguf;
mod hardware;
mod imagegen;
mod keystore;
mod llama_server;
mod media;
mod notes;
mod snapshot;
mod updater;
mod userfile;
mod webpage;

use std::time::Duration;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};


/// 网络超时的统一口径。
///
/// - 连接 15s：连不上就是连不上，多等只是拖长报错。
/// - 对话 120s：长回答的推理确实慢，但超过两分钟基本是服务端挂了。
///   注意流式对话**不能**用总超时（见 [`openai_compatible_chat_stream`]）。
/// - 搜索 30s：搜索接口要么秒回要么完蛋，没有中间态。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(30);

/// 单次响应体上限。与 [`webpage`] 的 MAX_BYTES 同一个思路：别让一个失控的
/// 服务端把整块内存吃掉。32MB 对聊天/搜索的 JSON 已经绰绰有余。
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// 带 API Key 外发的 URL 必须走 https；http 仅放行本机（本地 LLM 网关常用）。
///
/// 这些 url 来自用户配置，写法与 [`open_external_url`] 一致——不引 url 解析库，
/// 前缀判断足够。否则一条误填/被注入的 http 地址就能让密钥以明文离开本机。
pub(crate) fn ensure_key_bearing_url(url: &str) -> Result<(), String> {
    let lowered = url.trim().to_ascii_lowercase();
    if lowered.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = lowered.strip_prefix("http://") {
        let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
        // IPv6 字面量带方括号（`[::1]:8080`），得先剥括号再谈端口
        let host = match host_port.strip_prefix('[') {
            Some(v6) => v6.split(']').next().unwrap_or(""),
            None => host_port.split(':').next().unwrap_or(""),
        };
        if matches!(host, "localhost" | "127.0.0.1" | "::1") {
            return Ok(());
        }
    }
    Err("insecure_url: API 请求只允许 https://（http:// 仅限 localhost / 127.0.0.1）".into())
}

/// 把响应体读进内存，超过 [`MAX_RESPONSE_BYTES`] 直接报错。
///
/// 与 [`webpage`] 的「截断继续用」不同，这里要的是完整 JSON——截半个 JSON
/// 解析必然失败，不如尽早把「响应过大」如实说出来。Content-Length 可以说谎，
/// 所以头部检查之外还要逐块累计。
async fn read_text_capped(response: reqwest::Response) -> Result<String, String> {
    if response.content_length().is_some_and(|len| len > MAX_RESPONSE_BYTES as u64) {
        return Err("response_too_large".into());
    }
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if buf.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("response_too_large".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// OpenAI-compatible POST to `url` (e.g. Xiaomi MiMo Token Plan: https://token-plan-cn.xiaomimimo.com/v1/chat/completions).
/// Bypasses browser CORS when running in the Tauri webview.
#[tauri::command]
async fn openai_compatible_chat(api_key: String, url: String, body: Value) -> Result<String, String> {
  ensure_key_bearing_url(&url)?;
  let client = reqwest::Client::builder()
    .connect_timeout(CONNECT_TIMEOUT)
    .timeout(CHAT_TIMEOUT)
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
  let text = read_text_capped(response).await?;

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

/// 从一行 SSE 里抠出增量文本。非 `data:` 行、`[DONE]`、解析失败、空增量都返回 `None`。
fn sse_delta(line: &str) -> Option<String> {
  let data = line.trim().strip_prefix("data:")?.trim_start();
  if data == "[DONE]" {
    return None;
  }
  let v: Value = serde_json::from_str(data).ok()?;
  v["choices"]
    .get(0)?
    .get("delta")?
    .get("content")?
    .as_str()
    .filter(|s| !s.is_empty())
    .map(str::to_string)
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
  ensure_key_bearing_url(&url)?;
  // 流式不能用 `.timeout()`：reqwest 的总超时对整个响应体计时，长回答只要
  // 生成超过两分钟就会被硬掐断。`read_timeout`（reqwest 0.12.4+）是两次读取
  // 之间的空闲超时——正常生成时 token 源源不断，只有真卡死才会触发。
  let client = reqwest::Client::builder()
    .connect_timeout(CONNECT_TIMEOUT)
    .read_timeout(CHAT_TIMEOUT)
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
    let text = read_text_capped(response).await.unwrap_or_default();
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

    while let Some(nl) = pending.find('\n') {
      if let Some(delta) = sse_delta(&pending[..nl]) {
        full.push_str(&delta);
        let payload = serde_json::json!({ "id": &stream_id, "text": &full });
        let _ = app.emit("lab-ai-stream", payload);
      }
      // drain 原地挪走已消费的行；此前的 `pending[nl + 1..].to_string()` 每行都
      // 把余下内容整个重新分配一遍，长回答下是 O(n²)
      pending.drain(..=nl);
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
  ensure_key_bearing_url(&url)?;
  let client = reqwest::Client::builder()
    .connect_timeout(CONNECT_TIMEOUT)
    .timeout(CHAT_TIMEOUT)
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
  let text = read_text_capped(response).await?;

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
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(SEARCH_TIMEOUT)
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
    let text = read_text_capped(response).await?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] metaso_search HTTP {status} body_preview={preview}");
        return Err(text);
    }

    Ok(text)
}

/// Tavily search API proxy.
/// POST https://api.tavily.com/search — 同 [`metaso_search`]，绕开 webview 的 CORS。
///
/// `search_depth: basic` 是刻意的：advanced 一次要扣 2 个额度，而这里只是给模型
/// 补一段网页上下文，basic 的摘要已经够用。
#[tauri::command]
async fn tavily_search(api_key: String, query: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(SEARCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "query": query,
        "max_results": 5,
        "search_depth": "basic",
    });

    let response = client
        .post("https://api.tavily.com/search")
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] tavily_search network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    let text = read_text_capped(response).await?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] tavily_search HTTP {status} body_preview={preview}");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 原生文件对话框：`open()` 返回**绝对路径**，Rust 侧直接 fs::copy 入库，
    // 大文件不用先读进 JS 再走 IPC
    .plugin(tauri_plugin_dialog::init())
    // 画布里的图片/视频/文档都走这个协议直接流式读盘：
    // 数据根是运行时解析的，`assetProtocol` 的静态 scope 对不上。
    .register_asynchronous_uri_scheme_protocol("spoor-media", |ctx, request, responder| {
      // 每次请求都重新取数据根：数据目录迁移（dataroot.rs）后要立刻从新位置读
      let root = media::init_data_root(ctx.app_handle());
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
      // 上次异常退出可能留下孤儿 llama-server（pid 文件 + 进程名双重校验后才杀）。
      // tasklist 要上百毫秒，放线程里别拖慢启动。
      std::thread::spawn(llama_server::cleanup_orphan);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      openai_compatible_chat,
      openai_compatible_chat_stream,
      anthropic_messages,
      metaso_search,
      tavily_search,
      open_external_url,
      updater::check_for_update,
      updater::download_update,
      updater::install_update,
      cc_switch::cc_switch_read_config,
      media::media_store_info,
      media::media_list,
      media::media_import,
      media::media_import_bytes,
      media::media_export,
      media::media_delete,
      media::media_reveal,
      media::media_open_root,
      media::media_gc,
      dataroot::data_root_get,
      dataroot::data_root_migrate,
      imagegen::image_generate,
      imagegen::image_generate_cancel,
      userfile::user_file_pick_save_path,
      userfile::user_file_pick_open_path,
      userfile::user_file_pick_directory,
      userfile::user_file_write_text,
      userfile::user_file_write_base64,
      userfile::user_file_read_text,
      snapshot::snapshot_write,
      snapshot::snapshot_list,
      snapshot::snapshot_read,
      notes::notes_write,
      notes::notes_read_all,
      notes::notes_list_foreign,
      notes::notes_delete,
      gguf::gguf_inspect,
      hardware::hardware_probe,
      engine::local_engine_status,
      engine::local_engine_install_cuda,
      llama_server::local_server_ensure,
      llama_server::local_server_touch,
      llama_server::local_server_stop,
      llama_server::local_server_state,
      webpage::fetch_webpage,
      keystore::keystore_save,
      keystore::keystore_load
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    // .run(回调) 而不是 .run(ctx)：应用退出时要把常驻的 llama-server 一并带走，
    // 否则它会拿着几 GB 显存活成孤儿（下次启动的 cleanup_orphan 只是兜底）
    .run(|_app, event| {
      if let tauri::RunEvent::Exit = event {
        llama_server::stop_running();
      }
    });
}
