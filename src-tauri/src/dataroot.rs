//! D12：数据目录可迁移——把 `SpoorData/` 整棵复制到用户挑的新位置。
//!
//! 成功后在 `app_config_dir()` 下写 `data-root.json` 记录新根；
//! [`crate::media`] 的数据根解析优先认这份配置，`spoor-media` 协议、快照、
//! 生图落盘等所有读数据根的地方都走同一个解析入口，因此迁移即时全局生效。
//!
//! **不删旧目录**：复制虽然逐文件校验了总数与字节数，但「新位置真的可用」
//! （外接盘不掉线、网络盘权限稳定）只有用户自己跑一段时间才知道。删除的
//! 决定权留给用户——前端在迁移完成后明确提示旧目录还在哪里。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::media;

/// 配置文件名，落在 `app_config_dir()` 下。
///
/// 不放数据根内：配置要回答的是「数据根在哪」，自己不能住在被指向的地方；
/// 也不放 exe 旁：perMachine 安装时 Program Files 写不进去。
pub const CONFIG_FILE: &str = "data-root.json";

/// 迁移进度事件名，模式同 `updater.rs` 的 `update-download-progress`。
pub const PROGRESS_EVENT: &str = "data-root-migrate-progress";

#[derive(Serialize, Deserialize)]
struct DataRootConfig {
    root: String,
}

/// 配置文件绝对路径。`app_config_dir` 取不到（极少见）返回 `None`，调用方按「无配置」走。
pub fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(CONFIG_FILE))
}

/// 读配置并验证，返回 `Some` 才算配置生效。要求：绝对路径、目录存在、
/// 带 [`media::ROOT_MARKER`] 标记、可写。任何一条不满足都回退默认位置。
///
/// 尤其**不能**替用户把缺失的目录重建出来：外接盘没插上时重建一个空根，
/// 应用看起来「数据全没了」，而回退默认位置至少还能读到迁移前的旧数据。
pub fn configured_root(config_file: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(config_file).ok()?;
    let config: DataRootConfig = serde_json::from_str(&text).ok()?;
    let root = PathBuf::from(config.root);
    if !root.is_absolute() || !root.is_dir() {
        return None;
    }
    let marker = root.join(media::ROOT_MARKER);
    if !marker.is_file() {
        return None;
    }
    // 可写性直接试写标记文件——Windows 上目录的 readonly 元数据不反映 ACL
    fs::write(&marker, b"spoor\n").ok()?;
    Some(root)
}

/// 把新根写进配置。写失败要如实报错——静默吞掉的话重启后又回旧位置，用户会以为迁移成功了。
fn write_config(config_file: &Path, root: &Path) -> Result<(), String> {
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("config_write_failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&DataRootConfig {
        root: root.to_string_lossy().into_owned(),
    })
    .map_err(|e| format!("config_write_failed: {e}"))?;
    fs::write(config_file, json).map_err(|e| format!("config_write_failed: {e}"))
}

// ───────────────────────────── 迁移 ─────────────────────────────

/// 校验迁移目标并返回新数据根 `new_parent/SpoorData`。
///
/// - 目标已存在 → 拒绝：那可能是另一个 Spoor 实例的数据目录，覆盖等于毁掉别人的库。
/// - 新根落在当前根内（或当前根落在新根内）→ 拒绝：复制会追着自己的尾巴跑。
pub fn plan_target(current_root: &Path, new_parent: &Path) -> Result<PathBuf, String> {
    let dest = new_parent.join(media::DATA_DIR_NAME);
    if dest.exists() {
        return Err("target_exists".into());
    }
    if dest.starts_with(current_root) || current_root.starts_with(&dest) {
        return Err("target_nested".into());
    }
    Ok(dest)
}

/// 递归列出 `root` 下的所有文件（含标记文件与 `backups/`——迁移是整棵搬）。
fn walk_files(root: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
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
                out.push((path, meta.len()));
            }
        }
    }
    out
}

/// 逐文件复制 `src_root` → `dest_root`，完毕后重数目标校验总数与字节数。
///
/// 返回 `(files, bytes)`。任何一步失败（含磁盘满、无写权限——它们都会以
/// `disk_write_failed` 的 io 错误浮上来）都返回 `Err`，调用方负责清掉复制了一半的目标。
/// 进度回调按文件粒度触发：复制本身是 IO 大头，事件频率不会超过文件数。
pub fn copy_tree(
    src_root: &Path,
    dest_root: &Path,
    on_progress: &mut dyn FnMut(u64, u64, u64, u64),
) -> Result<(u64, u64), String> {
    let files = walk_files(src_root);
    let total_files = files.len() as u64;
    let total_bytes: u64 = files.iter().map(|(_, len)| *len).sum();

    fs::create_dir_all(dest_root).map_err(|e| format!("disk_write_failed: {e}"))?;

    let mut copied = 0u64;
    let mut bytes_copied = 0u64;
    for (path, _) in &files {
        let rel = path
            .strip_prefix(src_root)
            .map_err(|_| "bad_source_path".to_string())?;
        let dest = dest_root.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("disk_write_failed: {e}"))?;
        }
        let written = fs::copy(path, &dest).map_err(|e| format!("disk_write_failed: {e}"))?;
        copied += 1;
        bytes_copied += written;
        on_progress(copied, total_files, bytes_copied, total_bytes);
    }

    // 复制完把目标整棵重数一遍：文件数与字节数都要对上。对不上说明这次复制不可信
    // （最常见的是迁移期间源目录还在被写入），宁可失败重来也不切换到一个残缺的根。
    let check = walk_files(dest_root);
    let check_bytes: u64 = check.iter().map(|(_, len)| *len).sum();
    if check.len() as u64 != total_files || check_bytes != total_bytes {
        return Err("verify_mismatch".into());
    }
    Ok((total_files, total_bytes))
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 当前生效的数据根绝对路径。
#[tauri::command]
pub fn data_root_get() -> String {
    media::data_root().to_string_lossy().into_owned()
}

/// 把现有数据根**复制**到 `new_parent/SpoorData/` 并切换过去，返回新数据根。
///
/// - `new_parent` 必须是用户刚在本进程目录对话框里选的路径
///   （复用 [`crate::userfile`] 的写入白名单，前端伪造不出授权）。
/// - 只复制不删除；失败时清掉半成品目标、配置与数据根都不动——失败必须等于「什么都没发生」。
#[tauri::command]
pub async fn data_root_migrate(app: AppHandle, new_parent: String) -> Result<String, String> {
    let parent = crate::userfile::ensure_write_allowed(&new_parent)?;
    if !parent.is_dir() {
        return Err("parent_not_dir".into());
    }

    let current = media::data_root();
    let dest = plan_target(&current, &parent)?;
    let config_file = config_path(&app).ok_or("config_dir_unavailable")?;

    let emitter = app.clone();
    let src = current.clone();
    let dest_for_copy = dest.clone();
    // 逐文件复制是纯阻塞 IO，几个 GB 的库会占住线程几十秒，别堵 IPC
    let copy_result = tauri::async_runtime::spawn_blocking(move || {
        let mut emit = |copied: u64, total: u64, bytes_copied: u64, bytes_total: u64| {
            let _ = emitter.emit(
                PROGRESS_EVENT,
                serde_json::json!({
                    "copied": copied,
                    "total": total,
                    "bytesCopied": bytes_copied,
                    "bytesTotal": bytes_total,
                }),
            );
        };
        copy_tree(&src, &dest_for_copy, &mut emit)
    })
    .await
    .map_err(|e| format!("migrate_task_failed: {e}"))?;

    if let Err(e) = copy_result {
        // 目标是本次新建的（plan_target 已拒绝既存目录），里面只有我们写的东西，
        // 整个删掉不会伤到别的数据
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    write_config(&config_file, &dest)?;
    media::set_data_root(dest.clone());
    println!("[Spoor] 数据根已迁移：{}", dest.display());
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("spoor-dataroot-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 造一个像真数据根的目录：标记文件 + 两层媒体文件。
    fn fake_root(dir: &Path) {
        fs::create_dir_all(dir.join("media/generated/2026/07")).unwrap();
        fs::write(dir.join(media::ROOT_MARKER), b"spoor\n").unwrap();
        fs::write(dir.join("media/generated/2026/07/a.png"), b"0123456789").unwrap();
        fs::write(dir.join("media/generated/2026/07/b.png"), b"xy").unwrap();
    }

    // ── configured_root：数据根解析的「配置」分支 ──

    #[test]
    fn missing_config_file_yields_none() {
        let dir = temp_dir("no-config");
        // 配置不存在 → None → 调用方回退默认位置
        assert!(configured_root(&dir.join(CONFIG_FILE)).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn valid_config_resolves_to_recorded_root() {
        let dir = temp_dir("valid");
        let root = dir.join("SpoorData");
        fake_root(&root);
        let cfg = dir.join(CONFIG_FILE);
        write_config(&cfg, &root).unwrap();

        assert_eq!(configured_root(&cfg).unwrap(), root);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stale_config_pointing_to_missing_dir_yields_none() {
        let dir = temp_dir("stale");
        let cfg = dir.join(CONFIG_FILE);
        // 记录的位置已经不存在（外接盘拔了 / 目录被删）→ 回退默认，绝不重建空目录
        write_config(&cfg, &dir.join("gone/SpoorData")).unwrap();
        assert!(configured_root(&cfg).is_none());
        assert!(!dir.join("gone").exists(), "解析过程不该替用户新建目录");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dir_without_marker_yields_none() {
        let dir = temp_dir("no-marker");
        let root = dir.join("SpoorData");
        fs::create_dir_all(&root).unwrap();
        let cfg = dir.join(CONFIG_FILE);
        write_config(&cfg, &root).unwrap();
        // 目录在但没有标记文件：可能只是同名目录，不认
        assert!(configured_root(&cfg).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn malformed_or_relative_config_yields_none() {
        let dir = temp_dir("malformed");
        let cfg = dir.join(CONFIG_FILE);

        fs::write(&cfg, b"not json").unwrap();
        assert!(configured_root(&cfg).is_none());

        fs::write(&cfg, br#"{"root":"relative/SpoorData"}"#).unwrap();
        assert!(configured_root(&cfg).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    // ── plan_target ──

    #[test]
    fn plan_appends_data_dir_name_to_parent() {
        let dir = temp_dir("plan");
        let current = dir.join("old/SpoorData");
        fake_root(&current);
        let parent = dir.join("new");
        fs::create_dir_all(&parent).unwrap();

        assert_eq!(
            plan_target(&current, &parent).unwrap(),
            parent.join(media::DATA_DIR_NAME)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plan_rejects_existing_target() {
        let dir = temp_dir("exists");
        let current = dir.join("old/SpoorData");
        fake_root(&current);
        let parent = dir.join("new");
        // 目标位置已经有一个 SpoorData——可能是别的实例的数据，绝不覆盖
        fs::create_dir_all(parent.join(media::DATA_DIR_NAME)).unwrap();

        assert_eq!(plan_target(&current, &parent), Err("target_exists".into()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plan_rejects_nesting_either_way() {
        let dir = temp_dir("nested");
        let current = dir.join("SpoorData");
        fake_root(&current);

        // 往自己肚子里迁：dest = SpoorData/media/SpoorData
        assert_eq!(
            plan_target(&current, &current.join("media")),
            Err("target_nested".into())
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── copy_tree ──

    #[test]
    fn copies_everything_and_reports_progress() {
        let dir = temp_dir("copy");
        let src = dir.join("SpoorData");
        fake_root(&src);
        let dest = dir.join("new/SpoorData");

        let mut events: Vec<(u64, u64, u64, u64)> = Vec::new();
        let (files, bytes) = copy_tree(&src, &dest, &mut |c, t, bc, bt| {
            events.push((c, t, bc, bt));
        })
        .unwrap();

        assert_eq!(files, 3); // 标记文件 + 两张图
        assert_eq!(bytes, 6 + 10 + 2); // "spoor\n" + a.png + b.png
        assert_eq!(
            fs::read(dest.join("media/generated/2026/07/a.png")).unwrap(),
            b"0123456789"
        );
        assert!(dest.join(media::ROOT_MARKER).is_file());
        // 进度单调推进到总数
        assert_eq!(events.len(), 3);
        assert_eq!(events.last().unwrap().0, 3);
        assert_eq!(events.last().unwrap().2, bytes);
        // 源目录原封不动
        assert!(src.join("media/generated/2026/07/a.png").is_file());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn config_roundtrip_after_copy_activates_new_root() {
        // 迁移主链路的纯函数串联：复制 → 写配置 → 解析读回同一个根
        let dir = temp_dir("roundtrip");
        let src = dir.join("SpoorData");
        fake_root(&src);
        let dest = dir.join("moved/SpoorData");
        copy_tree(&src, &dest, &mut |_, _, _, _| {}).unwrap();

        let cfg = dir.join(CONFIG_FILE);
        write_config(&cfg, &dest).unwrap();
        assert_eq!(configured_root(&cfg).unwrap(), dest);
        fs::remove_dir_all(&dir).ok();
    }

    // ── data_root_migrate 的白名单前置 ──

    #[test]
    fn migrate_parent_must_be_dialog_authorized() {
        // `data_root_migrate` 的第一步是过 userfile 的写入白名单：目录没经过
        // 本进程对话框授权必须被拦下。单测进程里没有 AppHandle，造不出完整的
        // 命令调用，这里验的是命令复用的那道前置检查本身。
        let dir = temp_dir("deny");
        assert_eq!(
            crate::userfile::ensure_write_allowed(&dir.to_string_lossy()),
            Err("path_not_authorized".into())
        );
        fs::remove_dir_all(&dir).ok();
    }
}
