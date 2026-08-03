//! GGUF 元数据解析（0.6.0「选文件即用」的事实层）。
//!
//! 只读 header 与 metadata KV，不碰张量数据——目的有两个：
//! 1. 选完文件**当场**显示模型卡（架构/规模/量化/层数/训练上下文），选错文件当场报；
//! 2. 给自动参数规划器（前端 localModelPlanner）提供 block_count、context_length、
//!    KV 头数等事实，把「显存装得下几层」从跑崩后翻日志变成事前算术。
//!
//! 手写解析而不引依赖：GGUF v2/v3 的头部格式是十几行的事（LE，magic + 版本 +
//! 两个计数 + KV 表），一个解析依赖的供应链与版本漂移都比这十几行贵。
//! 大数组（tokenizer 的几十万条 token）按长度逐项跳过，不载入内存。

use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

const GGUF_MAGIC: u32 = 0x4655_4747; // "GGUF" little-endian
/// 元数据 KV 个数的 sanity 上限。真实模型 ~30 个；超过说明文件不是 GGUF 或已损坏。
const MAX_KV_COUNT: u64 = 4096;
/// 单个字符串长度上限（chat template 可达数十 KB，tokenizer merges 单条很短）。
const MAX_STRING_LEN: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GgufInfo {
    pub file_bytes: u64,
    pub version: u32,
    pub tensor_count: u64,
    pub architecture: Option<String>,
    pub model_name: Option<String>,
    /// `general.size_label`（如 "8B"），新模型才有。
    pub size_label: Option<String>,
    /// 量化类型的人话标签（Q4_K_M…），来自 `general.file_type` 枚举。
    pub quant_label: Option<String>,
    /// 层数（`{arch}.block_count`）——自动 GPU 层数的分母。
    pub block_count: Option<u64>,
    /// 训练上下文长度（`{arch}.context_length`）——n_ctx 的上限。
    pub context_length: Option<u64>,
    pub embedding_length: Option<u64>,
    pub head_count: Option<u64>,
    /// KV 头数（GQA 模型 < head_count）——KV cache 尺寸估算用。
    pub head_count_kv: Option<u64>,
    pub has_chat_template: bool,
}

#[derive(Debug)]
enum GgufValue {
    U64(u64),
    Str(String),
    Skipped,
}

fn read_u32(r: &mut impl Read) -> Result<u32, String> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b).map_err(|e| format!("read: {e}"))?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64(r: &mut impl Read) -> Result<u64, String> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b).map_err(|e| format!("read: {e}"))?;
    Ok(u64::from_le_bytes(b))
}

fn read_string(r: &mut (impl Read + Seek), keep: bool) -> Result<Option<String>, String> {
    let len = read_u64(r)?;
    if len > MAX_STRING_LEN {
        return Err("gguf_string_too_long".into());
    }
    if !keep {
        r.seek(SeekFrom::Current(len as i64)).map_err(|e| format!("seek: {e}"))?;
        return Ok(None);
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf).map_err(|e| format!("read: {e}"))?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

/// 标量类型的字节宽度；string/array 走各自的读取路径。
fn scalar_width(value_type: u32) -> Option<i64> {
    match value_type {
        0 | 1 | 7 => Some(1),
        2 | 3 => Some(2),
        4 | 5 | 6 => Some(4),
        10 | 11 | 12 => Some(8),
        _ => None,
    }
}

/// 读一个 KV 值。`keep` 为 false 时尽量 seek 跳过而不物化。
fn read_value(
    r: &mut (impl Read + Seek),
    value_type: u32,
    keep: bool,
) -> Result<GgufValue, String> {
    match value_type {
        8 => Ok(match read_string(r, keep)? {
            Some(s) => GgufValue::Str(s),
            None => GgufValue::Skipped,
        }),
        9 => {
            // 数组：元素类型 + 个数。tokenizer 的 token 表能到几十万条，逐项跳。
            let elem_type = read_u32(r)?;
            let count = read_u64(r)?;
            if let Some(w) = scalar_width(elem_type) {
                let total = w
                    .checked_mul(count as i64)
                    .ok_or_else(|| "gguf_array_overflow".to_string())?;
                r.seek(SeekFrom::Current(total)).map_err(|e| format!("seek: {e}"))?;
            } else if elem_type == 8 {
                for _ in 0..count {
                    read_string(r, false)?;
                }
            } else {
                return Err(format!("gguf_unknown_array_type_{elem_type}"));
            }
            Ok(GgufValue::Skipped)
        }
        t => {
            let width = scalar_width(t).ok_or_else(|| format!("gguf_unknown_type_{t}"))?;
            if keep {
                // 统一放大成 u64 读出：我们关心的标量键全是无符号整数
                let mut buf = [0u8; 8];
                r.read_exact(&mut buf[..width as usize]).map_err(|e| format!("read: {e}"))?;
                Ok(GgufValue::U64(u64::from_le_bytes(buf)))
            } else {
                r.seek(SeekFrom::Current(width)).map_err(|e| format!("seek: {e}"))?;
                Ok(GgufValue::Skipped)
            }
        }
    }
}

/// `general.file_type` 枚举 → 人话量化标签（llama.cpp 的 LLAMA_FTYPE_*）。
/// 只映射常见项；认不出的报 "type N"，比报错强——它不影响能不能跑。
fn quant_label(file_type: u64) -> String {
    match file_type {
        0 => "F32", 1 => "F16", 2 => "Q4_0", 3 => "Q4_1", 7 => "Q8_0",
        8 => "Q5_0", 9 => "Q5_1", 10 => "Q2_K", 11 => "Q3_K_S", 12 => "Q3_K_M",
        13 => "Q3_K_L", 14 => "Q4_K_S", 15 => "Q4_K_M", 16 => "Q5_K_S",
        17 => "Q5_K_M", 18 => "Q6_K", 19 => "IQ2_XXS", 20 => "IQ2_XS",
        24 => "IQ1_S", 25 => "IQ4_NL", 30 => "BF16",
        n => return format!("type {n}"),
    }
    .to_string()
}

pub fn inspect(path: &Path) -> Result<GgufInfo, String> {
    let file = File::open(path).map_err(|e| format!("open: {e}"))?;
    let file_bytes = file.metadata().map_err(|e| format!("meta: {e}"))?.len();
    let mut r = BufReader::new(file);

    if read_u32(&mut r)? != GGUF_MAGIC {
        return Err("not_a_gguf".into());
    }
    let version = read_u32(&mut r)?;
    // v1 用 32 位计数，早已绝迹；只支持 v2/v3（也为未来的 v4 留报错口径）
    if !(2..=3).contains(&version) {
        return Err(format!("unsupported_gguf_version_{version}"));
    }
    let tensor_count = read_u64(&mut r)?;
    let kv_count = read_u64(&mut r)?;
    if kv_count > MAX_KV_COUNT {
        return Err("gguf_metadata_corrupt".into());
    }

    let mut info = GgufInfo {
        file_bytes,
        version,
        tensor_count,
        ..Default::default()
    };
    let mut architecture: Option<String> = None;
    // 与架构相关的键要等 architecture 出现才知道全名，先攒起来二次匹配
    let mut pending: Vec<(String, u64)> = Vec::new();

    for _ in 0..kv_count {
        let key = read_string(&mut r, true)?.unwrap_or_default();
        let value_type = read_u32(&mut r)?;
        let keep = matches!(
            key.as_str(),
            "general.architecture" | "general.name" | "general.size_label" | "general.file_type"
        ) || key.ends_with(".block_count")
            || key.ends_with(".context_length")
            || key.ends_with(".embedding_length")
            || key.ends_with(".attention.head_count")
            || key.ends_with(".attention.head_count_kv");

        if key == "tokenizer.chat_template" {
            // 只关心有没有，不把几十 KB 的模板搬进内存
            read_value(&mut r, value_type, false)?;
            info.has_chat_template = true;
            continue;
        }

        match read_value(&mut r, value_type, keep)? {
            GgufValue::Str(s) => match key.as_str() {
                "general.architecture" => architecture = Some(s),
                "general.name" => info.model_name = Some(s),
                "general.size_label" => info.size_label = Some(s),
                _ => {}
            },
            GgufValue::U64(v) => {
                if key == "general.file_type" {
                    info.quant_label = Some(quant_label(v));
                } else {
                    pending.push((key, v));
                }
            }
            GgufValue::Skipped => {}
        }
    }

    // 架构前缀匹配：llama.block_count / qwen3.block_count… 后缀是稳定的
    for (key, v) in pending {
        if key.ends_with(".block_count") {
            info.block_count = Some(v);
        } else if key.ends_with(".context_length") {
            info.context_length = Some(v);
        } else if key.ends_with(".embedding_length") {
            info.embedding_length = Some(v);
        } else if key.ends_with(".attention.head_count_kv") {
            info.head_count_kv = Some(v);
        } else if key.ends_with(".attention.head_count") {
            info.head_count = Some(v);
        }
    }
    info.architecture = architecture;
    Ok(info)
}

#[tauri::command]
pub fn gguf_inspect(path: String) -> Result<GgufInfo, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("file_not_found".into());
    }
    inspect(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 手搓一个最小合成 GGUF：给定 KV 表，拼出合法字节流。
    struct GgufBuilder {
        buf: Vec<u8>,
        kv_count: u64,
        kvs: Vec<u8>,
    }

    impl GgufBuilder {
        fn new() -> Self {
            Self { buf: Vec::new(), kv_count: 0, kvs: Vec::new() }
        }

        fn push_str_raw(out: &mut Vec<u8>, s: &str) {
            out.extend_from_slice(&(s.len() as u64).to_le_bytes());
            out.extend_from_slice(s.as_bytes());
        }

        fn kv_string(mut self, key: &str, value: &str) -> Self {
            Self::push_str_raw(&mut self.kvs, key);
            self.kvs.extend_from_slice(&8u32.to_le_bytes());
            Self::push_str_raw(&mut self.kvs, value);
            self.kv_count += 1;
            self
        }

        fn kv_u32(mut self, key: &str, value: u32) -> Self {
            Self::push_str_raw(&mut self.kvs, key);
            self.kvs.extend_from_slice(&4u32.to_le_bytes());
            self.kvs.extend_from_slice(&value.to_le_bytes());
            self.kv_count += 1;
            self
        }

        fn kv_str_array(mut self, key: &str, items: &[&str]) -> Self {
            Self::push_str_raw(&mut self.kvs, key);
            self.kvs.extend_from_slice(&9u32.to_le_bytes());
            self.kvs.extend_from_slice(&8u32.to_le_bytes());
            self.kvs.extend_from_slice(&(items.len() as u64).to_le_bytes());
            for item in items {
                Self::push_str_raw(&mut self.kvs, item);
            }
            self.kv_count += 1;
            self
        }

        fn build(mut self) -> Vec<u8> {
            self.buf.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
            self.buf.extend_from_slice(&3u32.to_le_bytes());
            self.buf.extend_from_slice(&42u64.to_le_bytes()); // tensor_count
            self.buf.extend_from_slice(&self.kv_count.to_le_bytes());
            self.buf.extend_from_slice(&self.kvs);
            self.buf
        }
    }

    fn write_temp(bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("spoor-gguf-test-{}.gguf", uuid::Uuid::new_v4()));
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn parses_typical_model_metadata() {
        let bytes = GgufBuilder::new()
            .kv_string("general.architecture", "qwen3")
            .kv_string("general.name", "Qwen3 8B Instruct")
            .kv_string("general.size_label", "8B")
            .kv_u32("general.file_type", 15)
            .kv_u32("qwen3.block_count", 36)
            .kv_u32("qwen3.context_length", 32768)
            .kv_u32("qwen3.embedding_length", 4096)
            .kv_u32("qwen3.attention.head_count", 32)
            .kv_u32("qwen3.attention.head_count_kv", 8)
            .kv_str_array("tokenizer.ggml.tokens", &["<s>", "hello", "世界"])
            .kv_string("tokenizer.chat_template", "{% for m in messages %}…{% endfor %}")
            .build();
        let path = write_temp(&bytes);
        let info = inspect(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(info.architecture.as_deref(), Some("qwen3"));
        assert_eq!(info.model_name.as_deref(), Some("Qwen3 8B Instruct"));
        assert_eq!(info.size_label.as_deref(), Some("8B"));
        assert_eq!(info.quant_label.as_deref(), Some("Q4_K_M"));
        assert_eq!(info.block_count, Some(36));
        assert_eq!(info.context_length, Some(32768));
        assert_eq!(info.head_count_kv, Some(8));
        assert!(info.has_chat_template);
        assert_eq!(info.tensor_count, 42);
        assert_eq!(info.version, 3);
    }

    #[test]
    fn head_count_kv_not_clobbered_by_head_count_suffix_order() {
        // head_count 与 head_count_kv 的后缀有包含关系，验证匹配顺序正确
        let bytes = GgufBuilder::new()
            .kv_string("general.architecture", "llama")
            .kv_u32("llama.attention.head_count_kv", 4)
            .kv_u32("llama.attention.head_count", 32)
            .build();
        let path = write_temp(&bytes);
        let info = inspect(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(info.head_count, Some(32));
        assert_eq!(info.head_count_kv, Some(4));
    }

    #[test]
    fn rejects_non_gguf_and_bad_version() {
        let path = write_temp(b"MZ\x90\x00 definitely not a gguf");
        assert_eq!(inspect(&path).unwrap_err(), "not_a_gguf");
        std::fs::remove_file(&path).ok();

        let mut v1 = Vec::new();
        v1.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
        v1.extend_from_slice(&1u32.to_le_bytes());
        let path = write_temp(&v1);
        assert!(inspect(&path).unwrap_err().starts_with("unsupported_gguf_version"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn truncated_file_reports_read_error_not_panic() {
        let full = GgufBuilder::new()
            .kv_string("general.architecture", "llama")
            .build();
        let path = write_temp(&full[..full.len() - 6]);
        assert!(inspect(&path).is_err());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_optional_keys_yield_none_not_error() {
        let bytes = GgufBuilder::new().kv_string("general.architecture", "llama").build();
        let path = write_temp(&bytes);
        let info = inspect(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(info.block_count, None);
        assert_eq!(info.quant_label, None);
        assert!(!info.has_chat_template);
    }
}
