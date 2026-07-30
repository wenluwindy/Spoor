//! 本地媒体存储：数据根解析、相对路径安全化、`spoor-media` 协议与 `media_*` 命令。
//!
//! 设计要点：
//! - **数据库只存相对路径**（`media/generated/2026/07/ab12.png`），绝不存绝对路径——
//!   安装目录会变（换机、改装到别处），存绝对路径等于数据一搬就全断。
//! - 大二进制**不穿过 IPC**：导入是 Rust 侧 `fs::copy`，显示是自定义协议直接流式读盘。
//! - 任何从前端来的路径都必须过 [`resolve_media_path`]，它会拒掉 `..`、盘符、
//!   以及 canonicalize 之后跑到数据根外的软链。

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager};

/// 数据根目录名。放在 exe 同级，卸载钩子按这个名字识别。
pub const DATA_DIR_NAME: &str = "SpoorData";
/// 标记文件：既用于可写性探测，也让卸载程序确认「这确实是 Spoor 的数据目录」。
pub const ROOT_MARKER: &str = ".spoor-data-root";

/// 允许写入的分类子目录。前端只能传这三个之一，避免用分类名做目录穿越。
pub const CATEGORY_GENERATED: &str = "generated";
pub const CATEGORY_UPLOADED: &str = "uploaded";
pub const CATEGORY_DOCUMENTS: &str = "documents";

static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();

// ───────────────────────────── 数据根 ─────────────────────────────

/// 目录可写吗？直接试写标记文件——`metadata().permissions().readonly()`
/// 在 Windows 上对目录基本没意义（它反映的是只读属性，不是 ACL）。
fn probe_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let marker = dir.join(ROOT_MARKER);
    fs::write(&marker, b"spoor\n").is_ok()
}

/// 解析数据根：优先 exe 同级的 `SpoorData/`，写不进去就回退到系统的应用数据目录。
///
/// 回退是必要的：默认 NSIS 装到 `%LOCALAPPDATA%` 可写，但用户可以改成
/// perMachine 装进 `Program Files`，那里普通权限写不了。
fn resolve_data_root(app: &AppHandle) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join(DATA_DIR_NAME);
            if probe_writable(&candidate) {
                return candidate;
            }
            eprintln!(
                "[Spoor] 安装目录不可写，媒体数据回退到应用数据目录：{}",
                candidate.display()
            );
        }
    }

    let fallback = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(DATA_DIR_NAME);
    let _ = probe_writable(&fallback);
    fallback
}

/// 进程内只解析一次。启动时调用一次即可，之后各处直接读缓存。
pub fn init_data_root(app: &AppHandle) -> &'static Path {
    DATA_ROOT.get_or_init(|| resolve_data_root(app))
}

/// 已解析的数据根。`init_data_root` 之前调用会 panic——那是启动顺序写错了。
pub fn data_root() -> &'static Path {
    DATA_ROOT
        .get()
        .map(|p| p.as_path())
        .expect("data root not initialised; call init_data_root() in setup()")
}

// ───────────────────────────── 路径安全 ─────────────────────────────

/// 最小 percent-decode。只为解 URL 路径，不引第三方依赖。
///
/// `%` 后跟的不是两位十六进制时按字面量保留——宁可少解一次，也不要把
/// `%2e%2e` 之类的畸形串猜成 `..`。解出的字节非法 UTF-8 时返回 `None`。
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            match u8::from_str_radix(hex, 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                Err(_) => { /* 畸形转义，按字面量走 */ }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/// 把 URL 路径收敛成数据根内的相对路径；任何可疑成分一律拒绝而不是「修正」。
///
/// 拒绝：空串、`..`、绝对路径、盘符、NTFS 数据流（含 `:`）、NUL。
/// 注意先 decode 再判断——否则 `%2e%2e%2f` 能绕过字面量检查。
pub fn sanitize_relative_path(raw: &str) -> Option<PathBuf> {
    let decoded = percent_decode(raw)?;
    if decoded.contains('\0') {
        return None;
    }

    let mut out = PathBuf::new();
    let mut segments = 0usize;
    for segment in decoded.split(['/', '\\']) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        // 盘符 `C:`、数据流 `a.png:evil` 都带冒号
        if segment.contains(':') {
            return None;
        }
        out.push(segment);
        segments += 1;
    }

    if segments == 0 {
        return None;
    }
    Some(out)
}

/// 只做字符串层面的安全化并拼到数据根下，**不要求文件存在**。
///
/// 单独拆出来是为了区分「路径本身可疑」和「文件不在」——前者该 403，后者该 404，
/// 混在一起会让「图被删了」和「有人在试穿越」长得一模一样。
pub fn safe_join(root: &Path, raw: &str) -> Option<PathBuf> {
    Some(root.join(sanitize_relative_path(raw)?))
}

/// 安全化 + 落到数据根内 + canonicalize 校验。文件不存在时返回 `None`。
///
/// canonicalize 这一步是拦符号链接用的：`sanitize_relative_path` 只看字符串，
/// 一条指向数据根外的软链在字符串层面完全合法。
pub fn resolve_media_path(root: &Path, raw: &str) -> Option<PathBuf> {
    let real = safe_join(root, raw)?.canonicalize().ok()?;
    let real_root = root.canonicalize().ok()?;
    real.starts_with(&real_root).then_some(real)
}

/// 前端传来的分类名只能是白名单里的三个之一。
fn sanitize_category(category: &str) -> Option<&'static str> {
    match category {
        CATEGORY_GENERATED => Some(CATEGORY_GENERATED),
        CATEGORY_UPLOADED => Some(CATEGORY_UPLOADED),
        CATEGORY_DOCUMENTS => Some(CATEGORY_DOCUMENTS),
        _ => None,
    }
}

/// 扩展名只留字母数字并转小写；拿不到就用 `bin`。
/// 不信任来源扩展名，避免 `png/../../x` 这类东西混进文件名。
fn sanitize_extension(ext: Option<&str>) -> String {
    let cleaned: String = ext
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect::<String>()
        .to_ascii_lowercase();
    if cleaned.is_empty() {
        "bin".to_string()
    } else {
        cleaned
    }
}

/// 生成 `media/<category>/<年>/<月>/<uuid>.<ext>` 相对路径。
///
/// 按年月分目录是为了单目录文件数可控——生图历史永久保留，几年后单层会到几万个。
pub fn new_relative_path(category: &str, ext: &str) -> String {
    let now = chrono::Local::now();
    format!(
        "media/{}/{}/{:02}/{}.{}",
        category,
        now.format("%Y"),
        now.format("%m").to_string().parse::<u32>().unwrap_or(1),
        uuid::Uuid::new_v4(),
        ext
    )
}

// ───────────────────────────── spoor-media 协议 ─────────────────────────────

/// 解析单段 Range 头，返回闭区间 `[start, end]`。
///
/// 支持 `bytes=0-1023`、`bytes=1024-`（到末尾）、`bytes=-500`（末尾 500 字节）。
/// 多段 Range 不支持——`<video>` 拖进度条只发单段。
pub fn parse_range(raw: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = raw.trim().strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (start_raw, end_raw) = spec.split_once('-')?;
    let start_raw = start_raw.trim();
    let end_raw = end_raw.trim();

    if start_raw.is_empty() {
        // 后缀式：最后 N 字节
        let suffix: u64 = end_raw.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total.saturating_sub(suffix);
        return Some((start, total - 1));
    }

    let start: u64 = start_raw.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if end_raw.is_empty() {
        total - 1
    } else {
        end_raw.parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end).then_some((start, end))
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn read_range(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

/// 处理一次 `spoor-media://` 请求。与 Tauri 解耦，便于单测。
pub fn serve_media(root: &Path, url_path: &str, range: Option<&str>) -> Response<Vec<u8>> {
    // 路径本身可疑 → 403，且到此为止不碰文件系统，不泄露数据根外的文件是否存在
    let Some(candidate) = safe_join(root, url_path) else {
        return empty_response(StatusCode::FORBIDDEN);
    };
    let Some(path) = resolve_media_path(root, url_path) else {
        // 路径合法但解析失败：存在（说明是指向根外的软链）→ 403，不存在 → 404
        return empty_response(if candidate.symlink_metadata().is_ok() {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::NOT_FOUND
        });
    };
    let Ok(meta) = fs::metadata(&path) else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    if !meta.is_file() {
        return empty_response(StatusCode::NOT_FOUND);
    }

    let total = meta.len();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    match range {
        Some(raw) => match parse_range(raw, total) {
            Some((start, end)) => {
                let len = end - start + 1;
                match read_range(&path, start, len) {
                    Ok(body) => Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, mime)
                        .header(header::CONTENT_LENGTH, len.to_string())
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        )
                        .body(body)
                        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR)),
                    Err(_) => empty_response(StatusCode::INTERNAL_SERVER_ERROR),
                }
            }
            // 语法对但范围越界 → 416，并告知实际大小
            None => Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Vec::new())
                .unwrap_or_else(|_| empty_response(StatusCode::RANGE_NOT_SATISFIABLE)),
        },
        None => match fs::read(&path) {
            Ok(body) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_LENGTH, total.to_string())
                .header(header::ACCEPT_RANGES, "bytes")
                .body(body)
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR)),
            Err(_) => empty_response(StatusCode::INTERNAL_SERVER_ERROR),
        },
    }
}

// ───────────────────────────── media_* 命令 ─────────────────────────────

#[derive(Serialize)]
pub struct MediaStoreInfo {
    /// 数据根绝对路径，仅用于设置里显示与「打开文件夹」。
    pub root: String,
    pub bytes: u64,
    pub count: u64,
    /// 是否回退到了应用数据目录（安装目录不可写）。
    pub fallback: bool,
}

#[derive(Serialize)]
pub struct MediaEntry {
    pub rel: String,
    pub bytes: u64,
    /// Unix 毫秒；取不到时为 0。
    pub mtime: u64,
    pub ext: String,
}

#[derive(Serialize)]
pub struct MediaImportResult {
    pub rel: String,
    pub bytes: u64,
    pub ext: String,
    pub file_name: String,
}

#[derive(Serialize)]
pub struct MediaGcResult {
    pub removed: u64,
    pub bytes: u64,
}

fn to_rel_string(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    // 统一用 `/`：这个字符串要进数据库，也要拼进 URL
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// 递归遍历 `media/` 下的所有文件。标记文件与其他杂项不计入。
fn walk_media(root: &Path) -> Vec<(PathBuf, fs::Metadata)> {
    let mut out = Vec::new();
    let mut stack = vec![root.join("media")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                out.push((path, meta));
            }
        }
    }
    out
}

fn mtime_millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn media_store_info() -> MediaStoreInfo {
    let root = data_root();
    let files = walk_media(root);
    let bytes = files.iter().map(|(_, m)| m.len()).sum();
    let in_exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join(DATA_DIR_NAME)))
        .map(|expected| expected == root)
        .unwrap_or(false);

    MediaStoreInfo {
        root: root.to_string_lossy().to_string(),
        bytes,
        count: files.len() as u64,
        fallback: !in_exe_dir,
    }
}

#[tauri::command]
pub fn media_list(category: Option<String>) -> Vec<MediaEntry> {
    let root = data_root();
    let prefix = category
        .as_deref()
        .and_then(sanitize_category)
        .map(|c| format!("media/{c}/"));

    let mut out: Vec<MediaEntry> = walk_media(root)
        .into_iter()
        .filter_map(|(path, meta)| {
            let rel = to_rel_string(root, &path)?;
            if let Some(prefix) = &prefix {
                if !rel.starts_with(prefix) {
                    return None;
                }
            }
            Some(MediaEntry {
                ext: path
                    .extension()
                    .map(|e| e.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default(),
                bytes: meta.len(),
                mtime: mtime_millis(&meta),
                rel,
            })
        })
        .collect();

    // 最新在前，与生图历史的展示顺序一致
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

/// 从原生绝对路径复制入库。大文件零 IPC 传输——这是走原生文件对话框的全部意义。
#[tauri::command]
pub fn media_import(src_path: String, category: String) -> Result<MediaImportResult, String> {
    let root = data_root();
    let category = sanitize_category(&category).ok_or("unknown_category")?;
    let src = PathBuf::from(&src_path);

    let meta = fs::metadata(&src).map_err(|e| format!("source_unreadable: {e}"))?;
    if !meta.is_file() {
        return Err("source_not_file".into());
    }

    let ext = sanitize_extension(src.extension().and_then(|e| e.to_str()));
    let rel = new_relative_path(category, &ext);
    let dest = root.join(&rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("disk_write_failed: {e}"))?;
    }
    fs::copy(&src, &dest).map_err(|e| format!("disk_write_failed: {e}"))?;

    Ok(MediaImportResult {
        bytes: meta.len(),
        file_name: src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("file.{ext}")),
        ext,
        rel,
    })
}

/// 字节流入库。给剪贴板粘贴、旧 base64 迁移、生图落盘用——这些本来就没有源路径。
#[tauri::command]
pub fn media_import_bytes(
    bytes: Vec<u8>,
    ext: String,
    category: String,
    file_name: Option<String>,
) -> Result<MediaImportResult, String> {
    let root = data_root();
    let category = sanitize_category(&category).ok_or("unknown_category")?;
    let ext = sanitize_extension(Some(&ext));
    let rel = new_relative_path(category, &ext);
    let dest = root.join(&rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("disk_write_failed: {e}"))?;
    }
    let len = bytes.len() as u64;
    fs::write(&dest, bytes).map_err(|e| format!("disk_write_failed: {e}"))?;

    Ok(MediaImportResult {
        bytes: len,
        file_name: file_name.unwrap_or_else(|| format!("file.{ext}")),
        ext,
        rel,
    })
}

#[tauri::command]
pub fn media_export(rel: String, dest_path: String) -> Result<(), String> {
    let root = data_root();
    let src = resolve_media_path(root, &rel).ok_or("not_found")?;
    fs::copy(&src, &dest_path).map_err(|e| format!("disk_write_failed: {e}"))?;
    Ok(())
}

/// 删除若干文件。逐条安全化，越权或不存在的静默跳过——批量删不该被一条坏路径整个打断。
#[tauri::command]
pub fn media_delete(rels: Vec<String>) -> Result<u64, String> {
    let root = data_root();
    let mut removed = 0u64;
    for rel in rels {
        if let Some(path) = resolve_media_path(root, &rel) {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn media_reveal(rel: String) -> Result<(), String> {
    let root = data_root();
    let path = resolve_media_path(root, &rel).ok_or("not_found")?;
    // 没有跨平台的「选中该文件」，退而求其次打开所在目录
    let target = path.parent().unwrap_or(root);
    open::that(target).map_err(|e| e.to_string())
}

/// 打开数据根本身（设置里的「打开文件夹」）。
#[tauri::command]
pub fn media_open_root() -> Result<(), String> {
    open::that(data_root()).map_err(|e| e.to_string())
}

/// 删除不在 `referenced` 里的文件。
///
/// 只在用户从资产管理器显式触发时调用，**不自动跑**：画布数据在 IndexedDB，
/// Rust 侧无从判断引用关系，误判的代价是永久丢图。
#[tauri::command]
pub fn media_gc(referenced: Vec<String>) -> Result<MediaGcResult, String> {
    let root = data_root();
    let keep: std::collections::HashSet<String> = referenced.into_iter().collect();
    let mut removed = 0u64;
    let mut bytes = 0u64;

    for (path, meta) in walk_media(root) {
        let Some(rel) = to_rel_string(root, &path) else {
            continue;
        };
        if keep.contains(&rel) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            removed += 1;
            bytes += meta.len();
        }
    }

    Ok(MediaGcResult { removed, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── percent_decode ──

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("a%2Fb").unwrap(), "a/b");
        assert_eq!(percent_decode("%E4%B8%AD").unwrap(), "中");
    }

    #[test]
    fn keeps_malformed_escapes_literal() {
        assert_eq!(percent_decode("100%zz").unwrap(), "100%zz");
        assert_eq!(percent_decode("tail%").unwrap(), "tail%");
    }

    // ── sanitize_relative_path ──

    #[test]
    fn accepts_plain_relative_path() {
        let p = sanitize_relative_path("/media/generated/2026/07/ab12.png").unwrap();
        assert_eq!(p, PathBuf::from("media/generated/2026/07/ab12.png"));
    }

    #[test]
    fn accepts_percent_encoded_unicode_names() {
        let p = sanitize_relative_path("/media/uploaded/%E5%9B%BE.png").unwrap();
        assert_eq!(p, PathBuf::from("media/uploaded/图.png"));
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(sanitize_relative_path("../secret").is_none());
        assert!(sanitize_relative_path("media/../../secret").is_none());
        assert!(sanitize_relative_path("media/generated/..").is_none());
    }

    #[test]
    fn rejects_encoded_traversal() {
        // 先 decode 后判断，`%2e%2e` 同样要拦下
        assert!(sanitize_relative_path("%2e%2e/secret").is_none());
        assert!(sanitize_relative_path("media%2F..%2F..%2Fsecret").is_none());
        assert!(sanitize_relative_path("%2E%2E%5Csecret").is_none());
    }

    #[test]
    fn rejects_windows_separators_used_for_traversal() {
        assert!(sanitize_relative_path("..\\secret").is_none());
        assert!(sanitize_relative_path("media\\..\\..\\secret").is_none());
    }

    #[test]
    fn rejects_drive_letters_and_data_streams() {
        assert!(sanitize_relative_path("C:/Windows/System32").is_none());
        assert!(sanitize_relative_path("/C:/Windows").is_none());
        assert!(sanitize_relative_path("media/a.png:stream").is_none());
    }

    #[test]
    fn rejects_empty_and_nul() {
        assert!(sanitize_relative_path("").is_none());
        assert!(sanitize_relative_path("/").is_none());
        assert!(sanitize_relative_path("///").is_none());
        assert!(sanitize_relative_path("a%00b").is_none());
    }

    #[test]
    fn collapses_redundant_separators_and_dots() {
        let p = sanitize_relative_path("//media///./generated//x.png").unwrap();
        assert_eq!(p, PathBuf::from("media/generated/x.png"));
    }

    // ── resolve_media_path ──

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spoor-test-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("media/generated")).unwrap();
        dir
    }

    #[test]
    fn resolves_existing_file_inside_root() {
        let root = temp_root("resolve");
        let file = root.join("media/generated/a.png");
        fs::write(&file, b"x").unwrap();

        let got = resolve_media_path(&root, "/media/generated/a.png").unwrap();
        assert_eq!(got, file.canonicalize().unwrap());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_to_escape_root_even_when_target_exists() {
        let root = temp_root("escape");
        let outside = root.parent().unwrap().join("outside.txt");
        fs::write(&outside, b"secret").unwrap();

        assert!(resolve_media_path(&root, "../outside.txt").is_none());
        fs::remove_file(&outside).ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_file_resolves_to_none() {
        let root = temp_root("missing");
        assert!(resolve_media_path(&root, "media/generated/nope.png").is_none());
        fs::remove_dir_all(&root).ok();
    }

    // ── parse_range ──

    #[test]
    fn parses_closed_range() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-999", 1000), Some((500, 999)));
    }

    #[test]
    fn parses_open_ended_range() {
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
    }

    #[test]
    fn parses_suffix_range() {
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // 后缀比文件还长 → 整个文件
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
    }

    #[test]
    fn clamps_end_past_eof() {
        assert_eq!(parse_range("bytes=990-99999", 1000), Some((990, 999)));
    }

    #[test]
    fn rejects_out_of_bounds_and_malformed_ranges() {
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=500-100", 1000), None);
        assert_eq!(parse_range("items=0-10", 1000), None);
        assert_eq!(parse_range("bytes=abc", 1000), None);
        assert_eq!(parse_range("bytes=-0", 1000), None);
        assert_eq!(parse_range("bytes=0-10", 0), None);
    }

    #[test]
    fn rejects_multi_range() {
        // 多段要 multipart/byteranges，没实现就明确不认，而不是只回第一段
        assert_eq!(parse_range("bytes=0-10,20-30", 1000), None);
    }

    // ── serve_media ──

    #[test]
    fn serves_whole_file_with_accept_ranges() {
        let root = temp_root("serve");
        fs::write(root.join("media/generated/a.png"), b"0123456789").unwrap();

        let res = serve_media(&root, "/media/generated/a.png", None);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers().get(header::ACCEPT_RANGES).unwrap(), "bytes");
        assert_eq!(res.body(), b"0123456789");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn serves_partial_content_for_range() {
        let root = temp_root("partial");
        fs::write(root.join("media/generated/v.mp4"), b"0123456789").unwrap();

        let res = serve_media(&root, "/media/generated/v.mp4", Some("bytes=2-5"));
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body(), b"2345");
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 2-5/10"
        );
        assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "4");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn answers_416_for_unsatisfiable_range() {
        let root = temp_root("416");
        fs::write(root.join("media/generated/a.png"), b"0123456789").unwrap();

        let res = serve_media(&root, "/media/generated/a.png", Some("bytes=99-200"));
        assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes */10");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn traversal_gets_403_not_404() {
        let root = temp_root("403");
        // 403 而不是 404：不暴露数据根外的文件存不存在
        let res = serve_media(&root, "/../../etc/passwd", None);
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            serve_media(&root, "%2e%2e%2fsecret", None).status(),
            StatusCode::FORBIDDEN
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_file_gets_404_not_403() {
        // 路径本身没问题、只是文件被删了：前端要据此显示「文件已删除」占位，
        // 和「有人在试穿越」必须区分开
        let root = temp_root("404");
        let res = serve_media(&root, "/media/generated/nope.png", None);
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn directory_gets_404() {
        let root = temp_root("dir");
        let res = serve_media(&root, "/media/generated", None);
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn guesses_content_type_from_extension() {
        let root = temp_root("mime");
        fs::write(root.join("media/generated/a.png"), b"x").unwrap();
        let res = serve_media(&root, "/media/generated/a.png", None);
        assert_eq!(res.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
        fs::remove_dir_all(&root).ok();
    }

    // ── 其他纯函数 ──

    #[test]
    fn category_whitelist_rejects_anything_else() {
        assert_eq!(sanitize_category("generated"), Some("generated"));
        assert_eq!(sanitize_category("uploaded"), Some("uploaded"));
        assert_eq!(sanitize_category("documents"), Some("documents"));
        assert_eq!(sanitize_category("../etc"), None);
        assert_eq!(sanitize_category(""), None);
    }

    #[test]
    fn extension_is_stripped_to_alphanumerics() {
        assert_eq!(sanitize_extension(Some("PNG")), "png");
        assert_eq!(sanitize_extension(Some("../../x")), "x");
        assert_eq!(sanitize_extension(Some("")), "bin");
        assert_eq!(sanitize_extension(None), "bin");
        assert_eq!(sanitize_extension(Some("tar.gz")), "targz");
    }

    #[test]
    fn relative_path_layout_is_year_month_uuid() {
        let rel = new_relative_path("generated", "png");
        let parts: Vec<&str> = rel.split('/').collect();
        assert_eq!(parts[0], "media");
        assert_eq!(parts[1], "generated");
        assert_eq!(parts[2].len(), 4, "year: {rel}");
        assert_eq!(parts[3].len(), 2, "month: {rel}");
        assert!(parts[4].ends_with(".png"), "{rel}");
        // 两次调用不能撞名
        assert_ne!(new_relative_path("generated", "png"), rel);
    }
}
