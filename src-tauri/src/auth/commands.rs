use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::auth::client::AuthUserDto;
use crate::auth::error::AuthError;
use crate::auth::{guard, sidecar, AuthState, UserLoggedDto};
use crate::db::models::Employee;
use crate::db::repo::employees;
use crate::db::{connect_postgres, keyring_get, DbState, KEYRING_APP_NAME, KEYRING_PG_URI};

/// Connects Postgres from the stored configuration and starts the auth
/// sidecar. Called right after the database setup step so the first-admin
/// step can create an account; also safe to call on every boot.
#[tauri::command]
pub(crate) async fn start_backend_services(app: AppHandle) -> Result<(), AuthError> {
    let db = app.state::<DbState>();

    if db.pg.read().await.is_none() {
        let uri = keyring_get(KEYRING_PG_URI)?;
        let app_name = keyring_get(KEYRING_APP_NAME)?;
        let pool = connect_postgres(&uri, &app_name).await?;
        *db.pg.write().await = Some(pool);
    }
    db.is_online
        .store(true, std::sync::atomic::Ordering::SeqCst);

    sidecar::start(&app).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn auth_sign_in(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<UserLoggedDto, AuthError> {
    let auth = app.state::<AuthState>();
    let (session_token, _auth_user_id) = auth.sign_in_email(&email, &password).await?;

    let (user, _) = guard::resolve_session(&app, &session_token).await?;
    auth.set_current_session(session_token).await;
    Ok(user)
}

/// Restores the user for the backend-held session, or fails with
/// `invalid_session` (e.g. after an app restart, when no session is held).
#[tauri::command]
pub(crate) async fn auth_current_user(app: AppHandle) -> Result<UserLoggedDto, AuthError> {
    match guard::resolve_current(&app).await {
        Ok((user, _)) => Ok(user),
        Err(e) => {
            // Drop a stale/invalid token so the app settles on the guest state.
            app.state::<AuthState>().take_current_session().await;
            Err(e)
        }
    }
}

#[tauri::command]
pub(crate) async fn auth_sign_out(app: AppHandle) -> Result<(), AuthError> {
    let auth = app.state::<AuthState>();
    if let Some(token) = auth.take_current_session().await {
        auth.sign_out(&token).await?;
        auth.session_cache.lock().await.remove(&token);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn auth_change_password(
    app: AppHandle,
    current_password: String,
    new_password: String,
) -> Result<(), AuthError> {
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    auth.change_password(&token, &current_password, &new_password)
        .await
}

#[tauri::command]
pub(crate) async fn auth_has_admin(state: State<'_, DbState>) -> Result<bool, AuthError> {
    Ok(employees::has_login_account(&state).await?)
}

/// One-time creation of the first administrator; refuses once any employee
/// has a linked login.
#[tauri::command]
pub(crate) async fn auth_bootstrap_admin(
    app: AppHandle,
    name: String,
    email: String,
    password: String,
    role: String,
) -> Result<UserLoggedDto, AuthError> {
    let db = app.state::<DbState>();
    if employees::has_login_account(&db).await? {
        return Err(AuthError::Conflict(
            "já existe um administrador configurado".into(),
        ));
    }

    let auth = app.state::<AuthState>();
    let (mut session_token, auth_user_id) = auth.sign_up_email(&name, &email, &password).await?;
    auth.promote_auth_admin(&auth_user_id).await?;

    let now = Utc::now();
    let employee = Employee {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.clone(),
        email: Some(email.clone()),
        phone: None,
        role,
        lunch_time: None,
        status: "active".to_string(),
        auth_user_id: Some(auth_user_id),
        terminated_at: None,
        created_at: now,
        updated_at: now,
    };
    employees::upsert(&db, &employee).await?;

    if session_token.is_empty() {
        let (token, _) = auth.sign_in_email(&email, &password).await?;
        session_token = token;
    }

    let (user, _) = guard::resolve_session(&app, &session_token).await?;
    auth.set_current_session(session_token).await;
    Ok(user)
}

/// Random placeholder password for accounts whose real password is chosen by
/// the employee through the e-mailed one-time link. Never shown to anyone.
fn random_password() -> String {
    let mut bytes = [0u8; 24];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    hex::encode(bytes)
}

fn smtp_config_required() -> Result<crate::misc::smtp::SmtpConfigDto, AuthError> {
    crate::misc::smtp::get_smtp_config()
        .map_err(|e| AuthError::Internal(e.to_string()))?
        .filter(|c| !c.host.is_empty() && !c.from.is_empty() && !c.pass.is_empty())
        .ok_or_else(|| {
            AuthError::Internal(
                "configure o servidor de e-mail (SMTP) em Configurações antes de enviar links de senha".into(),
            )
        })
}

/// Admin action: gives an existing employee a login account. The admin never
/// chooses the password — the employee receives a one-time e-mail link and
/// sets it themselves.
#[tauri::command]
pub(crate) async fn auth_create_account(
    app: AppHandle,
    employee_id: String,
    email: String,
    access_level: String,
) -> Result<(), AuthError> {
    let actor = guard::require_auth_admin_current(&app).await?;

    let ba_role = match access_level.as_str() {
        "employee" | "supervisor" | "administrator" => access_level.as_str(),
        other => {
            return Err(AuthError::Internal(format!(
                "perfil inválido: {other}"
            )))
        }
    };

    let smtp = smtp_config_required()?;

    let db = app.state::<DbState>();
    let mut employee = employees::find_local(&db.lite, &employee_id)
        .await?
        .ok_or_else(|| AuthError::Internal("funcionário não encontrado".into()))?;
    if employee.auth_user_id.is_some() {
        return Err(AuthError::Conflict(
            "este funcionário já possui uma conta de acesso".into(),
        ));
    }

    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    let auth_user_id = auth
        .admin_create_user(
            &token,
            &employee.name,
            &email,
            &random_password(),
            ba_role,
        )
        .await?;

    employee.auth_user_id = Some(auth_user_id);
    employee.email = Some(email.clone());
    employee.updated_at = Utc::now();
    employees::upsert(&db, &employee).await?;

    auth.send_password_setup(&email, &smtp, Some(&actor)).await.map_err(|e| {
        AuthError::Internal(format!(
            "conta criada, mas o e-mail com o link de senha falhou ({e}) — use \"Enviar link de senha\" na aba Logins"
        ))
    })?;
    Ok(())
}

/// Admin action: e-mails the account holder a one-time link to (re)define
/// their password. Replaces the old flow where the admin typed a new password.
#[tauri::command]
pub(crate) async fn auth_admin_send_password_reset(
    app: AppHandle,
    email: String,
) -> Result<(), AuthError> {
    let actor = guard::require_auth_admin_current(&app).await?;
    let smtp = smtp_config_required()?;
    let auth = app.state::<AuthState>();
    auth.send_password_setup(email.trim(), &smtp, Some(&actor))
        .await
}

/// Admin-only view of the append-only auth audit trail.
#[tauri::command]
pub(crate) async fn auth_audit_list(
    app: AppHandle,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<serde_json::Value, AuthError> {
    guard::require_auth_admin_current(&app).await?;
    let auth = app.state::<AuthState>();
    auth.audit_list(limit.unwrap_or(50), offset.unwrap_or(0))
        .await
}

/// Recomputes the audit hash chain to prove the trail was not tampered with.
#[tauri::command]
pub(crate) async fn auth_audit_verify(app: AppHandle) -> Result<serde_json::Value, AuthError> {
    guard::require_auth_admin_current(&app).await?;
    let auth = app.state::<AuthState>();
    auth.audit_verify().await
}

#[derive(Debug, Serialize)]
pub(crate) struct AuthUserListResult {
    pub users: Vec<AuthUserDto>,
    pub total: u64,
}

#[tauri::command]
pub(crate) async fn auth_admin_list_users(
    app: AppHandle,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<AuthUserListResult, AuthError> {
    guard::require_auth_admin_current(&app).await?;
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    let (users, total) = auth
        .admin_list_users(&token, limit.unwrap_or(100), offset.unwrap_or(0))
        .await?;
    Ok(AuthUserListResult { users, total })
}

#[tauri::command]
pub(crate) async fn auth_admin_set_role(
    app: AppHandle,
    user_id: String,
    role: String,
) -> Result<(), AuthError> {
    guard::require_auth_admin_current(&app).await?;

    let ba_role = match role.as_str() {
        "employee" | "supervisor" | "administrator" => role.as_str(),
        other => {
            return Err(AuthError::Internal(format!(
                "perfil inválido: {other}"
            )))
        }
    };

    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    auth.admin_set_role(&token, &user_id, ba_role).await?;
    auth.clear_session_cache().await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn auth_admin_ban_user(
    app: AppHandle,
    user_id: String,
    reason: Option<String>,
) -> Result<(), AuthError> {
    guard::require_auth_admin_current(&app).await?;
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    auth.admin_ban_user(&token, &user_id, reason.as_deref())
        .await?;
    auth.clear_session_cache().await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn auth_admin_unban_user(
    app: AppHandle,
    user_id: String,
) -> Result<(), AuthError> {
    guard::require_auth_admin_current(&app).await?;
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    auth.admin_unban_user(&token, &user_id).await?;
    auth.clear_session_cache().await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn auth_admin_remove_user(
    app: AppHandle,
    user_id: String,
) -> Result<(), AuthError> {
    guard::require_auth_admin_current(&app).await?;

    let db = app.state::<DbState>();
    if let Some(mut employee) = employees::find_local_by_auth_user_id(&db.lite, &user_id).await? {
        employee.auth_user_id = None;
        employee.updated_at = Utc::now();
        employees::upsert(&db, &employee).await?;
    }

    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    auth.admin_remove_user(&token, &user_id).await?;
    auth.clear_session_cache().await;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionCapabilitiesDto {
    pub punch_read_self: bool,
    pub punch_read_others: bool,
    pub punch_write_self: bool,
    pub punch_write_others: bool,
    pub hours_edit: bool,
    pub hierarchy_manage: bool,
    pub reports_create: bool,
    pub card_provision: bool,
}

async fn session_has(
    auth: &AuthState,
    session_token: &str,
    action: crate::auth::permissions::PermissionAction,
) -> bool {
    auth
        .has_permission(
            Some(session_token),
            None,
            crate::auth::permissions::action_to_ba_permissions(action),
        )
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) async fn auth_session_capabilities(
    app: AppHandle,
) -> Result<SessionCapabilitiesDto, AuthError> {
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    guard::resolve_session(&app, &token).await?;
    use crate::auth::permissions::PermissionAction as P;

    Ok(SessionCapabilitiesDto {
        punch_read_self: session_has(&auth, &token, P::ReadSelf).await,
        punch_read_others: session_has(&auth, &token, P::ReadOthers).await,
        punch_write_self: session_has(&auth, &token, P::WriteSelf).await,
        punch_write_others: session_has(&auth, &token, P::WriteOthers).await,
        hours_edit: session_has(&auth, &token, P::EditHours).await,
        hierarchy_manage: session_has(&auth, &token, P::EditHierarchy).await,
        reports_create: session_has(&auth, &token, P::CreateReports).await,
        card_provision: session_has(&auth, &token, P::ProvisionCard).await,
    })
}

#[tauri::command]
pub(crate) async fn auth_session_has_permission(
    app: AppHandle,
    permissions: serde_json::Value,
) -> Result<bool, AuthError> {
    let auth = app.state::<AuthState>();
    let token = auth.current_session().await?;
    guard::resolve_session(&app, &token).await?;
    auth.has_permission(Some(&token), None, permissions).await
}
