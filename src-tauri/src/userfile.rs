//! 读写「用户在系统对话框里刚选中的那个文件」。
//!
//! 与 [`crate::media`] 的区别是信任模型，不是功能：`media_*` 只在数据根 `SpoorData/`
//! 内活动，任何路径都要先过 `resolve_media_path` 才允许落地；这里处理的是数据根**之外**
//! 的任意绝对路径——导出画布、导入 `.canvas`、还原备份，目标都由用户在系统的保存/打开
//! 对话框里当场指定。
//!
//! 因此这两个命令**只应在紧接着一次 `plugin-dialog` 的选择之后调用**。前端不要自己拼路径
//! 传进来：那等于把「用户选了什么」这个唯一的授权凭据丢掉了。
//!
//! 体积上限是防呆而非防攻击——挑错文件（比如一个 2GB 的视频）时给一条清楚的错误，
//! 好过把整块内容读进内存再让渲染进程卡死。

use std::fs;

use base64::Engine;

/// 可读入的文本文件上限。`.canvas` 与备份 JSON 都是纯文本，正常远小于此。
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

fn ensure_parent(dest_path: &str) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(dest_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("disk_write_failed: {e}"))?;
        }
    }
    Ok(())
}

/// 把文本写到用户选定的路径。已存在则覆盖——对话框自己已经问过要不要覆盖了。
#[tauri::command]
pub fn user_file_write_text(dest_path: String, contents: String) -> Result<(), String> {
    ensure_parent(&dest_path)?;
    fs::write(&dest_path, contents).map_err(|e| format!("disk_write_failed: {e}"))
}

/// 把 base64 编码的字节写到用户选定的路径。
///
/// 导出 PNG 用：浏览器侧只能拿到 data URL，字节要么在 JS 里转成二进制再过 IPC，
/// 要么就这样把 base64 原样递过来由 Rust 解。后者少一次转换，也少一个出错的地方。
#[tauri::command]
pub fn user_file_write_base64(dest_path: String, contents: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| format!("bad_base64: {e}"))?;
    ensure_parent(&dest_path)?;
    fs::write(&dest_path, bytes).map_err(|e| format!("disk_write_failed: {e}"))
}

/// 读取用户选定的文本文件。
#[tauri::command]
pub fn user_file_read_text(src_path: String) -> Result<String, String> {
    let meta = fs::metadata(&src_path).map_err(|e| format!("not_found: {e}"))?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err("file_too_large".to_string());
    }
    fs::read_to_string(&src_path).map_err(|e| format!("read_failed: {e}"))
}
