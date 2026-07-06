use serde::{Deserialize, Serialize};

use crate::db::error::DbError;
use crate::db::{keyring_get, keyring_set};

pub(crate) const KEYRING_SMTP_CONFIG: &str = "smtp_config";
pub(crate) const KEYRING_MANUAL_PUNCH: &str = "manual_punch_enabled";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SmtpConfigDto {
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub user: String,
    pub pass: String,
    pub from: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SmtpConfigPublic {
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub user: String,
    pub from: String,
    pub configured: bool,
}

impl SmtpConfigDto {
    pub(crate) fn to_public(&self) -> SmtpConfigPublic {
        SmtpConfigPublic {
            host: self.host.clone(),
            port: self.port,
            secure: self.secure,
            user: self.user.clone(),
            from: self.from.clone(),
            configured: !self.host.is_empty() && !self.from.is_empty() && !self.pass.is_empty(),
        }
    }
}

pub(crate) fn get_smtp_config() -> Result<Option<SmtpConfigDto>, DbError> {
    let Ok(raw) = keyring_get(KEYRING_SMTP_CONFIG) else {
        return Ok(None);
    };
    let config: SmtpConfigDto = serde_json::from_str(&raw)
        .map_err(|e| DbError::Config(format!("invalid SMTP config: {e}")))?;
    Ok(Some(config))
}

pub(crate) fn set_smtp_config(config: &SmtpConfigDto) -> Result<(), DbError> {
    let raw = serde_json::to_string(config)
        .map_err(|e| DbError::Config(format!("could not serialize SMTP config: {e}")))?;
    keyring_set(KEYRING_SMTP_CONFIG, &raw)
}

pub(crate) fn is_manual_punch_enabled() -> bool {
    keyring_get(KEYRING_MANUAL_PUNCH)
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

pub(crate) fn set_manual_punch_enabled(enabled: bool) -> Result<(), DbError> {
    keyring_set(
        KEYRING_MANUAL_PUNCH,
        if enabled { "true" } else { "false" },
    )
}

pub(crate) fn smtp_is_configured() -> bool {
    get_smtp_config()
        .ok()
        .flatten()
        .map(|c| !c.host.is_empty() && !c.from.is_empty() && !c.pass.is_empty())
        .unwrap_or(false)
}
