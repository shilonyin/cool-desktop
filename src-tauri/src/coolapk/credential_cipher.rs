//! 凭据文件的本地加密。
//!
//! 账号文件里有 `SESSID`/`token` 这类等价于登录态的明文凭据，直接落盘意味着
//! 任何能读到用户目录的进程都能冒用账号。这里用系统级密钥封装：
//!
//! - Windows：DPAPI（`CryptProtectData`），密钥绑定当前用户，不落盘
//! - macOS / Linux：暂不提供加密，调用方保留明文并记录告警
//!
//! 加密后文件首行是版本标记，解密时按标记分流，便于后续更换算法或迁移。

use serde_json::Value;

/// 加密文件的内容前缀，用于与旧明文文件区分。
const ENCRYPTED_PREFIX: &str = "COOLAPK-ENC-V1:";

/// 加密是否可用。不可用时调用方应保留明文写入并记录告警。
pub(crate) fn is_available() -> bool {
    cfg!(target_os = "windows")
}

/// 把明文 JSON 转成待落盘内容。
///
/// 返回 `None` 表示当前平台没有可用的系统密钥封装，调用方改写明文。
pub(crate) fn seal(plain: &str) -> Option<String> {
    let sealed = platform_seal(plain.as_bytes())?;
    use base64::Engine;
    Some(format!(
        "{ENCRYPTED_PREFIX}{}",
        base64::engine::general_purpose::STANDARD.encode(sealed)
    ))
}

/// 把落盘内容还原成明文 JSON。
///
/// 无形标记时按旧明文处理，保证升级后旧文件仍可读。
pub(crate) fn open(stored: &str) -> Option<String> {
    let Some(encoded) = stored.trim_start().strip_prefix(ENCRYPTED_PREFIX) else {
        return Some(stored.to_string());
    };
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let plain = platform_open(&bytes)?;
    String::from_utf8(plain).ok()
}

/// 读出账户库根对象，兼容加密与旧明文两种形态。
pub(crate) fn decode_accounts_root(stored: &str) -> Option<Value> {
    serde_json::from_str(&open(stored)?).ok()
}

#[cfg(target_os = "windows")]
fn platform_seal(plain: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .ok()?;
        let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData.cast())));
        Some(sealed)
    }
}

#[cfg(target_os = "windows")]
fn platform_open(sealed: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: sealed.len() as u32,
        pbData: sealed.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .ok()?;
        let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData.cast())));
        Some(plain)
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_seal(_plain: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(target_os = "windows"))]
fn platform_open(_sealed: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaintext_legacy_file_still_decodes() {
        let legacy = r#"{"lastLoginUid":"10086","accounts":[]}"#;
        assert_eq!(open(legacy).as_deref(), Some(legacy));
        assert!(decode_accounts_root(legacy).is_some());
    }

    #[test]
    fn rejects_corrupted_envelope_without_panicking() {
        assert!(open("COOLAPK-ENC-V1:not-base64!!").is_none());
        // 合法 base64 但不是本机密钥封装的密文，必须解不开而不是返回垃圾数据。
        assert!(open("COOLAPK-ENC-V1:YWJjZGVm").is_none());
    }

    #[test]
    fn roundtrip_matches_platform_capability() {
        let plain = r#"{"accounts":[{"uid":"10086","cookie":"SESSID=secret"}]}"#;
        match seal(plain) {
            Some(sealed) => {
                assert!(sealed.starts_with(ENCRYPTED_PREFIX));
                // 密文里不能出现明文凭据，否则加密没有意义。
                assert!(!sealed.contains("SESSID=secret"));
                assert_eq!(open(&sealed).as_deref(), Some(plain));
            }
            None => {
                // 非 Windows 平台按设计不加密，调用方走明文分支。
                assert!(!is_available());
            }
        }
    }

    #[test]
    fn encryption_availability_matches_implementation() {
        assert_eq!(is_available(), cfg!(target_os = "windows"));
    }
}
