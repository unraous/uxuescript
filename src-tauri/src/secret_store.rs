//! Minimal Windows DPAPI storage for API keys.
//!
//! The key is still held in process memory while in use (it must be sent to the
//! provider), but it is no longer serialized as plaintext into config.toml.
//! DPAPI is bound to the current Windows user/profile. A copied config cannot
//! be decrypted by another user or on another machine; migration must keep a
//! backup and never overwrite a config that could not be decrypted.

use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

const PREFIX: &str = "dpapi:v1:";

pub fn protect(value: &str) -> Result<String> {
    let encrypted = win::protect(value.as_bytes())?;
    Ok(format!("{PREFIX}{}", STANDARD.encode(encrypted)))
}

/// Accept legacy plaintext values once so the next save can migrate them.
pub fn unprotect(value: &str) -> Result<String> {
    let Some(encoded) = value.strip_prefix(PREFIX) else {
        return Ok(value.to_owned());
    };
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| anyhow!("API Key 密文格式错误: {error}"))?;
    let plain = win::unprotect(&bytes)?;
    String::from_utf8(plain).map_err(|error| anyhow!("API Key 解密后不是 UTF-8: {error}"))
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    fn last_error(context: &str) -> anyhow::Error {
        let code = unsafe { GetLastError() };
        anyhow!("{context}失败（Win32 错误 {code}）")
    }

    unsafe fn free_blob(blob: &CRYPT_INTEGER_BLOB) {
        if !blob.pbData.is_null() {
            unsafe {
                LocalFree(blob.pbData.cast::<c_void>());
            }
        }
    }

    pub(super) fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(last_error("DPAPI 加密"));
        }
        let encrypted = unsafe {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        unsafe { free_blob(&output) };
        Ok(encrypted)
    }

    pub(super) fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(last_error("DPAPI 解密"));
        }
        let plain =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { free_blob(&output) };
        Ok(plain)
    }
}

#[cfg(all(not(windows), not(test)))]
mod win {
    use super::*;

    pub(super) fn protect(_plain: &[u8]) -> Result<Vec<u8>> {
        Err(anyhow!("DPAPI 仅在 Windows 上可用"))
    }

    pub(super) fn unprotect(_encrypted: &[u8]) -> Result<Vec<u8>> {
        Err(anyhow!("DPAPI 仅在 Windows 上可用"))
    }
}

/// Test-only fallback so the existing cross-platform test suite can exercise
/// config round-trips on CI. It is intentionally unavailable in non-test builds.
#[cfg(all(not(windows), test))]
mod win {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    pub(super) fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        Ok(STANDARD.encode(plain).into_bytes())
    }

    pub(super) fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
        let encoded = String::from_utf8(encrypted.to_vec())?;
        Ok(STANDARD.decode(encoded)?)
    }
}
