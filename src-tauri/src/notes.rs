//! 笔记镜像的文件读写（`SpoorData/notes/`）。
//!
//! 0.5.0 的「笔记落文件」：IndexedDB 仍是运行时主库，前端把每张画布防抖序列化成
//! 一个 JSON Canvas 超集文件写到这里。本模块只做三件事——**原子写**、批量读、删除。
//!
//! 原子写是网盘场景的生命线：Dropbox/坚果云可能在任意时刻同步这个目录，
//! 直接 `fs::write` 的半截文件被同步走，另一台机器就会读到坏数据。
//! 写临时文件再 rename 保证目录里任何时刻可见的都是完整文件。

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const NOTES_DIR_NAME: &str = "notes";
/// 单文件上限：一张画布的 JSON 超过它多半是数据异常而不是正常笔记。
const MAX_NOTE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
pub struct NoteFile {
    pub name: String,
    pub content: String,
}

fn notes_dir() -> Result<PathBuf, String> {
    let dir = crate::media::data_root().join(NOTES_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("create_notes_dir: {e}"))?;
    Ok(dir)
}

/// 文件名白名单：镜像文件名全部由前端从 uuid/固定名拼出，任何越界字符直接拒绝。
/// 不做"清洗后继续"——名字不对说明调用方出了错，掩盖它只会把错误延后到读不回来的那天。
fn ensure_valid_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 160
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && (name.ends_with(".canvas") || name.ends_with(".json"));
    if ok { Ok(()) } else { Err("invalid_note_name".into()) }
}

#[tauri::command]
pub fn notes_write(name: String, content: String) -> Result<(), String> {
    ensure_valid_name(&name)?;
    if content.len() > MAX_NOTE_BYTES {
        return Err("note_too_large".into());
    }
    let dir = notes_dir()?;
    let tmp = dir.join(format!("{name}.tmp"));
    let target = dir.join(&name);
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write_tmp: {e}"))?;
    // Windows 上 rename 到已存在目标会失败，先删旧的；两步之间进程崩溃的窗口极小，
    // 且 .tmp 仍在，下一次写入会覆盖——不会出现"新旧都没了"。
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("replace_old: {e}"))?;
    }
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// 读回全部镜像文件。启动对账用——一次全量拉取比逐文件 IPC 往返省得多。
/// 单个文件读失败（被占用/损坏）跳过并继续：一个坏文件不该挡住其余画布的对账。
#[tauri::command]
pub fn notes_read_all() -> Result<Vec<NoteFile>, String> {
    let dir = notes_dir()?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if ensure_valid_name(&name).is_err() {
            continue; // .tmp 残留、网盘冲突副本等非常规名字不进对账
        }
        match fs::read_to_string(&path) {
            Ok(content) => out.push(NoteFile { name, content }),
            Err(e) => eprintln!("[Spoor] notes_read_all 跳过 {name}: {e}"),
        }
    }
    Ok(out)
}

/// 列出目录里**不符合**镜像命名规则的文件名（网盘冲突副本检测用，前端据此提示）。
#[tauri::command]
pub fn notes_list_foreign() -> Result<Vec<String>, String> {
    let dir = notes_dir()?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries.flatten() {
        let Some(name) = entry.path().file_name().and_then(|n| n.to_str()).map(String::from)
        else {
            continue;
        };
        if name.ends_with(".tmp") {
            continue; // 自己的写入残留不算外来户
        }
        if ensure_valid_name(&name).is_err() {
            out.push(name);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn notes_delete(name: String) -> Result<(), String> {
    ensure_valid_name(&name)?;
    let target = notes_dir()?.join(&name);
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("delete: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ensure_valid_name;

    #[test]
    fn accepts_mirror_names() {
        assert!(ensure_valid_name("default.canvas").is_ok());
        assert!(ensure_valid_name("6f9a2c-1b.canvas").is_ok());
        assert!(ensure_valid_name("articles.json").is_ok());
    }

    #[test]
    fn rejects_traversal_and_foreign_names() {
        assert!(ensure_valid_name("../evil.canvas").is_err());
        assert!(ensure_valid_name("a/b.canvas").is_err());
        assert!(ensure_valid_name("a\\b.canvas").is_err());
        assert!(ensure_valid_name(".hidden.canvas").is_err());
        assert!(ensure_valid_name("note.txt").is_err());
        assert!(ensure_valid_name("画布.canvas").is_err());
        assert!(ensure_valid_name("x (conflicted copy).canvas").is_err());
        assert!(ensure_valid_name("").is_err());
    }
}
