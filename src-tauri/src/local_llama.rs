//! 桌面端本地推理（GGUF）—— 通过子进程调用预编译的 llama-completion.exe / llama-cli.exe
//! 完全绕过从源码编译 CUDA 的需要；只需官方预编译二进制 + CUDA 运行时 DLL。
//!
//! 每次调用都会把命令行、stdout、stderr、耗时等写入 %TEMP%\spoor_llama.log，
//! 方便用户/开发者排查问题（前端也提供 get_local_llama_log_path 命令）。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;
use serde::Deserialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: 不在 GUI 应用中弹出黑色控制台窗口（CREATE_NO_WINDOW = 0x08000000）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 日志文件最大保留字节数（超出会截断重写，避免无限增长）。
const LOG_MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MB

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlamaChatPayload {
    pub model_path: String,
    pub system_instruction: Option<String>,
    pub user_message: String,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
    pub n_ctx: Option<u32>,
    pub enable_thinking: Option<bool>,
}

/// 日志文件路径：`%TEMP%\spoor_llama.log`（用户可点开 %TEMP% 查看）。
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("spoor_llama.log")
}

/// 简单的时间戳（YYYY-MM-DD HH:MM:SS）—— 不依赖 chrono 等额外 crate。
fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 当地时区偏移：用 chrono 太重，这里只输出 UTC 时间 + 时区标记
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}Z")
}

/// 把 unix epoch 秒数转成 YMD HMS（UTC）。简化版历法计算，1970~2099 内正确。
fn unix_to_ymdhms(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let mut days = secs / 86400;
    let mut year: u64 = 1970;
    loop {
        let leap = is_leap(year);
        let days_in_year = if leap { 366 } else { 365 };
        if days >= days_in_year {
            days -= days_in_year;
            year += 1;
        } else {
            break;
        }
    }
    let leap = is_leap(year);
    let dim = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u64;
    for &md in dim.iter() {
        if days >= md {
            days -= md;
            month += 1;
        } else {
            break;
        }
    }
    (year, month, days + 1, h, m, s)
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// 追加写日志；首次写入或文件超大时截断重写。
fn log_write(content: &str) {
    let path = log_path();
    // 如果文件超过上限，重置（保留最新一次）
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.append(true).create(true);
    if let Ok(mut f) = opts.open(&path) {
        let _ = writeln!(f, "{}", content);
    }
}

/// 把多行内容包装一段日志（带时间戳和分节符）。
fn log_section(title: &str, body: &str) {
    log_write(&format!(
        "\n========== [{}] {} ==========\n{}",
        timestamp(),
        title,
        body
    ));
}

/// 查找 llama-completion.exe（首选）或 llama-cli.exe（兼容）的路径。
/// llama-completion 是 llama.cpp 推荐用于"单次补全"的工具，输出干净不进交互模式。
fn find_llama_cli() -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("LLAMA_CLI_PATH") {
        let p = PathBuf::from(&env_path);
        if p.exists() {
            return Ok(p);
        }
    }

    let exe_path = std::env::current_exe().map_err(|e| format!("无法获取可执行文件路径: {e}"))?;
    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));

    // llama-completion 优先（输出更干净），llama-cli 作为兼容回退
    let candidates = vec![
        exe_dir.join("llama-completion.exe"),
        exe_dir.join("llama-cli.exe"),
        exe_dir.join("llama-binaries/llama-completion.exe"),
        exe_dir.join("llama-binaries/llama-cli.exe"),
        exe_dir.join("bin/llama-completion.exe"),
        exe_dir.join("bin/llama-cli.exe"),
        crate_dir.join("../llama-binaries/llama-completion.exe"),
        crate_dir.join("../llama-binaries/llama-cli.exe"),
        PathBuf::from(r"D:\Tools\llama-cuda\llama-completion.exe"),
        PathBuf::from(r"D:\Tools\llama-cuda\llama-cli.exe"),
    ];

    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }

    Err("找不到 llama-completion.exe / llama-cli.exe。请将其放在应用目录下，或设置 LLAMA_CLI_PATH 环境变量。".into())
}

/// 同步执行推理：调用 llama-completion / llama-cli 子进程
pub fn chat(payload: LocalLlamaChatPayload) -> Result<String, String> {
    let started = Instant::now();
    let log_file = log_path();
    log_section(
        "REQUEST",
        &format!(
            "user_message_len={} system_len={} model_path={}",
            payload.user_message.chars().count(),
            payload
                .system_instruction
                .as_ref()
                .map(|s| s.chars().count())
                .unwrap_or(0),
            payload.model_path,
        ),
    );

    let model_path = PathBuf::from(payload.model_path.trim());
    if !model_path.is_file() {
        let err = format!("模型文件不存在: {}", model_path.display());
        log_section("ERROR", &err);
        return Err(format!("{err}\n日志: {}", log_file.display()));
    }
    let model_path = std::fs::canonicalize(&model_path)
        .map_err(|e| format!("无法解析模型路径 {}: {e}", model_path.display()))?;

    let llama_cli = find_llama_cli().map_err(|e| {
        log_section("ERROR", &e);
        format!("{e}\n日志: {}", log_file.display())
    })?;
    let llama_dir = llama_cli.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();

    let n_ctx = payload.n_ctx.unwrap_or(2048);
    let max_tokens = payload.max_tokens.unwrap_or(512);
    let temperature = payload.temperature.unwrap_or(0.7);
    let top_p = payload.top_p.unwrap_or(0.9);

    let mut prompt = String::new();
    if let Some(ref sys) = payload.system_instruction {
        let t = sys.trim();
        if !t.is_empty() {
            prompt.push_str(t);
            prompt.push_str("\n\n");
        }
    }
    prompt.push_str(&payload.user_message);

    let n_threads = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4);

    // GPU 层数：从环境变量读取，默认 24（保守值，避免 OOM）。
    // GTX 1650/1660 (4GB) 通常剩余 2.5-3GB 可用，Gemma 4B Q4_K_M 完全加载需 2.9GB；
    // 桌面环境占用 GPU 后会爆显存。设 24 ≈ 60% 的层卸载到 GPU。
    // 8GB+ 显存的用户：可设 LLAMA_N_GPU_LAYERS=999 全部卸载。
    // 无独显用户：设 LLAMA_N_GPU_LAYERS=0 完全 CPU。
    let n_gpu_layers: i32 = std::env::var("LLAMA_N_GPU_LAYERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(24);

    let prompt_file = std::env::temp_dir().join(format!(
        "spoor_llama_prompt_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    {
        let mut f = std::fs::File::create(&prompt_file)
            .map_err(|e| format!("创建临时 prompt 文件失败: {e}"))?;
        f.write_all(prompt.as_bytes())
            .map_err(|e| format!("写入 prompt 失败: {e}"))?;
    }

    let mut cmd = Command::new(&llama_cli);
    cmd.arg("--model").arg(&model_path)
        .arg("--ctx-size").arg(n_ctx.to_string())
        .arg("--threads").arg(n_threads.to_string())
        .arg("--n-gpu-layers").arg(n_gpu_layers.to_string())
        .arg("--temp").arg(temperature.to_string())
        .arg("--top-p").arg(top_p.to_string())
        .arg("--predict").arg(max_tokens.to_string())
        .arg("--no-display-prompt")
        // --simple-io：专为子进程/受限控制台设计的简化 IO；不带 logo/提示符
        .arg("--simple-io")
        // -no-cnv：禁用对话/交互模式（短形式，新版 llama.cpp 必需）
        .arg("-no-cnv")
        // -st：单轮，处理完即退出
        .arg("-st")
        .arg("-f").arg(&prompt_file);

    cmd.env("PATH", {
        let mut paths = std::env::var("PATH").unwrap_or_default();
        paths.insert_str(0, &format!("{};", llama_dir.display()));
        paths
    });

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    log_section(
        "COMMAND",
        &format!(
            "exe   : {}\nmodel : {}\nctx   : {}\npredict: {}\ngpu_layers: {}\nthreads: {}\nprompt_file: {}\nprompt_preview: {}",
            llama_cli.display(),
            model_path.display(),
            n_ctx,
            max_tokens,
            n_gpu_layers,
            n_threads,
            prompt_file.display(),
            preview(&prompt, 200),
        ),
    );

    let mut child = cmd.spawn().map_err(|e| {
        let err = format!("启动 llama-cli 失败: {e}\n路径: {}", llama_cli.display());
        log_section("ERROR", &err);
        format!("{err}\n日志: {}", log_file.display())
    })?;

    drop(child.stdin.take());

    let pid = child.id();
    let timeout_handle = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(300));
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    });

    let output = child.wait_with_output().map_err(|e| {
        let err = format!("等待 llama-cli 完成失败: {e}");
        log_section("ERROR", &err);
        format!("{err}\n日志: {}", log_file.display())
    })?;

    drop(timeout_handle);
    let _ = std::fs::remove_file(&prompt_file);

    let elapsed = started.elapsed();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    log_section(
        "RESULT",
        &format!(
            "exit_status: {}\nelapsed_ms: {}\nstdout_len: {}\nstderr_len: {}\n--- stdout (head 4000) ---\n{}\n--- stderr (tail 4000) ---\n{}",
            output.status,
            elapsed.as_millis(),
            stdout.len(),
            stderr.len(),
            head(&stdout, 4000),
            tail(&stderr, 4000),
        ),
    );

    if !output.status.success() {
        let stderr_tail = tail(&stderr, 2000);
        let stdout_tail = tail(&stdout, 500);
        return Err(format!(
            "llama-cli 执行失败 (exit={}):\nstdout: {}\nstderr: {}\n日志: {}",
            output.status,
            stdout_tail,
            stderr_tail,
            log_file.display(),
        ));
    }

    Ok(clean_output(&stdout))
}

fn preview(s: &str, n: usize) -> String {
    let s = s.replace('\n', "⏎");
    if s.chars().count() <= n {
        s
    } else {
        let truncated: String = s.chars().take(n).collect();
        format!("{}…", truncated)
    }
}

fn head(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // 找一个 char boundary 靠近 max
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut start = s.len() - max;
        while start < s.len() && !s.is_char_boundary(start) {
            start += 1;
        }
        format!("…{}", &s[start..])
    }
}

/// 清理 llama-completion 的输出：移除 `[end of text]` / `<end_of_turn>` 等结束标记
/// 以及 trailing newlines，保留正文。
fn clean_output(raw: &str) -> String {
    let mut s = raw.to_string();
    const END_MARKERS: &[&str] = &[
        "[end of text]",
        "<end_of_turn>",
        "<|im_end|>",
        "<|endoftext|>",
        "<|eot_id|>",
    ];
    for m in END_MARKERS {
        if let Some(idx) = s.find(m) {
            s.truncate(idx);
        }
    }
    s.trim().to_string()
}

// ============================================================================
//                                  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- clean_output ----

    #[test]
    fn clean_output_strips_known_end_markers() {
        assert_eq!(clean_output("Hello world [end of text]"), "Hello world");
        assert_eq!(clean_output("Hi there<end_of_turn>\nmore"), "Hi there");
        assert_eq!(clean_output("Hi <|im_end|> rest"), "Hi");
        assert_eq!(clean_output("Hi <|endoftext|>"), "Hi");
        assert_eq!(clean_output("Hi <|eot_id|> tail"), "Hi");
    }

    #[test]
    fn clean_output_passes_through_when_no_marker() {
        assert_eq!(clean_output("plain output"), "plain output");
        assert_eq!(clean_output(""), "");
    }

    #[test]
    fn clean_output_trims_surrounding_whitespace() {
        assert_eq!(clean_output("  trimmed  \n\n"), "trimmed");
        assert_eq!(clean_output("\n\nx[end of text]\n"), "x");
    }

    #[test]
    fn clean_output_first_marker_wins_when_multiple() {
        // 第一个出现的标记决定截断点；后续标记自然也被一起去掉
        let raw = "foo [end of text] bar <end_of_turn>";
        assert_eq!(clean_output(raw), "foo");
    }

    #[test]
    fn clean_output_handles_chinese_content() {
        assert_eq!(clean_output("你好，世界 [end of text]"), "你好，世界");
        assert_eq!(clean_output("我是 Gemma<end_of_turn>"), "我是 Gemma");
    }

    // ---- head / tail / preview ----

    #[test]
    fn head_returns_input_when_short_enough() {
        assert_eq!(head("hi", 10), "hi");
        assert_eq!(head("", 5), "");
    }

    #[test]
    fn head_truncates_long_ascii_with_ellipsis() {
        assert_eq!(head("abcdefghij", 5), "abcde…");
    }

    #[test]
    fn head_respects_utf8_char_boundary() {
        // "你好世界" 每个字 3 字节，共 12 字节。
        // max=4 不是 boundary，应回退到 3，截到 "你"。
        assert_eq!(head("你好世界", 4), "你…");
        // max=11 不是 boundary，回退到 9 = "你好世"
        assert_eq!(head("你好世界", 11), "你好世…");
        // 完整长度 → 不截断
        assert_eq!(head("你好世界", 12), "你好世界");
    }

    #[test]
    fn tail_returns_input_when_short_enough() {
        assert_eq!(tail("hi", 10), "hi");
        assert_eq!(tail("", 5), "");
    }

    #[test]
    fn tail_keeps_ending_with_ellipsis_prefix() {
        assert_eq!(tail("abcdefghij", 5), "…fghij");
    }

    #[test]
    fn tail_respects_utf8_char_boundary() {
        // "你好世界" 12 字节；max=4，start=8 不是 boundary → 推到 9 = "界"
        assert_eq!(tail("你好世界", 4), "…界");
        // max=11 → start=1 不是 boundary → 推到 3 = "好世界"
        assert_eq!(tail("你好世界", 11), "…好世界");
    }

    #[test]
    fn preview_replaces_newlines_with_visible_marker() {
        assert_eq!(preview("a\nb\nc", 100), "a⏎b⏎c");
    }

    #[test]
    fn preview_truncates_by_chars_not_bytes() {
        let s = "你好世界123";
        // 7 chars total
        assert_eq!(preview(s, 4), "你好世界…");
        assert_eq!(preview(s, 7), "你好世界123");
        assert_eq!(preview(s, 100), "你好世界123");
    }

    // ---- 历法计算 ----

    #[test]
    fn is_leap_known_years() {
        assert!(is_leap(2000), "2000 是世纪闰年");
        assert!(is_leap(2024));
        assert!(is_leap(1972));
        assert!(!is_leap(1900), "1900 不是闰年（百年但非 400 倍）");
        assert!(!is_leap(2100));
        assert!(!is_leap(2023));
    }

    #[test]
    fn unix_to_ymdhms_epoch() {
        assert_eq!(unix_to_ymdhms(0), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn unix_to_ymdhms_one_day_later() {
        assert_eq!(unix_to_ymdhms(86_400), (1970, 1, 2, 0, 0, 0));
    }

    #[test]
    fn unix_to_ymdhms_one_hour() {
        assert_eq!(unix_to_ymdhms(3600), (1970, 1, 1, 1, 0, 0));
    }

    #[test]
    fn unix_to_ymdhms_known_timestamp() {
        // 2024-01-01 00:00:00 UTC = 1704067200
        assert_eq!(unix_to_ymdhms(1_704_067_200), (2024, 1, 1, 0, 0, 0));
        // 2024-02-29 12:34:56 UTC = 1709210096（闰日）
        assert_eq!(unix_to_ymdhms(1_709_210_096), (2024, 2, 29, 12, 34, 56));
        // 2026-05-08 15:30:45 UTC = 1778254245
        assert_eq!(unix_to_ymdhms(1_778_254_245), (2026, 5, 8, 15, 30, 45));
    }

    // ---- 日志路径 ----

    #[test]
    fn log_path_under_temp_dir() {
        let p = log_path();
        assert!(p.ends_with("spoor_llama.log"), "got: {}", p.display());
        // 应该在系统临时目录下
        assert!(p.starts_with(std::env::temp_dir()), "got: {}", p.display());
    }

    // ---- find_llama_cli：用临时假文件验证 LLAMA_CLI_PATH 优先级 ----
    //
    // 注意：env var 是进程全局，cargo test 默认并行；这两个用例用同一个变量名，
    // 必须串行。我们把它们合到一个测试里手动顺序执行。

    #[test]
    fn find_llama_cli_env_var_takes_precedence() {
        // 1) 设置一个真实存在的临时文件 → 应该被命中
        let tmp = std::env::temp_dir().join("spoor_test_llama_cli.exe");
        std::fs::write(&tmp, b"fake binary").expect("write tmp");

        std::env::set_var("LLAMA_CLI_PATH", &tmp);
        let found = find_llama_cli().expect("应该找到环境变量指向的文件");
        assert_eq!(found, tmp);

        // 2) 设置一个不存在的路径 → 函数应回退到默认搜索（结果取决于环境，
        //    但至少不能 panic / 不能错误地返回这个不存在的路径）
        let missing = std::path::PathBuf::from(r"C:\definitely\does\not\exist\llama.exe");
        std::env::set_var("LLAMA_CLI_PATH", &missing);
        if let Ok(p) = find_llama_cli() {
            assert_ne!(p, missing, "不存在的 env path 不应被返回");
        }
        // 也接受 Err（开发机没装 llama-cli 是正常的）

        std::env::remove_var("LLAMA_CLI_PATH");
        std::fs::remove_file(&tmp).ok();
    }

    // ---- 日志写入：log_section 实际能落盘 ----

    #[test]
    fn log_section_writes_to_disk() {
        let p = log_path();
        // 先清掉可能已有的日志，便于断言新内容
        std::fs::remove_file(&p).ok();

        log_section("UNIT_TEST", "marker_string_xyz_123");

        let content = std::fs::read_to_string(&p).expect("日志文件应被创建");
        assert!(content.contains("UNIT_TEST"), "section title 应写入");
        assert!(content.contains("marker_string_xyz_123"), "body 应写入");
        // 时间戳带 'Z' 后缀
        assert!(content.contains("Z]"), "应包含时间戳：{content}");
    }

    // ---- LocalLlamaChatPayload 反序列化：验证前端 camelCase → Rust snake_case ----

    #[test]
    fn payload_deserializes_from_camelcase_json() {
        let json = serde_json::json!({
            "modelPath": "D:/m.gguf",
            "systemInstruction": "be brief",
            "userMessage": "hi",
            "temperature": 0.5,
            "topP": 0.8,
            "maxTokens": 256,
            "nCtx": 1024,
            "enableThinking": true,
        });
        let p: LocalLlamaChatPayload = serde_json::from_value(json).expect("反序列化应成功");
        assert_eq!(p.model_path, "D:/m.gguf");
        assert_eq!(p.system_instruction.as_deref(), Some("be brief"));
        assert_eq!(p.user_message, "hi");
        assert_eq!(p.temperature, Some(0.5));
        assert_eq!(p.top_p, Some(0.8));
        assert_eq!(p.max_tokens, Some(256));
        assert_eq!(p.n_ctx, Some(1024));
        assert_eq!(p.enable_thinking, Some(true));
    }

    #[test]
    fn payload_allows_optional_fields_to_be_absent() {
        let json = serde_json::json!({
            "modelPath": "D:/m.gguf",
            "userMessage": "hi",
        });
        let p: LocalLlamaChatPayload = serde_json::from_value(json).expect("反序列化应成功");
        assert_eq!(p.model_path, "D:/m.gguf");
        assert!(p.system_instruction.is_none());
        assert!(p.temperature.is_none());
        assert!(p.top_p.is_none());
        assert!(p.max_tokens.is_none());
        assert!(p.n_ctx.is_none());
        assert!(p.enable_thinking.is_none());
    }

    #[test]
    fn payload_rejects_snake_case_keys() {
        // 防回归：之前踩过坑——前端如果误传 snake_case 应该拒绝
        let json = serde_json::json!({
            "model_path": "D:/m.gguf",
            "user_message": "hi",
        });
        let r: Result<LocalLlamaChatPayload, _> = serde_json::from_value(json);
        assert!(r.is_err(), "snake_case 字段不应被识别");
    }
}
