//! 本地推理引擎（llama-server）的查找 / 状态上报 / CUDA 加速包下载安装。
//!
//! 「引擎」指 llama.cpp 预编译包里的 `llama-server(.exe)`——0.6.0 起本地推理
//! 从一次性子进程升级为常驻 server（见 docs/dev/ROADMAP_v0.6.0.md 主线 A），
//! 本模块只管「exe 在哪、什么后端、CUDA 包怎么装」，进程生死归
//! [`crate::llama_server`]。
//!
//! 查找顺序（返回首个存在的）：
//! 1. 环境变量 `LLAMA_SERVER_PATH`（开发/排障用的最高优先级开关）；
//! 2. `<SpoorData>/llama/cuda/llama-server.exe` —— CUDA 加速包的安装位置，
//!    装了就优先于随包的 CPU 版；
//! 3. 随包资源 `resource_dir()/llama/`（Windows 平铺；macOS 按架构分
//!    `arm64/` 与 `x64/` 子目录，CI 打包脚本按此布局放置）；
//! 4. 旧版兼容位置（沿用 local_llama.rs 时代的候选目录，但找的是 server）。

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: 不在 GUI 应用中弹出黑色控制台窗口（CREATE_NO_WINDOW）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 钉死的 llama.cpp 发布版本。与 CI（release-desktop.yml 的 `LLAMA_RELEASE`）
/// 及开发脚本 `scripts/fetch-llama-engine.ps1` 三处保持一致；
/// 升级引擎版本要连同下方 sha256 常量一起换，并单独跑回归（路线图的风险条款）。
pub const LLAMA_RELEASE: &str = "b8763";

/// 两个 CUDA 包的 sha256（小写 hex）。
///
/// 值取自 GitHub Releases API 对这两个 asset 报告的 `digest` 字段
/// （`GET repos/ggml-org/llama.cpp/releases/tags/b8763`，GitHub 服务端对
/// 实际文件计算）。升级 [`LLAMA_RELEASE`] 时必须重新取值；
/// 留 `None` 表示跳过校验（不推荐）。
const LLAMA_CUDA_ZIP_SHA256: Option<&str> =
    Some("c6a3a74aef08c423f76d4653e957bd44d6d039c8c59b4ca07a111031d2d7217a");
const CUDART_ZIP_SHA256: Option<&str> =
    Some("8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6");

/// 引擎可执行文件名（按平台带不带 `.exe`）。
pub fn server_exe_name() -> &'static str {
    if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}

/// CUDA 加速包的安装目录：`<SpoorData>/llama/cuda/`。
///
/// 放数据根而不是安装目录：安装目录在 Program Files 下没有写权限，
/// 数据根迁移时这份缓存跟着走也合理（media::data_root 是运行时解析的）。
pub fn cuda_dir() -> PathBuf {
    crate::media::data_root().join("llama").join("cuda")
}

/// 按优先级列出所有候选路径。真正的存在性检查在 [`find_in_candidates`]。
fn candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let exe = server_exe_name();
    let mut out: Vec<PathBuf> = Vec::new();

    // 1) 环境变量：显式指定永远最优先
    if let Ok(env_path) = std::env::var("LLAMA_SERVER_PATH") {
        let trimmed = env_path.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
        }
    }

    // 2) CUDA 加速包安装位置
    out.push(cuda_dir().join(exe));

    // 3) 随包资源
    if let Ok(resource_dir) = app.path().resource_dir() {
        let base = resource_dir.join("llama");
        if cfg!(target_os = "macos") {
            // 通用 dmg 里按架构分目录；ARCH 在 Apple Silicon 上是 aarch64
            let arch_dir = if std::env::consts::ARCH == "aarch64" { "arm64" } else { "x64" };
            out.push(base.join(arch_dir).join(exe));
        } else {
            out.push(base.join(exe));
        }
    }

    // 4) 旧版兼容位置（local_llama.rs 时代的候选目录，找的换成 server）
    if let Ok(current_exe) = std::env::current_exe() {
        let exe_dir = current_exe
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        out.push(exe_dir.join(exe));
        out.push(exe_dir.join("llama-binaries").join(exe));
        out.push(exe_dir.join("bin").join(exe));
    }
    out.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../llama-binaries")
            .join(exe),
    );
    // 开发机的本地 CUDA 工具目录只进 debug 构建，发行版不背这个死路径
    #[cfg(debug_assertions)]
    out.push(PathBuf::from(r"D:\Tools\llama-cuda").join(exe));

    out
}

/// 返回候选列表里第一个真实存在的文件。拆成纯函数便于单测查找顺序。
pub fn find_in_candidates(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// 查找引擎。找不到返回 `None`，错误话术留给调用方（设置区/ensure 各说各的）。
pub fn find_server(app: &AppHandle) -> Option<PathBuf> {
    find_in_candidates(&candidate_paths(app))
}

/// 判定引擎后端。`os` 拆成参数是为了单测能覆盖 macOS 分支（同 updater 的做法）。
///
/// - macOS 预编译包默认带 Metal → 'metal'；
/// - 路径在 CUDA 安装目录下，或同目录能看到 ggml-cuda.dll（用户手工放的
///   CUDA 包，如 LLAMA_SERVER_PATH 指过去的）→ 'cuda'；
/// - 其余 → 'cpu'。
pub fn detect_backend_for(os: &str, server_path: &Path, cuda_install_dir: &Path) -> &'static str {
    if os == "macos" {
        return "metal";
    }
    if server_path.starts_with(cuda_install_dir) {
        return "cuda";
    }
    let has_cuda_dll = server_path
        .parent()
        .is_some_and(|dir| dir.join("ggml-cuda.dll").is_file());
    if has_cuda_dll { "cuda" } else { "cpu" }
}

/// [`detect_backend_for`] 的当前平台版。
pub fn detect_backend(server_path: &Path, cuda_install_dir: &Path) -> &'static str {
    detect_backend_for(std::env::consts::OS, server_path, cuda_install_dir)
}

// ───────────────────────────── 状态命令 ─────────────────────────────

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// 找到了可用的 llama-server
    pub installed: bool,
    /// 'cpu' | 'cuda' | 'metal'；未安装时为 None
    pub backend: Option<String>,
    /// 命中的引擎绝对路径
    pub path: Option<String>,
    /// 首选 GPU 是 NVIDIA（决定要不要给用户推 CUDA 加速包）
    pub nvidia_detected: bool,
    /// CUDA 加速包已装到 `<SpoorData>/llama/cuda/`
    pub cuda_installed: bool,
}

/// 设置区「本地推理引擎」区块的数据源。
#[tauri::command]
pub fn local_engine_status(app: AppHandle) -> EngineStatus {
    let cuda = cuda_dir();
    let found = find_server(&app);
    // probe() 内部有缓存（hardware.rs），这里读一次不重复扫硬件
    let nvidia_detected = crate::hardware::probe()
        .gpus
        .first()
        .is_some_and(|gpu| gpu.vendor == "nvidia");

    EngineStatus {
        installed: found.is_some(),
        backend: found
            .as_deref()
            .map(|p| detect_backend(p, &cuda).to_string()),
        path: found.map(|p| p.to_string_lossy().into_owned()),
        nvidia_detected,
        cuda_installed: cuda.join(server_exe_name()).is_file(),
    }
}

// ───────────────────────────── CUDA 包下载安装 ─────────────────────────────

/// 进度事件载荷。`phase`: 'llama'（主包）| 'cudart'（CUDA 运行时）| 'extract'。
#[derive(Serialize, Clone)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    phase: &'static str,
}

fn emit_progress(app: &AppHandle, downloaded: u64, total: u64, phase: &'static str) {
    let _ = app.emit(
        "llama-engine-download-progress",
        DownloadProgress { downloaded, total, phase },
    );
}

/// 流式下载到 `dest`，边下边发进度事件。
///
/// 同 [`crate::updater::download_update`] 的口径：只设连接超时不设总超时——
/// 主包 240MB+、cudart 390MB+，慢网络会被总超时误杀；卡死与否进度条看得见。
async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    phase: &'static str,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let response = client
        .get(url)
        .header("User-Agent", "Spoor-Engine-Installer")
        .send()
        .await
        .map_err(|e| format!("download_failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("download_failed: HTTP {status} ({url})"));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest).map_err(|e| format!("disk_write_failed: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    // 别每个 chunk 都跨 IPC 发一次事件：几百 MB 的包 chunk 数以万计，
    // 每 512KB 报一次进度条已经足够顺滑
    let mut last_emitted: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download_failed: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("disk_write_failed: {e}"))?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emitted >= 512 * 1024 || downloaded == total {
            emit_progress(app, downloaded, total, phase);
            last_emitted = downloaded;
        }
    }
    emit_progress(app, downloaded, total.max(downloaded), phase);
    Ok(())
}

/// 从 `certutil -hashfile <file> SHA256` 的输出里抠出 64 位 hex。
///
/// 典型输出三行：标题、hash（老版 Windows 的 hash 行带空格分隔）、"CertUtil: ..."。
/// 逐行找「去掉空格后恰好 64 个 hex 字符」的那行，不依赖行号。
pub fn parse_certutil_output(output: &str) -> Option<String> {
    for line in output.lines() {
        let compact: String = line
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_ascii_lowercase();
        if compact.len() == 64 && compact.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(compact);
        }
    }
    None
}

/// 用系统 certutil 算文件 sha256（Windows 自带，免引 sha2 依赖）。
fn certutil_sha256(path: &Path) -> Result<String, String> {
    let mut cmd = Command::new("certutil");
    cmd.arg("-hashfile").arg(path).arg("SHA256");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("certutil_failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "certutil_failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    parse_certutil_output(&String::from_utf8_lossy(&out.stdout))
        .ok_or_else(|| "certutil_failed: no hash in output".into())
}

/// 校验下载文件的 sha256。常量为 `None` 时跳过（升级版本忘了钉新值的兜底）。
fn verify_sha256(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected else { return Ok(()) };
    let actual = certutil_sha256(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "sha256_mismatch: {} 期望 {expected} 实际 {actual}",
            path.display()
        ))
    }
}

/// 用 PowerShell 解压（Windows 自带 Expand-Archive，免引 zip 依赖）。
fn expand_archive(zip: &Path, dest: &Path) -> Result<(), String> {
    // 单引号字符串里单引号翻倍即转义；路径来自我们自己拼的临时目录/数据根，
    // 这只是防御性处理
    let script = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        zip.to_string_lossy().replace('\'', "''"),
        dest.to_string_lossy().replace('\'', "''"),
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("extract_failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "extract_failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

/// 解压后若 exe 落在了子目录（上游 zip 布局偶有变化），把那层目录的文件全部
/// 提到 `dir` 顶层——查找与 DLL 加载都按「exe 和 dll 同层」假设。
fn flatten_extracted(dir: &Path) -> Result<(), String> {
    let exe = server_exe_name();
    if dir.join(exe).is_file() {
        return Ok(());
    }
    let found = find_file_recursive(dir, exe)
        .ok_or_else(|| format!("extract_failed: 包里找不到 {exe}"))?;
    let src_dir = found
        .parent()
        .ok_or_else(|| "extract_failed: bad layout".to_string())?
        .to_path_buf();
    for entry in std::fs::read_dir(&src_dir).map_err(|e| format!("extract_failed: {e}"))? {
        let entry = entry.map_err(|e| format!("extract_failed: {e}"))?;
        let target = dir.join(entry.file_name());
        std::fs::rename(entry.path(), target).map_err(|e| format!("extract_failed: {e}"))?;
    }
    Ok(())
}

fn find_file_recursive(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
            return Some(path);
        }
        if path.is_dir() {
            subdirs.push(path);
        }
    }
    subdirs.iter().find_map(|d| find_file_recursive(d, name))
}

/// 下载并安装 CUDA 加速包到 `<SpoorData>/llama/cuda/`。
///
/// 两个 zip：主包（llama-server + CUDA 后端 dll）与 cudart（CUDA 运行时 dll，
/// 用户没装 CUDA Toolkit 也能跑）。失败时清掉半成品目录——宁可回到「未安装」，
/// 也别留一个缺 dll 的目录被查找逻辑当成可用引擎。
#[tauri::command]
pub async fn local_engine_install_cuda(app: AppHandle) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("windows_only".into());
    }

    let result = install_cuda_inner(&app).await;
    if result.is_err() {
        // 半成品目录会被 find_server 误认成可用引擎，必须清掉
        let _ = std::fs::remove_dir_all(cuda_dir());
    }
    result
}

async fn install_cuda_inner(app: &AppHandle) -> Result<(), String> {
    let ver = LLAMA_RELEASE;
    let base = format!("https://github.com/ggml-org/llama.cpp/releases/download/{ver}");
    let llama_url = format!("{base}/llama-{ver}-bin-win-cuda-12.4-x64.zip");
    let cudart_url = format!("{base}/cudart-llama-bin-win-cuda-12.4-x64.zip");

    let tmp = std::env::temp_dir().join("spoor-llama-cuda");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("disk_write_failed: {e}"))?;
    let llama_zip = tmp.join(format!("llama-{ver}-cuda.zip"));
    let cudart_zip = tmp.join(format!("cudart-{ver}.zip"));

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let outcome = async {
        download_file(app, &client, &llama_url, &llama_zip, "llama").await?;
        verify_sha256(&llama_zip, LLAMA_CUDA_ZIP_SHA256)?;
        download_file(app, &client, &cudart_url, &cudart_zip, "cudart").await?;
        verify_sha256(&cudart_zip, CUDART_ZIP_SHA256)?;

        emit_progress(app, 0, 0, "extract");
        let dest = cuda_dir();
        std::fs::create_dir_all(&dest).map_err(|e| format!("disk_write_failed: {e}"))?;
        // 解压是同步重活，别占 async 线程
        let (zip1, zip2, dest2) = (llama_zip.clone(), cudart_zip.clone(), dest.clone());
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            expand_archive(&zip1, &dest2)?;
            expand_archive(&zip2, &dest2)?;
            flatten_extracted(&dest2)
        })
        .await
        .map_err(|e| format!("extract_failed: {e}"))??;

        if !dest.join(server_exe_name()).is_file() {
            return Err("extract_failed: 解压后未见 llama-server.exe".into());
        }
        Ok(())
    }
    .await;

    // 成败都清临时 zip：640MB 不该留在 %TEMP%
    let _ = std::fs::remove_file(&llama_zip);
    let _ = std::fs::remove_file(&cudart_zip);
    outcome
}

// ============================================================================
//                                  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spoor-engine-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── 查找顺序 ──

    #[test]
    fn find_returns_first_existing_candidate() {
        let dir = temp_dir("order");
        let first = dir.join("a").join("llama-server.exe");
        let second = dir.join("b").join("llama-server.exe");
        std::fs::create_dir_all(first.parent().unwrap()).unwrap();
        std::fs::create_dir_all(second.parent().unwrap()).unwrap();
        std::fs::write(&first, b"fake").unwrap();
        std::fs::write(&second, b"fake").unwrap();

        // 两个都存在 → 取列表里靠前的
        let found = find_in_candidates(&[first.clone(), second.clone()]).unwrap();
        assert_eq!(found, first);

        // 第一个不存在 → 落到第二个
        std::fs::remove_file(&first).unwrap();
        let found = find_in_candidates(&[first.clone(), second.clone()]).unwrap();
        assert_eq!(found, second);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn find_skips_nonexistent_and_directories() {
        let dir = temp_dir("skip");
        // 目录不算：候选必须是文件
        let as_dir = dir.join("llama-server.exe");
        std::fs::create_dir_all(&as_dir).unwrap();
        let missing = dir.join("nope").join("llama-server.exe");
        assert!(find_in_candidates(&[as_dir, missing]).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn find_on_empty_list_is_none() {
        assert!(find_in_candidates(&[]).is_none());
    }

    // ── 后端判定 ──

    #[test]
    fn backend_is_metal_on_macos_regardless_of_path() {
        let cuda = PathBuf::from(r"D:\Data\llama\cuda");
        assert_eq!(
            detect_backend_for("macos", Path::new("/Applications/x/llama-server"), &cuda),
            "metal"
        );
    }

    #[test]
    fn backend_is_cuda_when_under_cuda_install_dir() {
        let dir = temp_dir("cuda-dir");
        let cuda = dir.join("cuda");
        let exe = cuda.join("llama-server.exe");
        // 不需要文件真的存在：路径前缀已经说明来源
        assert_eq!(detect_backend_for("windows", &exe, &cuda), "cuda");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backend_is_cuda_when_sibling_ggml_cuda_dll_exists() {
        let dir = temp_dir("cuda-dll");
        let exe = dir.join("llama-server.exe");
        std::fs::write(&exe, b"fake").unwrap();
        std::fs::write(dir.join("ggml-cuda.dll"), b"fake").unwrap();
        let unrelated_cuda_dir = temp_dir("elsewhere");
        assert_eq!(detect_backend_for("windows", &exe, &unrelated_cuda_dir), "cuda");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&unrelated_cuda_dir).ok();
    }

    #[test]
    fn backend_falls_back_to_cpu() {
        let dir = temp_dir("cpu");
        let exe = dir.join("llama-server.exe");
        std::fs::write(&exe, b"fake").unwrap();
        let cuda = temp_dir("cpu-cuda");
        assert_eq!(detect_backend_for("windows", &exe, &cuda), "cpu");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&cuda).ok();
    }

    // ── certutil 输出解析 ──

    #[test]
    fn parses_modern_certutil_output() {
        let out = "SHA256 hash of C:\\x.zip:\nc6a3a74aef08c423f76d4653e957bd44d6d039c8c59b4ca07a111031d2d7217a\nCertUtil: -hashfile command completed successfully.\n";
        assert_eq!(
            parse_certutil_output(out).unwrap(),
            "c6a3a74aef08c423f76d4653e957bd44d6d039c8c59b4ca07a111031d2d7217a"
        );
    }

    #[test]
    fn parses_legacy_space_separated_certutil_output() {
        // 老版 Windows 的 certutil 每两个 hex 字符之间有空格
        let out = "SHA256 hash of file x.zip:\nc6 a3 a7 4a ef 08 c4 23 f7 6d 46 53 e9 57 bd 44 d6 d0 39 c8 c5 9b 4c a0 7a 11 10 31 d2 d7 21 7a\nCertUtil: done.\n";
        assert_eq!(
            parse_certutil_output(out).unwrap(),
            "c6a3a74aef08c423f76d4653e957bd44d6d039c8c59b4ca07a111031d2d7217a"
        );
    }

    #[test]
    fn certutil_parse_rejects_garbage() {
        assert!(parse_certutil_output("").is_none());
        assert!(parse_certutil_output("CertUtil: error 0x80070002").is_none());
        // 63 个 hex 不算
        let short = "a".repeat(63);
        assert!(parse_certutil_output(&short).is_none());
        // 64 个但含非 hex 不算
        let bad = format!("{}g", "a".repeat(63));
        assert!(parse_certutil_output(&bad).is_none());
    }

    #[test]
    fn certutil_parse_uppercases_are_normalized() {
        let upper = "C6A3A74AEF08C423F76D4653E957BD44D6D039C8C59B4CA07A111031D2D7217A";
        assert_eq!(parse_certutil_output(upper).unwrap(), upper.to_ascii_lowercase());
    }

    // ── 解压布局修正 ──

    #[test]
    fn flatten_moves_nested_layout_to_top_level() {
        let dir = temp_dir("flatten");
        let nested = dir.join("build").join("bin");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join(server_exe_name()), b"exe").unwrap();
        std::fs::write(nested.join("ggml-cuda.dll"), b"dll").unwrap();

        flatten_extracted(&dir).unwrap();
        assert!(dir.join(server_exe_name()).is_file());
        assert!(dir.join("ggml-cuda.dll").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn flatten_is_noop_when_already_flat() {
        let dir = temp_dir("flat");
        std::fs::write(dir.join(server_exe_name()), b"exe").unwrap();
        flatten_extracted(&dir).unwrap();
        assert!(dir.join(server_exe_name()).is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn flatten_errors_when_exe_absent() {
        let dir = temp_dir("no-exe");
        std::fs::write(dir.join("random.dll"), b"x").unwrap();
        assert!(flatten_extracted(&dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── 版本常量与 CI/脚本一致 ──

    #[test]
    fn release_constant_matches_ci_and_script() {
        // release-desktop.yml 与 scripts/fetch-llama-engine.ps1 里钉的都是 b8763；
        // 三处不一致等于 CI 随包、开发机、应用内下载装的不是同一个引擎
        assert_eq!(LLAMA_RELEASE, "b8763");
    }
}
