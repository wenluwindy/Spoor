//! 读写「用户在系统对话框里刚选中的那个文件」。
//!
//! 与 [`crate::media`] 的区别是信任模型，不是功能：`media_*` 只在数据根 `SpoorData/`
//! 内活动，任何路径都要先过 `resolve_media_path` 才允许落地；这里处理的是数据根**之外**
//! 的任意绝对路径——导出画布、导入 `.canvas`、还原备份，目标都由用户在系统的保存/打开
//! 对话框里当场指定。
//!
//! 「由用户当场指定」以前只是注释里的约定，写入命令实际上来者不拒——被注入的前端
//! 代码可以往任意路径写任意内容。现在把约定变成机制：**对话框在 Rust 侧弹**
//! （[`user_file_pick_save_path`] / [`user_file_pick_directory`]），返回的路径当场记入
//! 进程内白名单，写入命令只放行白名单里的路径。授权凭据「用户选了什么」从头到尾
//! 不离开 Rust，前端伪造不出来。
//!
//! 体积上限是防呆而非防攻击——挑错文件（比如一个 2GB 的视频）时给一条清楚的错误，
//! 好过把整块内容读进内存再让渲染进程卡死。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use serde::Deserialize;
use tauri_plugin_dialog::DialogExt;

/// 可读入的文本文件上限。`.canvas` 与备份 JSON 都是纯文本，正常远小于此。
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

// ───────────────────────────── 写入白名单 ─────────────────────────────

/// 文件级授权：保存对话框返回的那一个路径，精确匹配。
fn granted_files() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 目录级授权：目录选择对话框返回的目录，整棵子树都算数——
/// 导出 Markdown 包要往 `<目录>/assets/` 里塞一批文件，逐个弹对话框没法用。
fn granted_dirs() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Windows 的 canonicalize 会带 `\\?\` 前缀，而对话框返回的字符串没有。
/// 两边都要过 [`normalize_path`] 才可比，这里统一剥掉（UNC 形式除外，剥了语义就变了）。
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path,
    }
}

/// 把路径规整成可比较、可安全落笔的规范形式。
///
/// 目标可能还不存在（保存对话框允许新文件、Markdown 包的 `assets/` 子目录后建），
/// 所以从最深的**已存在**祖先开始 canonicalize，再把剩余段接回去。剩余段里的 `..`
/// 会让 `file_name()` 返回 `None`，顺势拒绝——canonicalize 之后再拼 `..` 等于白做。
fn normalize_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("path_not_absolute".into());
    }

    let mut existing = path;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|n| n.to_os_string()) else {
            return Err("bad_path".into());
        };
        tail.push(name);
        if !existing.pop() {
            return Err("bad_path".into());
        }
    }

    let mut out = existing
        .canonicalize()
        .map_err(|e| format!("bad_path: {e}"))?;
    for segment in tail.iter().rev() {
        out.push(segment);
    }
    Ok(strip_verbatim(out))
}

/// 明显不该往里写的系统目录。白名单之外再加这道栏，是防「用户在对话框里手滑
/// 选进了 `C:\Windows`」——选了也不该写成功。
fn forbidden_roots() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |dir: PathBuf| {
        // 尽量与 normalize 后的形态一致；canonicalize 不了（目录不存在）就按字面比
        let normalized = dir.canonicalize().map(strip_verbatim).unwrap_or(dir);
        out.push(normalized);
    };
    if cfg!(windows) {
        for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
            if let Ok(dir) = std::env::var(var) {
                if !dir.is_empty() {
                    push(PathBuf::from(dir));
                }
            }
        }
    } else {
        for dir in ["/bin", "/sbin", "/usr", "/etc", "/boot", "/proc", "/sys", "/dev", "/System", "/Library"] {
            push(PathBuf::from(dir));
        }
    }
    out
}

fn is_forbidden(path: &Path) -> bool {
    forbidden_roots().iter().any(|root| path.starts_with(root))
}

/// 写入前的准入检查：路径必须是「用户刚在本进程的对话框里指定过的」。
/// 通过时返回规范化后的路径，写入要用它——原始字符串可能与授权时的形态不同。
///
/// `pub(crate)`：除本模块的 `user_file_write_*` 外，[`crate::media`] 的
/// `media_export` 往数据根**之外**落文件，同样必须过这道白名单。
pub(crate) fn ensure_write_allowed(dest_path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_path(dest_path)?;
    if is_forbidden(&normalized) {
        return Err("path_forbidden".into());
    }
    if granted_files()
        .lock()
        .map_err(|_| "lock_poisoned".to_string())?
        .contains(&normalized)
    {
        return Ok(normalized);
    }
    if granted_dirs()
        .lock()
        .map_err(|_| "lock_poisoned".to_string())?
        .iter()
        .any(|dir| normalized.starts_with(dir))
    {
        return Ok(normalized);
    }
    Err("path_not_authorized".into())
}

fn grant_file(path: PathBuf) {
    if let Ok(mut set) = granted_files().lock() {
        set.insert(path);
    }
}

fn grant_dir(path: PathBuf) {
    if let Ok(mut set) = granted_dirs().lock() {
        set.insert(path);
    }
}

// ───────────────────────────── 对话框命令 ─────────────────────────────

/// 前端传来的过滤器，形状与 `@tauri-apps/plugin-dialog` 的 `filters` 一致，
/// 省得调用方为换命令再改一遍数据结构。
#[derive(Deserialize)]
pub struct SaveDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// 弹系统「保存」对话框，把用户选的路径记入白名单后返回。用户取消返回 `None`。
///
/// 对话框必须在 Rust 侧弹而不是前端调 `@tauri-apps/plugin-dialog`：授权要落在
/// 进程内的白名单里，`user_file_write_*` 才有得校验。覆盖确认对话框自己会问。
#[tauri::command]
pub async fn user_file_pick_save_path(
    app: tauri::AppHandle,
    default_file_name: Option<String>,
    filters: Option<Vec<SaveDialogFilter>>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(name) = default_file_name {
        dialog = dialog.set_file_name(name);
    }
    for filter in filters.unwrap_or_default() {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }

    // 对话框回调在别的线程触发，oneshot 把结果递回这个 async 命令
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|e| format!("dialog_failed: {e}"))? else {
        return Ok(None);
    };

    let path = picked.into_path().map_err(|e| format!("dialog_failed: {e}"))?;
    let normalized = normalize_path(&path.to_string_lossy())?;
    if is_forbidden(&normalized) {
        return Err("path_forbidden".into());
    }
    grant_file(normalized.clone());
    Ok(Some(normalized.to_string_lossy().into_owned()))
}

/// 弹系统「选择文件夹」对话框，目录整棵记入白名单后返回。用户取消返回 `None`。
///
/// 给导出 Markdown 包用：正文与 `assets/` 下的每个文件都要写进这个目录，
/// 各文件的相对位置由代码决定，不该为每个文件再问用户一次。
#[tauri::command]
pub async fn user_file_pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|e| format!("dialog_failed: {e}"))? else {
        return Ok(None);
    };

    let path = picked.into_path().map_err(|e| format!("dialog_failed: {e}"))?;
    let normalized = normalize_path(&path.to_string_lossy())?;
    if is_forbidden(&normalized) {
        return Err("path_forbidden".into());
    }
    grant_dir(normalized.clone());
    Ok(Some(normalized.to_string_lossy().into_owned()))
}

/// 弹系统「打开文件」对话框，返回用户选中的绝对路径。用户取消返回 `None`。
///
/// [`user_file_pick_save_path`] 的姊妹版，但**不进写入白名单**——这是读操作
/// （选 GGUF 模型、导入 `.canvas` 等），授权语义只属于写入。`filters` 结构
/// 与保存版共用 [`SaveDialogFilter`]。
#[tauri::command]
pub async fn user_file_pick_open_path(
    app: tauri::AppHandle,
    filters: Option<Vec<SaveDialogFilter>>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    for filter in filters.unwrap_or_default() {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|e| format!("dialog_failed: {e}"))? else {
        return Ok(None);
    };

    let path = picked.into_path().map_err(|e| format!("dialog_failed: {e}"))?;
    // 打开对话框选的必然是已存在的文件，normalize 只为统一 `\\?\` 前缀等形态
    let normalized = normalize_path(&path.to_string_lossy())?;
    Ok(Some(normalized.to_string_lossy().into_owned()))
}

// ───────────────────────────── 读写命令 ─────────────────────────────

fn ensure_parent(dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("disk_write_failed: {e}"))?;
        }
    }
    Ok(())
}

/// 把文本写到用户选定的路径。已存在则覆盖——保存对话框自己已经问过要不要覆盖了。
#[tauri::command]
pub fn user_file_write_text(dest_path: String, contents: String) -> Result<(), String> {
    let dest = ensure_write_allowed(&dest_path)?;
    ensure_parent(&dest)?;
    fs::write(&dest, contents).map_err(|e| format!("disk_write_failed: {e}"))
}

/// 把 base64 编码的字节写到用户选定的路径。
///
/// 导出 PNG 用：浏览器侧只能拿到 data URL，字节要么在 JS 里转成二进制再过 IPC，
/// 要么就这样把 base64 原样递过来由 Rust 解。后者少一次转换，也少一个出错的地方。
#[tauri::command]
pub fn user_file_write_base64(dest_path: String, contents: String) -> Result<(), String> {
    let dest = ensure_write_allowed(&dest_path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| format!("bad_base64: {e}"))?;
    ensure_parent(&dest)?;
    fs::write(&dest, bytes).map_err(|e| format!("disk_write_failed: {e}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spoor-userfile-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unauthorized_path_is_rejected() {
        let dir = temp_dir("deny");
        let dest = dir.join("out.txt");
        // 没经过对话框授权，写入必须被拒——这正是本次修复的核心语义
        assert_eq!(
            user_file_write_text(dest.to_string_lossy().into_owned(), "x".into()),
            Err("path_not_authorized".into())
        );
        assert!(!dest.exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn granted_file_can_be_written_even_before_it_exists() {
        let dir = temp_dir("grant-file");
        let dest = dir.join("new.txt");
        // 模拟保存对话框返回：授权的是「还不存在的文件」，normalize 要能对上
        grant_file(normalize_path(&dest.to_string_lossy()).unwrap());
        assert!(user_file_write_text(dest.to_string_lossy().into_owned(), "ok".into()).is_ok());
        assert_eq!(fs::read_to_string(&dest).unwrap(), "ok");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn granted_dir_covers_nested_paths_to_be_created() {
        let dir = temp_dir("grant-dir");
        grant_dir(normalize_path(&dir.to_string_lossy()).unwrap());
        // Markdown 包场景：assets/ 还不存在，写入方替用户把中间目录建出来
        let dest = dir.join("assets").join("a.md");
        assert!(user_file_write_text(dest.to_string_lossy().into_owned(), "md".into()).is_ok());
        assert!(dest.is_file());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn traversal_out_of_a_granted_dir_is_rejected() {
        let dir = temp_dir("escape");
        grant_dir(normalize_path(&dir.to_string_lossy()).unwrap());
        // `..` 想借授权目录的名义逃出去：normalize 会把它折回真实位置，前缀就对不上了
        let dest = dir.join("..").join("outside.txt");
        assert!(user_file_write_text(dest.to_string_lossy().into_owned(), "x".into()).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relative_paths_are_rejected() {
        assert_eq!(normalize_path("relative/out.txt"), Err("path_not_absolute".into()));
    }

    #[cfg(windows)]
    #[test]
    fn system_directories_are_forbidden_even_if_granted() {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let dest = PathBuf::from(&system_root).join("spoor-test.txt");
        let normalized = normalize_path(&dest.to_string_lossy()).unwrap();
        // 哪怕白名单里有，系统目录也一票否决
        grant_file(normalized.clone());
        assert!(is_forbidden(&normalized));
        assert_eq!(
            user_file_write_text(dest.to_string_lossy().into_owned(), "x".into()),
            Err("path_forbidden".into())
        );
    }
}
