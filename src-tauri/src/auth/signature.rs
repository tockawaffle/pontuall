//! Authenticode check of the sidecar executable before it is spawned.
//!
//! The build embeds the SHA-256 fingerprint of our code-signing certificate
//! (src-tauri/signing/cert-fingerprint.txt). At startup we verify that the
//! sidecar's signature is cryptographically intact and was produced by that
//! exact certificate. Trust comes from the pinned fingerprint, not from the
//! Windows root store, so a self-signed certificate works — untrusted-root
//! and expired-certificate chain statuses are accepted on purpose.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::Security::WinTrust::{
    WinVerifyTrust, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WINTRUST_DATA,
    WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
    WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};

use crate::auth::error::AuthError;

/// Set by build.rs; `None` when the build machine had no signing setup.
const PINNED_CERT_SHA256: Option<&str> = option_env!("PONTUALL_SIDECAR_CERT_SHA256");

/// WINTRUST_ACTION_GENERIC_VERIFY_V2 (softpub.h).
const ACTION_GENERIC_VERIFY_V2: GUID = GUID::from_u128(0x00aac56b_cd44_11d0_8cc2_00c04fc295ee);

// Chain statuses that are fine for a pinned self-signed certificate.
const CERT_E_UNTRUSTEDROOT: i32 = 0x800B0109u32 as i32;
const CERT_E_EXPIRED: i32 = 0x800B0101u32 as i32;
const TRUST_E_NOSIGNATURE: i32 = 0x800B0100u32 as i32;

fn sidecar_path() -> Result<PathBuf, AuthError> {
    let exe = std::env::current_exe()
        .map_err(|e| AuthError::Internal(format!("could not resolve executable path: {e}")))?;
    Ok(exe
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("pontuall-auth.exe"))
}

/// Refuses to continue when the sidecar on disk is unsigned, tampered with,
/// or signed by a certificate other than the pinned one.
pub(crate) fn verify_sidecar() -> Result<(), AuthError> {
    let Some(pinned) = PINNED_CERT_SHA256 else {
        eprintln!(
            "[auth] WARNING: built without a signing certificate; \
             sidecar signature verification is disabled"
        );
        return Ok(());
    };
    let path = sidecar_path()?;
    let signer = signer_cert_sha256(&path)?;
    if signer.eq_ignore_ascii_case(pinned) {
        Ok(())
    } else {
        Err(AuthError::SidecarUnavailable(format!(
            "o executável de autenticação foi assinado por um certificado desconhecido \
             ({signer}); reinstale o aplicativo"
        )))
    }
}

/// Validates the file's Authenticode signature and returns the SHA-256
/// fingerprint of the signing certificate.
fn signer_cert_sha256(path: &Path) -> Result<String, AuthError> {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut file_info: WINTRUST_FILE_INFO = std::mem::zeroed();
        file_info.cbStruct = std::mem::size_of::<WINTRUST_FILE_INFO>() as u32;
        file_info.pcwszFilePath = PCWSTR(wide.as_ptr());

        let mut data: WINTRUST_DATA = std::mem::zeroed();
        data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
        data.dwUIChoice = WTD_UI_NONE;
        data.fdwRevocationChecks = WTD_REVOKE_NONE;
        data.dwUnionChoice = WTD_CHOICE_FILE;
        data.Anonymous = WINTRUST_DATA_0 {
            pFile: &mut file_info,
        };
        data.dwStateAction = WTD_STATEACTION_VERIFY;

        let mut action = ACTION_GENERIC_VERIFY_V2;
        let status = WinVerifyTrust(
            HWND::default(),
            &mut action,
            &mut data as *mut _ as *mut c_void,
        );
        let result = match status {
            0 | CERT_E_UNTRUSTEDROOT | CERT_E_EXPIRED => extract_signer_fingerprint(&data),
            TRUST_E_NOSIGNATURE => Err(AuthError::SidecarUnavailable(
                "o executável de autenticação não está assinado; reinstale o aplicativo".into(),
            )),
            other => Err(AuthError::SidecarUnavailable(format!(
                "a assinatura do executável de autenticação é inválida (código {other:#010x}); \
                 reinstale o aplicativo"
            ))),
        };

        data.dwStateAction = WTD_STATEACTION_CLOSE;
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            &mut data as *mut _ as *mut c_void,
        );
        result
    }
}

unsafe fn extract_signer_fingerprint(data: &WINTRUST_DATA) -> Result<String, AuthError> {
    let corrupt =
        || AuthError::SidecarUnavailable("assinatura do executável de autenticação ilegível".into());
    let provider = WTHelperProvDataFromStateData(data.hWVTStateData);
    if provider.is_null() {
        return Err(corrupt());
    }
    let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
    if signer.is_null() || (*signer).csCertChain == 0 || (*signer).pasCertChain.is_null() {
        return Err(corrupt());
    }
    // First entry in the chain is the leaf certificate that signed the file.
    let cert = (*(*signer).pasCertChain).pCert;
    if cert.is_null() {
        return Err(corrupt());
    }
    let der = std::slice::from_raw_parts((*cert).pbCertEncoded, (*cert).cbCertEncoded as usize);
    Ok(hex::encode(Sha256::digest(der)))
}
