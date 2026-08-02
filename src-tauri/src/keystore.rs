//! AI 配置的加密落盘（路线图 A3：API Key 迁出 localStorage）。
//!
//! 前端把**整份** AI 配置 JSON（含各服务商 API Key 与搜索 Key）交给
//! [`keystore_save`]，加密后写进 `app_config_dir()/ai-config.dat`；
//! [`keystore_load`] 读回解密。localStorage 从此只是浏览器调试模式与降级路径。
//!
//! 文件格式：**第 1 个字节是加密方式标记**，其余是该方式的载荷——
//!
//! | 标记 | 方式 | 载荷 |
//! |---|---|---|
//! | `D` | Windows DPAPI（当前用户绑定） | `CryptProtectData` 的密文 |
//! | `K` | macOS Keychain | 空（真身在钥匙串里，文件只是"已配置"的标记） |
//! | `P` | 明文降级（其他平台，unix 下 0600） | UTF-8 JSON 原文 |
//!
//! load 按标记解，而不是按当前平台猜：明文文件被拷到别的机器上仍然读得回来。
//! 解密失败统一返回 `Err("keystore_corrupt")`，前端据此**不覆盖坏文件**、
//! 回退读 localStorage 备份并亮出降级提示。
//!
//! 写入沿用 notes.rs 的原子写（temp + rename）：半截密文比半截笔记更糟——
//! 它必然解不开，会把一份好配置整个变成 `keystore_corrupt`。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "ai-config.dat";

const TAG_DPAPI: u8 = b'D';
#[cfg(target_os = "macos")]
const TAG_KEYCHAIN: u8 = b'K';
const TAG_PLAIN: u8 = b'P';

/// 配置 JSON 的体量上限。整份配置不过几十 KB，超过它多半是调用方传错了东西。
const MAX_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "app.spoor.ai-config";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "default";

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_config_dir: {e}"))?;
    Ok(dir)
}

// ───────────────────────────── 平台加解密 ─────────────────────────────

#[cfg(windows)]
fn dpapi_encrypt(payload: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: payload.len() as u32,
        pbData: payload.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("dpapi_protect: {e}"))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn dpapi_decrypt(cipher: &[u8]) -> Result<String, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB {
        cbData: cipher.len() as u32,
        pbData: cipher.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        // 解不开（文件损坏 / 换了 Windows 账户）一律 keystore_corrupt，
        // 让前端走「不覆盖坏文件 + localStorage 备份」的回退，而不是弹一串系统错误码
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|_| "keystore_corrupt".to_string())?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        String::from_utf8(bytes).map_err(|_| "keystore_corrupt".to_string())
    }
}

#[cfg(target_os = "macos")]
fn keychain_store(payload: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        KEYCHAIN_SERVICE,
        KEYCHAIN_ACCOUNT,
        payload.as_bytes(),
    )
    .map_err(|e| format!("keychain_set: {e}"))
}

#[cfg(target_os = "macos")]
fn keychain_load() -> Result<String, String> {
    let bytes =
        security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            // 文件标记说钥匙串里有，钥匙串却拿不出来（条目被删/权限被拒）——按损坏处理
            .map_err(|_| "keystore_corrupt".to_string())?;
    String::from_utf8(bytes).map_err(|_| "keystore_corrupt".to_string())
}

/// 明文降级编码。独立成函数是为了在任何平台都能测这条路径
/// （Windows/macOS 的正式构建走不到它，只有单测在用）。
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn encode_plain(payload: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(1 + payload.len());
    bytes.push(TAG_PLAIN);
    bytes.extend_from_slice(payload.as_bytes());
    bytes
}

/// 按当前平台选择加密方式，产出「标记字节 + 载荷」。
fn encode(payload: &str) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let mut bytes = vec![TAG_DPAPI];
        bytes.extend_from_slice(&dpapi_encrypt(payload.as_bytes())?);
        Ok(bytes)
    }
    #[cfg(target_os = "macos")]
    {
        // 真身进钥匙串，文件只留标记：`load` 靠它区分「没配置过」与「该去钥匙串取」
        keychain_store(payload)?;
        Ok(vec![TAG_KEYCHAIN])
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(encode_plain(payload))
    }
}

/// 按文件头标记解码。认不出的标记（新版本写的 / 文件被啃）一律 `keystore_corrupt`。
fn decode(bytes: &[u8]) -> Result<String, String> {
    let Some((&tag, body)) = bytes.split_first() else {
        return Err("keystore_corrupt".into());
    };
    match tag {
        TAG_PLAIN => String::from_utf8(body.to_vec()).map_err(|_| "keystore_corrupt".to_string()),
        #[cfg(windows)]
        TAG_DPAPI => dpapi_decrypt(body),
        #[cfg(not(windows))]
        // DPAPI 密文只在写它的那台 Windows 上解得开，拿到别的平台必然是废文件
        TAG_DPAPI => Err("keystore_corrupt".into()),
        #[cfg(target_os = "macos")]
        TAG_KEYCHAIN => keychain_load(),
        _ => Err("keystore_corrupt".into()),
    }
}

// ───────────────────────────── 落盘 ─────────────────────────────

/// 原子写：与 notes.rs 同一套 temp + rename。unix 下先把临时文件收紧到 0600
/// 再 rename——权限跟着文件走，目标位置不会出现过一瞬间的宽权限明文。
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = target.with_extension("dat.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("write_tmp: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod_tmp: {e}"))?;
    }
    // Windows 上 rename 到已存在目标会失败，先删旧的；两步之间崩溃的窗口极小，
    // 且 .tmp 仍在，下一次写入会覆盖——不会出现「新旧都没了」。
    if target.exists() {
        fs::remove_file(target).map_err(|e| format!("replace_old: {e}"))?;
    }
    fs::rename(&tmp, target).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// 目录注入的核心实现，单测不需要 AppHandle。
fn save_to_dir(dir: &Path, payload: &str) -> Result<(), String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("payload_too_large".into());
    }
    let bytes = encode(payload)?;
    write_atomic(&dir.join(FILE_NAME), &bytes)
}

fn load_from_dir(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("read: {e}"))?;
    decode(&bytes).map(Some)
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 把整份 AI 配置 JSON 加密写盘。payload 内容对本模块不透明——它只管保管，不管结构。
#[tauri::command]
pub fn keystore_save(app: AppHandle, payload: String) -> Result<(), String> {
    save_to_dir(&config_dir(&app)?, &payload)
}

/// 读回解密。文件不存在返回 `None`（首启 / 从未迁移）；解密失败 `Err("keystore_corrupt")`。
#[tauri::command]
pub fn keystore_load(app: AppHandle) -> Result<Option<String>, String> {
    load_from_dir(&config_dir(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例独享一个临时目录，测完删掉。
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spoor-keystore-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let dir = temp_dir("missing");
        assert_eq!(load_from_dir(&dir), Ok(None));
        let _ = fs::remove_dir_all(&dir);
    }

    /// 明文降级路径在任何平台都必须能读回：标记 'P' 的文件不依赖任何系统设施。
    #[test]
    fn plain_tag_roundtrip_on_any_platform() {
        let dir = temp_dir("plain");
        let payload = r#"{"version":2,"providers":[{"apiKey":"sk-测试"}]}"#;
        write_atomic(&dir.join(FILE_NAME), &encode_plain(payload)).unwrap();
        assert_eq!(load_from_dir(&dir), Ok(Some(payload.to_string())));
        // 原子写不留 .tmp 残骸
        assert!(!dir.join(format!("{FILE_NAME}.tmp")).exists());
        assert!(!dir.join("ai-config.dat.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_file_is_corrupt() {
        let dir = temp_dir("empty");
        fs::write(dir.join(FILE_NAME), b"").unwrap();
        assert_eq!(load_from_dir(&dir), Err("keystore_corrupt".into()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_tag_is_corrupt() {
        let dir = temp_dir("unknown");
        fs::write(dir.join(FILE_NAME), b"Zwhatever").unwrap();
        assert_eq!(load_from_dir(&dir), Err("keystore_corrupt".into()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_plain_utf8_is_corrupt() {
        let dir = temp_dir("badutf8");
        fs::write(dir.join(FILE_NAME), [TAG_PLAIN, 0xFF, 0xFE]).unwrap();
        assert_eq!(load_from_dir(&dir), Err("keystore_corrupt".into()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrite_replaces_previous_content() {
        let dir = temp_dir("overwrite");
        write_atomic(&dir.join(FILE_NAME), &encode_plain("old")).unwrap();
        write_atomic(&dir.join(FILE_NAME), &encode_plain("new")).unwrap();
        assert_eq!(load_from_dir(&dir), Ok(Some("new".to_string())));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_payload_is_rejected() {
        let dir = temp_dir("oversize");
        let huge = "x".repeat(MAX_PAYLOAD_BYTES + 1);
        assert_eq!(save_to_dir(&dir, &huge), Err("payload_too_large".into()));
        assert!(!dir.join(FILE_NAME).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// DPAPI 全链路：save（加密）→ load（解密）。只有 Windows 能跑，
    /// 密文绑定当前用户，roundtrip 在同一进程里自然满足。
    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let dir = temp_dir("dpapi");
        let payload = r#"{"version":2,"providers":[{"apiKey":"sk-secret-密钥"}]}"#;
        save_to_dir(&dir, payload).unwrap();

        // 文件头必须是 DPAPI 标记，且正文不含明文密钥
        let raw = fs::read(dir.join(FILE_NAME)).unwrap();
        assert_eq!(raw[0], TAG_DPAPI);
        assert!(!String::from_utf8_lossy(&raw).contains("sk-secret"));

        assert_eq!(load_from_dir(&dir), Ok(Some(payload.to_string())));
        let _ = fs::remove_dir_all(&dir);
    }

    /// DPAPI 密文被截断 → 解密失败必须映射为 keystore_corrupt。
    #[cfg(windows)]
    #[test]
    fn dpapi_truncated_cipher_is_corrupt() {
        let dir = temp_dir("dpapi-trunc");
        save_to_dir(&dir, "{\"v\":2}").unwrap();
        let mut raw = fs::read(dir.join(FILE_NAME)).unwrap();
        raw.truncate(raw.len() / 2);
        fs::write(dir.join(FILE_NAME), &raw).unwrap();
        assert_eq!(load_from_dir(&dir), Err("keystore_corrupt".into()));
        let _ = fs::remove_dir_all(&dir);
    }
}
