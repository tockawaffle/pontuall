use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::auth::guard;
use crate::auth::AuthState;
use crate::db::error::DbError;
use crate::auth::permissions::PermissionAction;
use crate::db::repo::{employees, punch_audit};
use crate::db::DbState;
use crate::misc::smtp::{
    get_smtp_config, is_manual_punch_enabled, set_manual_punch_enabled, set_smtp_config,
    smtp_is_configured, SmtpConfigDto, SmtpConfigPublic,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualPunchStatus {
    pub enabled: bool,
    pub smtp_configured: bool,
    pub available: bool,
}

#[tauri::command]
pub(crate) fn get_manual_punch_status() -> ManualPunchStatus {
    let enabled = is_manual_punch_enabled();
    let smtp_configured = smtp_is_configured();
    ManualPunchStatus {
        enabled,
        smtp_configured,
        available: enabled && smtp_configured,
    }
}

#[tauri::command]
pub(crate) async fn set_manual_punch_enabled_cmd(
    app: AppHandle,
    enabled: bool,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;
    set_manual_punch_enabled(enabled)?;
    Ok(enabled)
}

#[tauri::command]
pub(crate) fn get_smtp_config_cmd() -> Result<Option<SmtpConfigPublic>, DbError> {
    Ok(get_smtp_config()?.map(|c| c.to_public()))
}

#[tauri::command]
pub(crate) async fn set_smtp_config_cmd(
    app: AppHandle,
    host: String,
    port: u16,
    secure: bool,
    user: String,
    pass: String,
    from: String,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    let existing_pass = get_smtp_config()?
        .map(|c| c.pass)
        .unwrap_or_default();
    let pass = if pass.trim().is_empty() {
        existing_pass
    } else {
        pass
    };

    let config = SmtpConfigDto {
        host: host.trim().to_string(),
        port,
        secure,
        user: user.trim().to_string(),
        pass,
        from: from.trim().to_string(),
    };
    set_smtp_config(&config)?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn test_smtp_config_cmd(
    app: AppHandle,
    to: String,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    let smtp = get_smtp_config()?.ok_or_else(|| {
        DbError::InvalidInput("configure o SMTP antes de testar".into())
    })?;

    let auth = app.state::<AuthState>();
    auth.test_smtp(&smtp, &to)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn request_punch_otp(
    app: AppHandle,
    email: String,
) -> Result<bool, DbError> {
    if !is_manual_punch_enabled() {
        return Err(DbError::InvalidInput(
            "ponto sem cartão está desativado".into(),
        ));
    }

    let smtp = get_smtp_config()?.ok_or_else(|| {
        DbError::InvalidInput("servidor de e-mail não configurado".into())
    })?;

    let normalized = email.trim().to_lowercase();
    if normalized.is_empty() || !normalized.contains('@') {
        return Err(DbError::InvalidInput("informe um e-mail válido".into()));
    }

    let state = app.state::<DbState>();
    let employee = employees::find_local_by_email(&state.lite, &normalized)
        .await?
        .ok_or_else(|| DbError::NotFound("funcionário".into()))?;

    if employee.auth_user_id.is_none() {
        punch_audit::log_event(
            &state.lite,
            Some(&employee.id),
            Some(&normalized),
            "otp_request_denied",
            false,
            Some("sem conta de acesso"),
        )
        .await?;
        return Err(DbError::InvalidInput(
            "este funcionário não possui conta de acesso".into(),
        ));
    }

    punch_audit::ensure_can_request_otp(&state.lite, &employee.id).await?;

    let auth = app.state::<AuthState>();
    auth.send_punch_otp(
        employee.auth_user_id.as_deref().unwrap(),
        &normalized,
        &employee.name,
        &smtp,
    )
    .await
    .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    punch_audit::log_event(
        &state.lite,
        Some(&employee.id),
        Some(&normalized),
        "otp_sent",
        true,
        None,
    )
    .await?;

    Ok(true)
}

#[tauri::command]
pub(crate) async fn verify_punch_otp(
    app: AppHandle,
    email: String,
    code: String,
) -> Result<String, DbError> {
    if !is_manual_punch_enabled() {
        return Err(DbError::InvalidInput(
            "ponto sem cartão está desativado".into(),
        ));
    }

    let normalized = email.trim().to_lowercase();
    let code = code.trim();
    if normalized.is_empty() || code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(DbError::InvalidInput("código inválido".into()));
    }

    let state = app.state::<DbState>();
    let employee = employees::find_local_by_email(&state.lite, &normalized)
        .await?
        .ok_or_else(|| DbError::NotFound("funcionário".into()))?;

    let auth_user_id = employee
        .auth_user_id
        .as_deref()
        .ok_or_else(|| DbError::InvalidInput("funcionário sem conta de acesso".into()))?;

    punch_audit::ensure_can_verify_otp(&state.lite, &employee.id).await?;

    let auth = app.state::<AuthState>();
    match auth.verify_punch_otp(auth_user_id, code).await {
        Ok(()) => {
            punch_audit::log_event(
                &state.lite,
                Some(&employee.id),
                Some(&normalized),
                "otp_verified",
                true,
                None,
            )
            .await?;
            Ok(employee.id)
        }
        Err(e) => {
            punch_audit::log_event(
                &state.lite,
                Some(&employee.id),
                Some(&normalized),
                "otp_verify_failed",
                false,
                Some(&e.to_string()),
            )
            .await?;
            Err(DbError::InvalidInput(e.to_string()))
        }
    }
}
