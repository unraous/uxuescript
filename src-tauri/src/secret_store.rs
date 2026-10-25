//! Windows DPAPI storage for API keys.
//!
//! The key remains in process memory while a request is made, but config.toml
//! stores only a current-user DPAPI ciphertext. The FFI and base64 codec are
//! declared directly so the protected dependency manifests do not need a new
//! crate.

use anyhow::{anyhow, Result};

const PREFIX: &str = "dpapi:v1:";
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(input: &[u8]) -> String {
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let value = (b0 << 16) | (b1 << 8) | b2;
        output.push(BASE64[((value >> 18) & 0x3f) as usize] as char);
        output.push(BASE64[((value >> 12) & 0x3f) as usize] as char);
        output.push(if chunk.len() > 1 {
            BASE64[((value >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            BASE64[(value & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

fn decode_base64(input: &str) -> Result<Vec<u8>> {
    let bytes = input.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(anyhow!("API Key 密文的 base64 长度无效"));
    }
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let mut value = 0u32;
        let mut padding = 0usize;
        for byte in chunk {
            let digit = match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' => {
                    padding += 1;
                    0
                }
                _ => return Err(anyhow!("API Key 密文包含非法 base64 字符")),
            };
            value = (value << 6) | u32::from(digit);
        }
        output.push(((value >> 16) & 0xff) as u8);
        if padding < 2 {
            output.push(((value >> 8) & 0xff) as u8);
        }
        if padding == 0 {
            output.push((value & 0xff) as u8);
        }
    }
    Ok(output)
}

pub fn protect(value: &str) -> Result<String> {
    let encrypted = win::protect(value.as_bytes())?;
    Ok(format!("{PREFIX}{}", encode_base64(&encrypted)))
}

/// Accept legacy plaintext values once so the next save can migrate them.
pub fn unprotect(value: &str) -> Result<String> {
    let Some(encoded) = value.strip_prefix(PREFIX) else {
        return Ok(value.to_owned());
    };
    let bytes = decode_base64(encoded)?;
    let plain = win::unprotect(&bytes)?;
    String::from_utf8(plain).map_err(|error| anyhow!("API Key 解密后不是 UTF-8: {error}"))
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct CryptIntegerBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            data_in: *const CryptIntegerBlob,
            data_descr: *const u16,
            optional_entropy: *const CryptIntegerBlob,
            reserved: *const c_void,
            prompt: *const c_void,
            flags: u32,
            data_out: *mut CryptIntegerBlob,
        ) -> i32;
        fn CryptUnprotectData(
            data_in: *const CryptIntegerBlob,
            data_descr: *mut *mut u16,
            optional_entropy: *const CryptIntegerBlob,
            reserved: *const c_void,
            prompt: *const c_void,
            flags: u32,
            data_out: *mut CryptIntegerBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLastError() -> u32;
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    fn last_error(context: &str) -> anyhow::Error {
        let code = unsafe { GetLastError() };
        anyhow!("{context}失败（Win32 错误 {code}）")
    }

    unsafe fn free_blob(blob: &CryptIntegerBlob) {
        if !blob.pb_data.is_null() {
            unsafe {
                LocalFree(blob.pb_data.cast::<c_void>());
            }
        }
    }

    pub(super) fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        let input = CryptIntegerBlob {
            cb_data: plain.len() as u32,
            pb_data: plain.as_ptr() as *mut u8,
        };
        let mut output = CryptIntegerBlob {
            cb_data: 0,
            pb_data: null_mut(),
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
        let encrypted =
            unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
        unsafe { free_blob(&output) };
        Ok(encrypted)
    }

    pub(super) fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
        let input = CryptIntegerBlob {
            cb_data: encrypted.len() as u32,
            pb_data: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CryptIntegerBlob {
            cb_data: 0,
            pb_data: null_mut(),
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
            unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
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

#[cfg(all(not(windows), test))]
mod win {
    use super::*;

    pub(super) fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        Ok(plain.to_vec())
    }

    pub(super) fn unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
        Ok(encrypted.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip_handles_padding() {
        for value in [b"".as_slice(), b"a", b"ab", b"abc", b"abcd"] {
            assert_eq!(decode_base64(&encode_base64(value)).unwrap(), value);
        }
    }
}
