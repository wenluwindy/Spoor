//! 自动快照：把备份 JSON 写进数据根下的 `backups/`，只保留最近若干份。
//!
//! 与 [`crate::userfile`] 的分工：那边写的是**用户当场在对话框里选定**的路径，
//! 这边写的是应用自己管理的目录，前端只能给一个文件名、给不了路径。所以这里对文件名
//! 的要求很死（见 [`is_valid_name`]）——一个带 `..` 或斜杠的名字就能把写入点挪出数据根，
//! 而这条路径上没有用户参与、没人会发现。
//!
//! 保留份数在写入时就地裁剪：与其等一个"清理"入口被人想起来点，不如每次写完顺手删掉最老的。

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::media::data_root;

/// 数据根下的快照目录名。
pub const SNAPSHOT_DIR: &str = "backups";

/// 保留的快照份数。七天足够覆盖"上周还好好的"这类回溯，再多只是占地方。
pub const SNAPSHOT_KEEP: usize = 7;

#[derive(Serialize)]
pub struct SnapshotEntry {
    pub name: String,
    pub bytes: u64,
    /// Unix 毫秒。
    pub mtime: u64,
}

/// 只认 `字母数字 . _ -` 组成、以 `.json` 结尾的名字。
///
/// 不用「先拼路径再 canonicalize 校验」那套：这里的输入本来就该是应用自己生成的
/// 日期文件名，白名单式的判断更容易一眼看明白它挡住了什么。
pub fn is_valid_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 || !name.ends_with(".json") {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && !name.contains("..")
}

fn snapshot_dir() -> PathBuf {
    data_root().join(SNAPSHOT_DIR)
}

fn read_entries() -> Vec<SnapshotEntry> {
    let dir = snapshot_dir();
    let Ok(read) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut out: Vec<SnapshotEntry> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_valid_name(&name) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(SnapshotEntry {
                name,
                bytes: meta.len(),
                mtime,
            })
        })
        .collect();

    // 新的在前
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| b.name.cmp(&a.name)));
    out
}

/// 写一份快照，并把超出保留份数的最老几份删掉。返回实际写入的文件名。
#[tauri::command]
pub fn snapshot_write(name: String, contents: String) -> Result<String, String> {
    if !is_valid_name(&name) {
        return Err("invalid_name".to_string());
    }
    let dir = snapshot_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("disk_write_failed: {e}"))?;
    fs::write(dir.join(&name), contents).map_err(|e| format!("disk_write_failed: {e}"))?;

    for stale in read_entries().into_iter().skip(SNAPSHOT_KEEP) {
        let _ = fs::remove_file(dir.join(stale.name));
    }

    Ok(name)
}

#[tauri::command]
pub fn snapshot_list() -> Vec<SnapshotEntry> {
    read_entries()
}

#[tauri::command]
pub fn snapshot_read(name: String) -> Result<String, String> {
    if !is_valid_name(&name) {
        return Err("invalid_name".to_string());
    }
    fs::read_to_string(snapshot_dir().join(&name)).map_err(|e| format!("not_found: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_valid_name;

    #[test]
    fn accepts_generated_names() {
        assert!(is_valid_name("spoor-backup-2026-08-01.json"));
        assert!(is_valid_name("a_b.json"));
    }

    #[test]
    fn rejects_anything_that_could_escape_the_directory() {
        assert!(!is_valid_name("../secrets.json"));
        assert!(!is_valid_name("sub/dir.json"));
        assert!(!is_valid_name("sub\\dir.json"));
        assert!(!is_valid_name("C:.json"));
        assert!(!is_valid_name("..json"));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("no-extension"));
        assert!(!is_valid_name("空格 也不行.json"));
    }
}
