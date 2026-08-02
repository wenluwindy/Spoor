//! 检查更新：查 GitHub Releases → 下载本平台的安装包 → 交给用户安装。
//!
//! 全链路在 Rust 里，理由和 [`crate::imagegen`] 一致：绕开 CORS、几十 MB 的安装包
//! 不穿 IPC、当前版本号直接从 `package_info()` 读而不必在前端另存一份跟着漂。
//!
//! 没有用 `tauri-plugin-updater`：那套要签名密钥与随包发布的 `latest.json`，
//! 而现有发布流水线（`.github/workflows/release-desktop.yml`）只产出裸安装包
//! （Windows 的 NSIS exe 与 macOS 的通用 dmg）。这里要的语义也更直白——
//! 下载下来，把安装程序交给用户。
//!
//! 「交给用户」在两个平台上是两回事：NSIS 能覆盖安装，退出本进程即可；
//! dmg 打开后要用户自己把 app 拖进「应用程序」，进程不能退，见 [`install_update`]。

use std::cmp::Ordering;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// 仓库固定，不做成配置项：更新只能来自官方发布，可配等于给了投毒入口。
const RELEASES_API: &str = "https://api.github.com/repos/wenluwindy/Spoor/releases/latest";
/// GitHub API 强制要求 UA，缺了直接 403。
const USER_AGENT: &str = "Spoor-Updater";
/// 连不上就是连不上，等更久只是拖长报错。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 查询接口的总超时。只是一个几 KB 的 JSON，超过这个数基本是对面挂了。
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    /// 没有任何发布时为空串。
    pub latest_version: String,
    /// Release 正文，前端折叠展示。
    pub notes: String,
    pub asset_name: String,
    pub asset_size: u64,
    pub download_url: String,
    /// Release 页面地址，给「查看完整说明」用。
    pub release_url: String,
}

// ───────────────────────────── 纯函数 ─────────────────────────────

/// 版本号比较。按数字段逐位比，容忍 `v` 前缀与段数不等。
///
/// 不引 `semver` crate：这里只需要比大小，预发布标记（`-beta.1`）在本项目的
/// 发布流程里不会出现，为它引一个依赖不划算。非数字段一律当 0，
/// 这样 `0.2.0-rc1` 不会被误判成比 `0.2.0` 大。
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    fn parts(v: &str) -> Vec<u64> {
        v.trim()
            .trim_start_matches(['v', 'V'])
            .split('.')
            .map(|seg| {
                let digits: String = seg.chars().take_while(char::is_ascii_digit).collect();
                digits.parse().unwrap_or(0)
            })
            .collect()
    }

    let (left, right) = (parts(a), parts(b));
    let len = left.len().max(right.len());
    for i in 0..len {
        // 段数不等时短的那边补 0：`0.2` 与 `0.2.0` 是同一个版本
        let ordering = left.get(i).unwrap_or(&0).cmp(right.get(i).unwrap_or(&0));
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

/// 从 release 的 assets 里挑出**当前平台**的安装包。
///
/// 不分平台的话 macOS 也会挑到 `.exe`，下载下来双击不了不说，`install_update`
/// 还会顺手把应用退掉。挑不出来就返回 `None` —— 宁可报「暂无更新」，
/// 也别让用户下到一个 `.sig` 或源码包去双击。
pub fn pick_installer_asset(assets: &[Value]) -> Option<(String, String, u64)> {
    pick_installer_asset_for(std::env::consts::OS, assets)
}

/// 平台作为参数拆出来是为了单测：不论 CI 跑在哪个系统上，两条分支都要验得到。
///
/// - Windows：优先 `*-setup.exe`（流水线产出的是 `Spoor_0.2.0_x64-setup.exe`），
///   找不到再退回任意 `.exe`。
/// - macOS：找 `.dmg`（流水线产出的是通用二进制 `Spoor_*_universal.dmg`，一个包
///   同时覆盖 Intel 与 Apple Silicon，不必再按架构挑）。
/// - 其余平台一律 `None`，由调用方报「无适配安装包」。
pub fn pick_installer_asset_for(os: &str, assets: &[Value]) -> Option<(String, String, u64)> {
    let named = |asset: &Value| -> Option<(String, String, u64)> {
        let name = asset.get("name")?.as_str()?.to_string();
        let url = asset.get("browser_download_url")?.as_str()?.to_string();
        let size = asset.get("size").and_then(Value::as_u64).unwrap_or(0);
        Some((name, url, size))
    };

    match os {
        "windows" => {
            let is_exe = |name: &str| name.to_ascii_lowercase().ends_with(".exe");
            let is_setup = |name: &str| {
                let lower = name.to_ascii_lowercase();
                lower.ends_with("-setup.exe") || lower.ends_with("_setup.exe")
            };

            assets
                .iter()
                .filter_map(named)
                .find(|(name, ..)| is_setup(name))
                .or_else(|| assets.iter().filter_map(named).find(|(name, ..)| is_exe(name)))
        }
        "macos" => assets
            .iter()
            .filter_map(named)
            .find(|(name, ..)| name.to_ascii_lowercase().ends_with(".dmg")),
        _ => None,
    }
}

/// 安装包落盘位置。放临时目录而不是安装目录：安装目录下正跑着本程序。
fn download_dir() -> PathBuf {
    std::env::temp_dir().join("spoor-update")
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 查 GitHub 最新发布。
///
/// **仓库一个 release 都没有时 GitHub 返回 404**，这不是错误，要当作「已是最新」
/// 处理——否则用户在发布第一个版本之前每次点检查更新都会看到一句报错。
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let idle = |current: String| UpdateInfo { current_version: current, ..Default::default() };

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(RELEASES_API)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] check_for_update network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        // 仓库还没发过版
        return Ok(idle(current));
    }
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let preview: String = text.chars().take(400).collect();
        eprintln!("[Spoor] check_for_update HTTP {status} body_preview={preview}");
        return Err(format!("HTTP {status}"));
    }

    let release: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let latest = release
        .get("tag_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim_start_matches(['v', 'V'])
        .to_string();
    if latest.is_empty() {
        return Ok(idle(current));
    }

    let empty = Vec::new();
    let assets = release.get("assets").and_then(Value::as_array).unwrap_or(&empty);
    let Some((asset_name, download_url, asset_size)) = pick_installer_asset(assets) else {
        // 有 tag 但没有本平台的安装包（比如只传了源码包，或某平台的构建漏了）。
        // 新版本确实存在时要如实报「无适配安装包」——安静回「已是最新」的话，
        // 这个平台的用户会永远等不到更新提示，还以为自己一直在最新版上。
        eprintln!(
            "[Spoor] check_for_update: release {latest} has no installer asset for {}",
            std::env::consts::OS
        );
        if compare_versions(&latest, &current) == Ordering::Greater {
            return Err("no_installer_for_platform".into());
        }
        return Ok(UpdateInfo { latest_version: latest, ..idle(current) });
    };

    Ok(UpdateInfo {
        available: compare_versions(&latest, &current) == Ordering::Greater,
        current_version: current,
        latest_version: latest,
        notes: release
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        asset_name,
        asset_size,
        download_url,
        release_url: release
            .get("html_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

/// 流式下载安装包，返回落盘的绝对路径。
///
/// 边下边 emit `update-download-progress`：安装包几十 MB，没有进度条的话
/// 用户会以为卡死了。`total` 优先用响应头，没有再退回 release 里报的大小。
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    asset_name: String,
    expected_size: u64,
) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only https:// downloads are allowed".into());
    }
    // 文件名直接来自 GitHub，落盘前掐掉路径分隔符，避免写到目录外面去
    let safe_name = asset_name
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(if cfg!(target_os = "macos") { "spoor-update.dmg" } else { "spoor-setup.exe" });

    let dir = download_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(safe_name);

    // 只设连接超时，不设总超时：安装包几十 MB，慢网络上会被总超时误杀；
    // 下载卡死与否由进度事件反映，用户看得见，可以自己关掉重来
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] download_update network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    if !status.is_success() {
        eprintln!("[Spoor] download_update HTTP {status} url={url}");
        return Err(format!("HTTP {status}"));
    }

    let total = response.content_length().unwrap_or(expected_size);
    let mut received: u64 = 0;
    let mut buffer = Vec::with_capacity(total.min(64 * 1024 * 1024) as usize);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        buffer.extend_from_slice(&chunk);
        let _ = app.emit(
            "update-download-progress",
            serde_json::json!({ "received": received, "total": total }),
        );
    }

    std::fs::write(&dest, &buffer).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// 拉起安装包。返回值告诉前端接下来会发生什么：
///
/// - `"exit"`（Windows）：NSIS 覆盖安装要改的正是当前正在运行的 exe，进程不退出
///   就会被文件占用挡住，所以拉起后**立即退出本进程**——前端大概率收不到这个返回值。
///   安装程序是 `ShellExecute` 起的独立进程，不受我们退出影响。
/// - `"manual"`（macOS）：dmg 打开后要用户自己把 app 拖进「应用程序」，这里**不退出**——
///   退了用户面对一个空桌面不知道下一步该干嘛。前端据此提示手动安装。
#[tauri::command]
pub fn install_update(app: AppHandle, path: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    // 只允许运行我们自己刚下下来的那个文件
    if !target.starts_with(download_dir()) {
        return Err("Refusing to run an installer outside the update directory".into());
    }
    if !target.is_file() {
        return Err("Installer not found".into());
    }

    open::that(&target).map_err(|e| e.to_string())?;
    if cfg!(target_os = "macos") {
        return Ok("manual".into());
    }
    app.exit(0);
    Ok("exit".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── 版本比较 ──

    #[test]
    fn compares_by_numeric_segments() {
        assert_eq!(compare_versions("0.2.0", "0.1.0"), Ordering::Greater);
        assert_eq!(compare_versions("0.1.0", "0.2.0"), Ordering::Less);
        assert_eq!(compare_versions("0.2.0", "0.2.0"), Ordering::Equal);
    }

    #[test]
    fn ignores_the_v_prefix() {
        // GitHub 的 tag 是 v0.2.0，package_info 给的是 0.2.0
        assert_eq!(compare_versions("v0.2.0", "0.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("V0.3.0", "0.2.0"), Ordering::Greater);
    }

    #[test]
    fn pads_missing_segments_with_zero() {
        assert_eq!(compare_versions("0.2", "0.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.2.1", "0.2"), Ordering::Greater);
        assert_eq!(compare_versions("1", "0.9.9"), Ordering::Greater);
    }

    #[test]
    fn compares_numerically_not_lexically() {
        // 字符串比较会说 "0.10" < "0.9"
        assert_eq!(compare_versions("0.10.0", "0.9.0"), Ordering::Greater);
    }

    #[test]
    fn treats_prerelease_suffix_as_the_base_version() {
        // 宁可把 rc 当成正式版（不提示更新），也别把它当成更大的版本推给用户
        assert_eq!(compare_versions("0.2.0-rc1", "0.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.2.0-rc1", "0.1.0"), Ordering::Greater);
    }

    #[test]
    fn garbage_versions_do_not_panic() {
        assert_eq!(compare_versions("", ""), Ordering::Equal);
        assert_eq!(compare_versions("abc", "0.0.0"), Ordering::Equal);
    }

    // ── 资产挑选 ──

    fn asset(name: &str, size: u64) -> Value {
        json!({
            "name": name,
            "size": size,
            "browser_download_url": format!("https://github.com/x/releases/download/v1/{name}"),
        })
    }

    #[test]
    fn windows_prefers_the_nsis_setup_exe() {
        let assets = vec![
            asset("Spoor_0.2.0_x64_en-US.msi", 1),
            asset("Spoor_0.2.0_x64-setup.exe", 42),
        ];
        let (name, url, size) = pick_installer_asset_for("windows", &assets).unwrap();
        assert_eq!(name, "Spoor_0.2.0_x64-setup.exe");
        assert_eq!(size, 42);
        assert!(url.ends_with("Spoor_0.2.0_x64-setup.exe"));
    }

    #[test]
    fn windows_falls_back_to_any_exe() {
        let assets = vec![asset("Spoor-portable.exe", 7)];
        assert_eq!(
            pick_installer_asset_for("windows", &assets).unwrap().0,
            "Spoor-portable.exe"
        );
    }

    #[test]
    fn macos_picks_the_dmg_not_the_exe() {
        // 曾经的缺陷：macOS 也会挑到 setup.exe，下载后 install_update 还顺手把应用退掉
        let assets = vec![
            asset("Spoor_0.3.1_x64-setup.exe", 1),
            asset("Spoor_0.3.1_universal.dmg", 42),
        ];
        assert_eq!(
            pick_installer_asset_for("macos", &assets).unwrap().0,
            "Spoor_0.3.1_universal.dmg"
        );
        // 反过来 Windows 也不该挑到 dmg
        assert_eq!(
            pick_installer_asset_for("windows", &assets).unwrap().0,
            "Spoor_0.3.1_x64-setup.exe"
        );
    }

    #[test]
    fn macos_without_dmg_yields_nothing() {
        // 只传了 exe 的 release 对 macOS 就是「无适配安装包」，不能退回 exe
        let assets = vec![asset("Spoor_0.3.1_x64-setup.exe", 1)];
        assert!(pick_installer_asset_for("macos", &assets).is_none());
    }

    #[test]
    fn unknown_platform_yields_nothing() {
        let assets = vec![asset("Spoor_0.3.1_x64-setup.exe", 1), asset("Spoor.dmg", 2)];
        assert!(pick_installer_asset_for("linux", &assets).is_none());
    }

    #[test]
    fn ignores_signatures_and_source_archives() {
        // 只传了 .sig / 源码包时不能挑出东西来，否则用户会双击到一个 zip
        let assets = vec![
            asset("Spoor_0.2.0_x64-setup.exe.sig", 1),
            asset("Source code (zip)", 2),
        ];
        assert!(pick_installer_asset_for("windows", &assets).is_none());
        assert!(pick_installer_asset_for("macos", &assets).is_none());
    }

    #[test]
    fn empty_asset_list_yields_nothing() {
        assert!(pick_installer_asset_for("windows", &[]).is_none());
        assert!(pick_installer_asset_for("macos", &[]).is_none());
    }

    #[test]
    fn malformed_assets_are_skipped_not_fatal() {
        let assets = vec![json!({ "name": "no-url-setup.exe" }), asset("ok-setup.exe", 3)];
        assert_eq!(pick_installer_asset_for("windows", &assets).unwrap().0, "ok-setup.exe");
    }
}
