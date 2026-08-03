//! llama-server 生命周期管理：按需启动 + 空闲整体退出（ROADMAP v0.6.0 主线 A4）。
//!
//! 策略要点：
//! - **应用启动从不预热**。前端第一次要用本地模型时调 [`local_server_ensure`]，
//!   参数指纹（模型 + ngl + ctx + threads）相同就复用，变了就停旧起新；
//! - **空闲整体退出**：`keepAliveMinutes` 有值时看门狗每 30s 检查一次
//!   `last_touch`，超时把整个进程杀掉，内存/显存完全归还。`None` 表示会话期
//!   常驻（应用退出时清理），`0` 表示用后即退（由前端在拿到回答后调 stop）；
//! - **不复刻旧 bug**：local_llama.rs 那个 detach 掉的 300 秒 taskkill 线程不要了
//!   ——这里 kill 后立刻 wait 收尸；孤儿清理靠 pid 文件 + 进程名校验，
//!   不裸杀 PID（防 PID 复用误杀无辜进程）。
//!
//! server 的 stdout/stderr 追加写到 `%TEMP%/spoor_llama_server.log`（与
//! local_llama.rs 的 spoor_llama.log 同一惯例），启动失败时取日志尾部报错，
//! 并识别 OOM 让前端降 `-ngl` 重试。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: 不弹黑色控制台窗口（CREATE_NO_WINDOW）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 健康检查轮询间隔与上限。上限 120s 是给大模型留的：几十 GB 的权重从
/// 机械盘冷加载真的会用满两分钟。
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(120);

/// 看门狗巡检间隔。
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(30);

/// 日志保留上限，同 local_llama.rs 的口径：超了截断重写，别无限膨胀。
const LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 报错时取的日志尾部字节数。
const LOG_TAIL_BYTES: usize = 4000;

// ───────────────────────────── 全局状态 ─────────────────────────────

struct RunningServer {
    child: Child,
    port: u16,
    model_path: String,
    params_fingerprint: String,
    /// 'cpu' | 'cuda' | 'metal'，spawn 时由 engine.rs 判定后存下
    backend: String,
    last_touch: Instant,
    /// `None` = 会话期常驻（看门狗不管，应用退出清理）
    keep_alive: Option<Duration>,
}

static SERVER: Mutex<Option<RunningServer>> = Mutex::new(None);

/// ensure 全程（含 await 的健康轮询）要互斥：两个并发 ensure 各起一个 server
/// 会漏掉一个成为孤儿。std Mutex 不能跨 await 持有，所以另备一把 tokio 锁。
static ENSURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ───────────────────────────── 纯函数（可单测） ─────────────────────────────

/// 启动参数指纹。四元组任一变化都要求重启 server（模型/显存布局/上下文都焊死在
/// 进程启动参数里，改不了只能重开）。
pub fn fingerprint(model_path: &str, n_gpu_layers: i64, n_ctx: u64, n_threads: u32) -> String {
    format!("{}|ngl={n_gpu_layers}|ctx={n_ctx}|t={n_threads}", model_path.trim())
}

/// 日志尾部是否像显存/内存耗尽。命中时 ensure 返回 `Err("oom")`，
/// 前端据此降 `-ngl` 重试而不是把一屏日志甩给用户。
pub fn looks_like_oom(log_tail: &str) -> bool {
    let lowered = log_tail.to_ascii_lowercase();
    ["out of memory", "cudamalloc", "failed to allocate"]
        .iter()
        .any(|needle| lowered.contains(needle))
}

/// 前端没显式配置时的默认保留时长（分钟）。
const DEFAULT_KEEP_ALIVE_MINUTES: i64 = 15;

/// `keepAliveMinutes` → 看门狗超时。与前端（services/ai.ts）对齐的编码：
/// - 字段缺省（None）= 用户没配置 → **默认 15 分钟**；
/// - `-1` = 会话期常驻，看门狗不出手；
/// - `0` = 用后即退（由前端主动 stop），看门狗同样不出手——
///   否则 30 秒巡检会把刚起的进程误杀；
/// - `N > 0` = 空闲 N 分钟后整体退出。
pub fn keep_alive_from(minutes: Option<i64>) -> Option<Duration> {
    let m = minutes.unwrap_or(DEFAULT_KEEP_ALIVE_MINUTES);
    if m > 0 {
        Some(Duration::from_secs(m as u64 * 60))
    } else {
        None
    }
}

/// 决定传给引擎的 `-m` 参数与子进程工作目录。
///
/// Windows 下 llama-server 是 C 程序：CRT 按系统 ANSI 代码页解码 argv，
/// 而 llama.cpp 打开文件时把参数当 UTF-8 转宽字符——非 ASCII 路径两头对不上，
/// 文件明明在却报 "No such file or directory"（中文目录名必中）。
/// 规避：路径含非 ASCII 且**文件名**是纯 ASCII 时，把工作目录切到模型所在
/// 目录、只传文件名——fopen 的相对路径由进程 CWD 解析，不经 argv 编码转换。
/// 文件名本身含非 ASCII 时无法经 argv 传达，明确报错让用户改名，
/// 好过让子进程启动失败后甩一屏日志。
pub fn model_spawn_plan_for(
    windows: bool,
    model: &Path,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let full = model.to_string_lossy();
    if !windows || full.is_ascii() {
        return Ok((model.to_path_buf(), None));
    }
    let file_name = model
        .file_name()
        .ok_or_else(|| format!("model_not_found: {}", model.display()))?;
    if file_name.to_string_lossy().is_ascii() {
        let parent = model
            .parent()
            .ok_or_else(|| format!("model_not_found: {}", model.display()))?;
        return Ok((PathBuf::from(file_name), Some(parent.to_path_buf())));
    }
    Err(format!(
        "model_filename_nonascii: 模型文件名含非 ASCII 字符，Windows 下无法传给 llama-server；\
         请把文件重命名为英文/数字后重新选择: {}",
        file_name.to_string_lossy()
    ))
}

/// 向系统要一个空闲端口：bind 127.0.0.1:0 拿到分配的端口后立刻释放。
/// 理论上存在「释放到 server bind 之间被抢」的窗口，实践中本机端口充裕，
/// 真撞上了 ensure 会因健康检查失败而报错，用户重试即可。
pub fn pick_free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("port_alloc_failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("port_alloc_failed: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// pid 文件读写。路径作参数传入便于单测（真实路径见 [`pid_file_path`]）。
pub fn write_pid_file(path: &Path, pid: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("pid_write_failed: {e}"))?;
    }
    std::fs::write(path, pid.to_string()).map_err(|e| format!("pid_write_failed: {e}"))
}

pub fn read_pid_file(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// tasklist CSV 输出里是不是 llama-server。拆成纯函数测进程名校验逻辑。
pub fn tasklist_says_llama_server(output: &str) -> bool {
    output.to_ascii_lowercase().contains("llama-server")
}

// ───────────────────────────── 内部工具 ─────────────────────────────

/// server 日志：`%TEMP%/spoor_llama_server.log`。
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("spoor_llama_server.log")
}

/// pid 文件：`<SpoorData>/llama/server.pid`。**只能在数据根初始化后调用**
/// （所有调用点都在 setup 之后：命令、看门狗、RunEvent::Exit）。
fn pid_file_path() -> PathBuf {
    crate::media::data_root().join("llama").join("server.pid")
}

/// 读日志尾部（按 UTF-8 char boundary 对齐）。
fn read_log_tail() -> String {
    let Ok(bytes) = std::fs::read(log_path()) else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&bytes);
    let mut start = text.len().saturating_sub(LOG_TAIL_BYTES);
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

/// 打开日志文件用于子进程输出重定向；过大先截断。
fn open_log_file() -> Result<std::fs::File, String> {
    let path = log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path)
        .map_err(|e| format!("log_open_failed: {e}"))
}

/// 杀掉并回收当前 server（如有），顺带删 pid 文件。
///
/// kill 后必须 wait：不收尸的话 Windows 上句柄不释放，进程表里留僵尸。
pub fn stop_running() {
    let taken = SERVER.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut server) = taken {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    let _ = std::fs::remove_file(pid_file_path());
}

/// 应用启动时清理上一次异常退出留下的孤儿 server。
///
/// 只有「pid 文件在 && 该 PID 的进程名确实是 llama-server」才杀——
/// PID 会被系统复用，裸杀 pid 文件里的数字可能误杀无辜进程（旧代码之鉴）。
pub fn cleanup_orphan() {
    let pid_path = pid_file_path();
    let Some(pid) = read_pid_file(&pid_path) else {
        return;
    };
    if process_is_llama_server(pid) {
        kill_pid(pid);
    }
    let _ = std::fs::remove_file(&pid_path);
}

#[cfg(windows)]
fn process_is_llama_server(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(out) => tasklist_says_llama_server(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn process_is_llama_server(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output();
    match output {
        Ok(out) => tasklist_says_llama_server(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
}

/// 空闲看门狗，首次 ensure 时拉起一次，之后常驻（空转成本 ≈0）。
fn start_watchdog_once() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        tauri::async_runtime::spawn(async {
            loop {
                tokio::time::sleep(WATCHDOG_INTERVAL).await;
                let expired = SERVER.lock().ok().is_some_and(|guard| {
                    guard.as_ref().is_some_and(|server| {
                        server
                            .keep_alive
                            .is_some_and(|limit| server.last_touch.elapsed() >= limit)
                    })
                });
                if expired {
                    println!("[Spoor] llama-server 空闲超时，整体退出释放内存/显存");
                    stop_running();
                }
            }
        });
    });
}

// ───────────────────────────── 命令 ─────────────────────────────

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnsureParams {
    pub model_path: String,
    pub n_gpu_layers: i64,
    pub n_ctx: u64,
    pub n_threads: u32,
    /// None=会话期常驻；0=用后即退（前端负责 stop）；>0=空闲 N 分钟后退出
    pub keep_alive_minutes: Option<i64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnsureResult {
    pub port: u16,
    /// true = 本次调用（重）启动了进程；false = 复用现成的
    pub restarted: bool,
}

/// 确保有一个参数匹配的 llama-server 在跑，返回它的端口。
///
/// 前端拿到端口后直接对 `http://127.0.0.1:<port>/v1/chat/completions` 发
/// OpenAI 兼容请求（走现有 openai_compatible_chat_stream 通道即可，
/// http://127.0.0.1 在 ensure_key_bearing_url 的放行名单里）。
/// 老用户兼容：`LLAMA_N_GPU_LAYERS` 环境变量仍是最高优先级（0.5.x 时代唯一的
/// 调优旋钮，文档承诺过继续尊重）。设置了就盖过前端传来的自动/手动值。
pub fn resolve_gpu_layers(param: i64, env_value: Option<&str>) -> i64 {
    env_value
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(param)
}

/// 参数按 Tauri 的默认约定平铺接收（前端 `invoke` 传 camelCase 键，逐个映射到
/// snake_case 形参）——不能包成 `params: EnsureParams`，那要求前端多套一层
/// `{ params: {...} }`，两边对不上时 IPC 直接报 missing required key。
#[tauri::command]
pub async fn local_server_ensure(
    app: AppHandle,
    model_path: String,
    n_gpu_layers: i64,
    n_ctx: u64,
    n_threads: u32,
    keep_alive_minutes: Option<i64>,
) -> Result<EnsureResult, String> {
    let mut params = EnsureParams {
        model_path,
        n_gpu_layers,
        n_ctx,
        n_threads,
        keep_alive_minutes,
    };
    let _guard = ENSURE_LOCK.lock().await;
    start_watchdog_once();

    let env_ngl = std::env::var("LLAMA_N_GPU_LAYERS").ok();
    params.n_gpu_layers = resolve_gpu_layers(params.n_gpu_layers, env_ngl.as_deref());

    let fp = fingerprint(
        &params.model_path,
        params.n_gpu_layers,
        params.n_ctx,
        params.n_threads,
    );
    let keep_alive = keep_alive_from(params.keep_alive_minutes);

    // 快路径：参数没变且进程还活着 → touch 完直接复用
    {
        let mut guard = SERVER.lock().map_err(|_| "lock_poisoned".to_string())?;
        if let Some(server) = guard.as_mut() {
            let alive = server.child.try_wait().map(|s| s.is_none()).unwrap_or(false);
            if alive && server.params_fingerprint == fp {
                server.last_touch = Instant::now();
                server.keep_alive = keep_alive;
                return Ok(EnsureResult { port: server.port, restarted: false });
            }
        }
    }

    // 参数变了 / 没在跑 / 已自灭 → 停旧起新
    stop_running();

    let model = PathBuf::from(params.model_path.trim());
    if !model.is_file() {
        return Err(format!("model_not_found: {}", model.display()));
    }

    let engine = crate::engine::find_server(&app).ok_or("engine_not_found")?;
    let backend = crate::engine::detect_backend(&engine, &crate::engine::cuda_dir()).to_string();
    let (model_arg, spawn_cwd) = model_spawn_plan_for(cfg!(windows), &model)?;
    let port = pick_free_port()?;

    let log_file = open_log_file()?;
    {
        use std::io::Write;
        let mut f = log_file.try_clone().map_err(|e| e.to_string())?;
        let _ = writeln!(
            f,
            "\n========== [spawn] engine={} model={} port={port} ngl={} ctx={} threads={} backend={backend} ==========",
            engine.display(),
            model.display(),
            params.n_gpu_layers,
            params.n_ctx,
            params.n_threads,
        );
    }

    let mut cmd = Command::new(&engine);
    if let Some(dir) = &spawn_cwd {
        cmd.current_dir(dir);
    }
    cmd.arg("-m")
        .arg(&model_arg)
        .args(["--port", &port.to_string(), "--host", "127.0.0.1"])
        .args(["-ngl", &params.n_gpu_layers.to_string()])
        .args(["-c", &params.n_ctx.to_string()])
        .args(["-t", &params.n_threads.to_string()])
        // --jinja：用模型自带 chat template（多轮/工具调用语义正确的前提）
        .arg("--jinja")
        // 不开内置 WebUI：只做本机 API 后端
        .arg("--no-webui");

    // dll 与 exe 同层（engine.rs 的 flatten 保证），Windows 加载器会先搜 exe
    // 目录；再把该目录前置到 PATH 兜底（如 cudart 走延迟加载的场景）
    if let Some(engine_dir) = engine.parent() {
        let mut path_var = std::env::var("PATH").unwrap_or_default();
        path_var.insert_str(0, &format!("{}{}", engine_dir.display(), if cfg!(windows) { ";" } else { ":" }));
        cmd.env("PATH", path_var);
    }

    cmd.stdout(Stdio::from(log_file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log_file))
        .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn_failed: {e}（引擎: {}）", engine.display()))?;

    // 崩溃防线：先落 pid，异常退出后下次启动能按进程名清孤儿
    let _ = write_pid_file(&pid_file_path(), child.id());

    // 轮询 /health 直到 200；期间子进程退了就取日志尾部定性（OOM 单独报）
    let health_url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(1))
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + HEALTH_TIMEOUT;

    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let _ = std::fs::remove_file(pid_file_path());
            let tail = read_log_tail();
            if looks_like_oom(&tail) {
                return Err("oom".into());
            }
            return Err(format!(
                "server_exited: {status}\n日志尾部:\n{tail}\n完整日志: {}",
                log_path().display()
            ));
        }
        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                break;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(pid_file_path());
            return Err(format!(
                "health_timeout: {}s 内未就绪。日志: {}",
                HEALTH_TIMEOUT.as_secs(),
                log_path().display()
            ));
        }
        tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
    }

    let mut guard = SERVER.lock().map_err(|_| "lock_poisoned".to_string())?;
    *guard = Some(RunningServer {
        child,
        port,
        model_path: params.model_path.clone(),
        params_fingerprint: fp,
        backend,
        last_touch: Instant::now(),
        keep_alive,
    });
    Ok(EnsureResult { port, restarted: true })
}

/// 刷新空闲计时。前端每次实际用到本地推理（发请求/收到流）时调用。
#[tauri::command]
pub fn local_server_touch() {
    if let Ok(mut guard) = SERVER.lock() {
        if let Some(server) = guard.as_mut() {
            server.last_touch = Instant::now();
        }
    }
}

/// 立即停掉 server（keepAlive=0 的用后即退、切换回在线服务商时前端调用）。
#[tauri::command]
pub fn local_server_stop() {
    stop_running();
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub running: bool,
    pub port: Option<u16>,
    pub model_path: Option<String>,
    pub backend: Option<String>,
}

/// 设置区「本地引擎：运行中/未运行」的数据源。
///
/// 顺手做垃圾回收：发现进程已自灭（崩溃/被任务管理器杀）就把状态清掉，
/// 别让前端拿着一个已死进程的端口去发请求。
#[tauri::command]
pub fn local_server_state() -> ServerState {
    let idle = ServerState { running: false, port: None, model_path: None, backend: None };
    let Ok(mut guard) = SERVER.lock() else { return idle };
    let alive = guard
        .as_mut()
        .is_some_and(|server| server.child.try_wait().map(|s| s.is_none()).unwrap_or(false));
    if !alive {
        if guard.take().is_some() {
            // 自灭的进程不用 kill，但 pid 文件要清
            let _ = std::fs::remove_file(pid_file_path());
        }
        return idle;
    }
    let server = guard.as_ref().expect("checked above");
    ServerState {
        running: true,
        port: Some(server.port),
        model_path: Some(server.model_path.clone()),
        backend: Some(server.backend.clone()),
    }
}

// ============================================================================
//                                  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── 指纹 ──

    #[test]
    fn fingerprint_is_stable_for_same_params() {
        assert_eq!(
            fingerprint("D:/m.gguf", 24, 4096, 8),
            fingerprint("D:/m.gguf", 24, 4096, 8)
        );
        // 路径两端空白不该导致重启
        assert_eq!(
            fingerprint("  D:/m.gguf ", 24, 4096, 8),
            fingerprint("D:/m.gguf", 24, 4096, 8)
        );
    }

    #[test]
    fn fingerprint_changes_when_any_param_changes() {
        let base = fingerprint("D:/m.gguf", 24, 4096, 8);
        assert_ne!(base, fingerprint("D:/other.gguf", 24, 4096, 8));
        assert_ne!(base, fingerprint("D:/m.gguf", 32, 4096, 8));
        assert_ne!(base, fingerprint("D:/m.gguf", 24, 8192, 8));
        assert_ne!(base, fingerprint("D:/m.gguf", 24, 4096, 4));
    }

    #[test]
    fn fingerprint_fields_do_not_collide() {
        // 分隔符保证「ngl=2, ctx=44096」不会与「ngl=24, ctx=4096」串成同一个串
        assert_ne!(
            fingerprint("m", 2, 44096, 8),
            fingerprint("m", 24, 4096, 8)
        );
    }

    // ── OOM 识别 ──

    #[test]
    fn oom_detected_from_common_messages() {
        assert!(looks_like_oom("ggml_backend_cuda_buffer_type_alloc_buffer: allocating 4096 MiB... CUDA error: out of memory"));
        assert!(looks_like_oom("cudaMalloc failed: out of memory"));
        assert!(looks_like_oom("ggml_gallocr: failed to allocate CUDA0 buffer of size 123456"));
        // 大小写不敏感
        assert!(looks_like_oom("CUDA ERROR: OUT OF MEMORY"));
        assert!(looks_like_oom("cudaMalloc returned error 2"));
    }

    #[test]
    fn normal_logs_are_not_oom() {
        assert!(!looks_like_oom(""));
        assert!(!looks_like_oom("llama server listening at http://127.0.0.1:8080"));
        assert!(!looks_like_oom("loaded model in 4200 ms"));
        // 「allocate」单词本身出现不算，要 "failed to allocate"
        assert!(!looks_like_oom("allocated 512 MiB on device CUDA0"));
    }

    // ── keepAlive 映射 ──

    #[test]
    fn keep_alive_mapping() {
        // 缺省 = 用户没配置 → 默认 15 分钟（与前端 aiConfig 的语义对齐）
        assert_eq!(keep_alive_from(None), Some(Duration::from_secs(15 * 60)));
        // -1 = 会话期常驻，看门狗不管
        assert_eq!(keep_alive_from(Some(-1)), None);
        // 0 = 用后即退（前端 stop），看门狗同样不该出手——
        // 映射成 Some(0) 的话看门狗 30s 内就会把刚起的进程杀掉
        assert_eq!(keep_alive_from(Some(0)), None);
        assert_eq!(keep_alive_from(Some(5)), Some(Duration::from_secs(300)));
        assert_eq!(keep_alive_from(Some(60)), Some(Duration::from_secs(3600)));
    }

    // ── 非 ASCII 模型路径的 spawn 计划 ──

    #[test]
    fn ascii_path_passes_through_unchanged() {
        let model = Path::new(r"D:\models\Qwen3.5-2B-Q4_K_M.gguf");
        let (arg, cwd) = model_spawn_plan_for(true, model).unwrap();
        assert_eq!(arg, model);
        assert_eq!(cwd, None);
    }

    #[test]
    fn non_windows_keeps_full_path_even_with_chinese_dirs() {
        // unix 的 argv 就是字节串，UTF-8 全程无损，不需要绕
        let model = Path::new("/home/用户/素材/model.gguf");
        let (arg, cwd) = model_spawn_plan_for(false, model).unwrap();
        assert_eq!(arg, model);
        assert_eq!(cwd, None);
    }

    #[test]
    fn chinese_dir_with_ascii_filename_becomes_cwd_plus_relative() {
        // 真实案例：E:\素材\7.AI大模型\Qwen3.5-2B-Q4_K_M.gguf
        // CRT 的 ANSI argv 会把中文目录转码坏掉 → 切 CWD 只传 ASCII 文件名
        let model = Path::new(r"E:\素材\7.AI大模型\Qwen3.5-2B-Q4_K_M.gguf");
        let (arg, cwd) = model_spawn_plan_for(true, model).unwrap();
        assert_eq!(arg, Path::new("Qwen3.5-2B-Q4_K_M.gguf"));
        assert_eq!(cwd.as_deref(), Some(Path::new(r"E:\素材\7.AI大模型")));
    }

    #[test]
    fn chinese_filename_is_rejected_with_clear_error() {
        let model = Path::new(r"E:\素材\通义千问模型.gguf");
        let err = model_spawn_plan_for(true, model).unwrap_err();
        assert!(err.starts_with("model_filename_nonascii"), "err = {err}");
    }

    // ── 端口分配 ──

    #[test]
    fn picked_port_is_nonzero_and_bindable() {
        let port = pick_free_port().expect("应能分到端口");
        assert_ne!(port, 0);
        // 释放后应当立刻可以重新 bind（server 接手就是这个语义）
        std::net::TcpListener::bind(("127.0.0.1", port))
            .expect("刚释放的端口应可重新绑定");
    }

    #[test]
    fn two_picks_return_valid_ports() {
        let a = pick_free_port().unwrap();
        let b = pick_free_port().unwrap();
        assert_ne!(a, 0);
        assert_ne!(b, 0);
    }

    // ── pid 文件 ──

    #[test]
    fn pid_file_roundtrip() {
        let dir = std::env::temp_dir().join(format!("spoor-pid-{}", uuid::Uuid::new_v4()));
        // 父目录不存在也要能写（write_pid_file 自己建）
        let path = dir.join("llama").join("server.pid");
        write_pid_file(&path, 43210).expect("写 pid 应成功");
        assert_eq!(read_pid_file(&path), Some(43210));
        // 覆盖写
        write_pid_file(&path, 99).unwrap();
        assert_eq!(read_pid_file(&path), Some(99));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pid_file_garbage_and_missing_yield_none() {
        let dir = std::env::temp_dir().join(format!("spoor-pid-bad-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("server.pid");
        assert_eq!(read_pid_file(&path), None, "不存在 → None");
        std::fs::write(&path, "not-a-number").unwrap();
        assert_eq!(read_pid_file(&path), None, "垃圾内容 → None");
        // 带换行/空白的正常内容要容忍
        std::fs::write(&path, "1234\r\n").unwrap();
        assert_eq!(read_pid_file(&path), Some(1234));
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── 进程名校验 ──

    #[test]
    fn tasklist_output_matching() {
        // tasklist /FO CSV /NH 的典型输出
        assert!(tasklist_says_llama_server(
            "\"llama-server.exe\",\"12345\",\"Console\",\"1\",\"1,234,567 K\"\r\n"
        ));
        // ps -o comm= 的输出
        assert!(tasklist_says_llama_server("llama-server\n"));
        // PID 被别的进程复用 → 不许杀
        assert!(!tasklist_says_llama_server(
            "\"notepad.exe\",\"12345\",\"Console\",\"1\",\"9,876 K\"\r\n"
        ));
        // tasklist 找不到进程时的提示
        assert!(!tasklist_says_llama_server(
            "INFO: No tasks are running which match the specified criteria.\r\n"
        ));
        assert!(!tasklist_says_llama_server(""));
    }

    // ── 参数反序列化（前端契约）──

    #[test]
    fn ensure_params_deserialize_from_camelcase() {
        let json = serde_json::json!({
            "modelPath": "D:/m.gguf",
            "nGpuLayers": 24,
            "nCtx": 4096,
            "nThreads": 8,
            "keepAliveMinutes": 10,
        });
        let p: EnsureParams = serde_json::from_value(json).expect("反序列化应成功");
        assert_eq!(p.model_path, "D:/m.gguf");
        assert_eq!(p.n_gpu_layers, 24);
        assert_eq!(p.n_ctx, 4096);
        assert_eq!(p.n_threads, 8);
        assert_eq!(p.keep_alive_minutes, Some(10));
    }

    #[test]
    fn ensure_params_keep_alive_optional() {
        let json = serde_json::json!({
            "modelPath": "D:/m.gguf",
            "nGpuLayers": 0,
            "nCtx": 2048,
            "nThreads": 4,
        });
        let p: EnsureParams = serde_json::from_value(json).expect("keepAliveMinutes 可缺省");
        assert_eq!(p.keep_alive_minutes, None);
        // -ngl 允许负值语义外的 0（纯 CPU）
        assert_eq!(p.n_gpu_layers, 0);
    }

    #[test]
    fn ensure_result_serializes_camelcase() {
        let v = serde_json::to_value(EnsureResult { port: 51234, restarted: true }).unwrap();
        assert_eq!(v["port"], 51234);
        assert_eq!(v["restarted"], true);
    }

    #[test]
    fn server_state_serializes_camelcase() {
        let v = serde_json::to_value(ServerState {
            running: true,
            port: Some(1),
            model_path: Some("m".into()),
            backend: Some("cuda".into()),
        })
        .unwrap();
        assert!(v.get("modelPath").is_some(), "必须是 camelCase：{v}");
        assert!(v.get("model_path").is_none());
    }

    // ── LLAMA_N_GPU_LAYERS 兼容 ──

    #[test]
    fn env_gpu_layers_overrides_param() {
        assert_eq!(resolve_gpu_layers(17, Some("24")), 24);
        assert_eq!(resolve_gpu_layers(17, Some(" 999 ")), 999);
        assert_eq!(resolve_gpu_layers(17, Some("0")), 0);
    }

    #[test]
    fn env_gpu_layers_ignored_when_absent_or_garbage() {
        assert_eq!(resolve_gpu_layers(17, None), 17);
        assert_eq!(resolve_gpu_layers(17, Some("")), 17);
        assert_eq!(resolve_gpu_layers(17, Some("many")), 17);
    }
}
