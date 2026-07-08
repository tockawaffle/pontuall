use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::app_flavor::DEFAULT_SIDECAR_PORT;
use crate::auth::guard;
use crate::auth::permissions::PermissionAction;
use crate::db::error::DbError;
use crate::db::{keyring_get, keyring_set};

pub(crate) const KEYRING_SIDECAR_PORT: &str = "sidecar_port";
pub(crate) const KEYRING_PUBLIC_URL: &str = "public_url";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdvancedConfigDto {
    pub port: u16,
    pub public_url: String,
}

/// Port the auth sidecar should listen on. Stable so e-mailed password links
/// keep working across restarts.
pub(crate) fn configured_port() -> u16 {
    keyring_get(KEYRING_SIDECAR_PORT)
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_SIDECAR_PORT)
}

/// Base URL for e-mailed links (domain / reverse proxy). `None` means the
/// sidecar falls back to the machine's auto-detected LAN address.
pub(crate) fn configured_public_url() -> Option<String> {
    let value = keyring_get(KEYRING_PUBLIC_URL).ok()?;
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub(crate) fn get_advanced_config_cmd() -> AdvancedConfigDto {
    AdvancedConfigDto {
        port: configured_port(),
        public_url: configured_public_url().unwrap_or_default(),
    }
}

#[tauri::command]
pub(crate) async fn set_advanced_config_cmd(
    app: AppHandle,
    port: u16,
    public_url: String,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    if port < 1024 {
        return Err(DbError::InvalidInput(
            "a porta deve ser 1024 ou maior".into(),
        ));
    }
    let public_url = public_url.trim().trim_end_matches('/').to_string();
    if !public_url.is_empty()
        && !public_url.starts_with("http://")
        && !public_url.starts_with("https://")
    {
        return Err(DbError::InvalidInput(
            "o endereço público deve começar com http:// ou https://".into(),
        ));
    }

    keyring_set(KEYRING_SIDECAR_PORT, &port.to_string())?;
    keyring_set(KEYRING_PUBLIC_URL, &public_url)?;
    Ok(true)
}
