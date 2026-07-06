use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::auth::error::AuthError;
use crate::auth::permissions::{action_to_ba_permissions, PermissionAction};
use crate::auth::{AuthState, CachedSession, UserLoggedDto};
use crate::db::repo::employees;
use crate::db::DbState;

const SESSION_CACHE_TTL: Duration = Duration::from_secs(30);

/// Validates a session token against Better Auth and resolves the linked employee.
pub(crate) async fn resolve_session(
    app: &AppHandle,
    session_token: &str,
) -> Result<(UserLoggedDto, String), AuthError> {
    let auth = app.state::<AuthState>();

    {
        let cache = auth.session_cache.lock().await;
        if let Some(entry) = cache.get(session_token) {
            if entry.fetched_at.elapsed() < SESSION_CACHE_TTL {
                return Ok((entry.user.clone(), entry.auth_role.clone()));
            }
        }
    }

    let auth_user = auth.get_session_user(session_token).await?;
    let auth_role = auth_user.role.unwrap_or_else(|| "employee".to_string());

    let db = app.state::<DbState>();
    let employee = employees::find_local_by_auth_user_id(&db.lite, &auth_user.id)
        .await?
        .ok_or_else(|| {
            AuthError::Internal("conta de acesso sem funcionário vinculado".into())
        })?;

    let user = UserLoggedDto {
        id: employee.id,
        name: employee.name,
        image: None,
        role: employee.role,
        access_role: auth_role.clone(),
    };

    let mut cache = auth.session_cache.lock().await;
    cache.retain(|_, entry| entry.fetched_at.elapsed() < SESSION_CACHE_TTL);
    cache.insert(
        session_token.to_string(),
        CachedSession {
            user: user.clone(),
            auth_role: auth_role.clone(),
            fetched_at: Instant::now(),
        },
    );

    Ok((user, auth_role))
}

/// Session gate backed by Better Auth access control.
pub(crate) async fn require_permission(
    app: &AppHandle,
    session_token: &str,
    needed: PermissionAction,
) -> Result<UserLoggedDto, AuthError> {
    let (user, _) = resolve_session(app, session_token).await?;
    let auth = app.state::<AuthState>();
    let allowed = auth
        .has_permission(
            Some(session_token),
            None,
            action_to_ba_permissions(needed),
        )
        .await?;

    if allowed {
        Ok(user)
    } else {
        Err(AuthError::Forbidden)
    }
}

// --- Backend-held-session variants -----------------------------------------
// The webview no longer sends a session token; these resolve it from AuthState
// so commands can gate on the signed-in user without trusting the frontend.

/// Resolves the active session held by the backend.
pub(crate) async fn resolve_current(
    app: &AppHandle,
) -> Result<(UserLoggedDto, String), AuthError> {
    let token = app.state::<AuthState>().current_session().await?;
    resolve_session(app, &token).await
}

/// Permission gate for the active backend-held session.
pub(crate) async fn require_current(
    app: &AppHandle,
    needed: PermissionAction,
) -> Result<UserLoggedDto, AuthError> {
    let token = app.state::<AuthState>().current_session().await?;
    require_permission(app, &token, needed).await
}

/// Hierarchy-management gate for the active backend-held session.
pub(crate) async fn require_auth_admin_current(
    app: &AppHandle,
) -> Result<UserLoggedDto, AuthError> {
    require_current(app, PermissionAction::EditHierarchy).await
}
