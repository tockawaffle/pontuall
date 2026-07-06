use std::collections::HashMap;

use chrono::Utc;
use rand::distributions::Alphanumeric;
use rand::Rng;
use tauri::{AppHandle, Manager};

use crate::auth::guard;
use crate::auth::permissions::PermissionAction;
use crate::auth::AuthState;
use crate::db::error::DbError;
use crate::db::models::{parse_day_key, parse_local_time, Employee, UserExternal};
use crate::db::repo::time_entries::UpdateKey;
use crate::db::repo::{employees, time_entries};
use crate::db::DbState;

/// Returns every employee with their punches in the legacy `CachedUsers`
/// shape (map keyed by employee name). Access roles are read from Better Auth.
#[tauri::command]
pub(crate) async fn get_cache(
    app: AppHandle,
) -> Result<HashMap<String, UserExternal>, DbError> {
    let state = app.state::<DbState>();
    let emps = employees::list_local(&state.lite).await?;
    let entries = time_entries::list_local(&state.lite).await?;

    let auth_roles = app
        .state::<AuthState>()
        .fetch_user_roles()
        .await
        .unwrap_or_default();

    Ok(emps
        .iter()
        .map(|e| {
            let access_role = e
                .auth_user_id
                .as_ref()
                .and_then(|id| auth_roles.get(id).cloned());
            (e.name.clone(), e.to_user_external(&entries, access_role))
        })
        .collect())
}

/// Legacy name kept for the frontend: refreshes the local mirror from
/// Postgres when online.
#[tauri::command]
pub(crate) async fn get_users_and_cache(app: AppHandle) -> Result<(), DbError> {
    crate::db::sync::pull_master_data(&app).await
}

#[tauri::command]
pub(crate) async fn insert_new_user(
    state: tauri::State<'_, DbState>,
    id: String,
    name: String,
    email: Option<String>,
    role: String,
    lunch_time: String,
    phone: Option<String>,
) -> Result<bool, DbError> {
    if employees::find_local(&state.lite, &id).await?.is_some() {
        return Err(DbError::Conflict("user already exists".into()));
    }
    if let Some(email) = email.as_deref() {
        if !email.is_empty()
            && employees::find_local_by_email(&state.lite, email).await?.is_some()
        {
            return Err(DbError::Conflict("user already exists".into()));
        }
    }

    let now = Utc::now();
    let employee = Employee {
        id,
        name,
        email,
        phone,
        role,
        lunch_time: Some(lunch_time),
        status: "active".to_string(),
        auth_user_id: None,
        created_at: now,
        updated_at: now,
    };

    employees::upsert(&state, &employee).await?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn update_employee(
    app: AppHandle,
    employee_id: String,
    name: String,
    email: Option<String>,
    role: String,
    lunch_time: Option<String>,
    phone: Option<String>,
    access_level: String,
) -> Result<bool, DbError> {
    let actor = guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    let ba_role = match access_level.as_str() {
        "employee" | "supervisor" | "administrator" => access_level.as_str(),
        other => {
            return Err(DbError::InvalidInput(format!(
                "nível de acesso inválido: {other}"
            )))
        }
    };

    let state = app.state::<DbState>();
    let mut employee = employees::find_local(&state.lite, &employee_id)
        .await?
        .ok_or_else(|| DbError::NotFound("employee".into()))?;

    let normalized_email = email.filter(|e| !e.trim().is_empty());
    if let Some(addr) = normalized_email.as_deref() {
        if let Some(other) = employees::find_local_by_email(&state.lite, addr).await? {
            if other.id != employee_id {
                return Err(DbError::Conflict("e-mail já em uso".into()));
            }
        }
    }

    employee.name = name.trim().to_string();
    employee.email = normalized_email.map(|e| e.trim().to_string());
    employee.role = role.trim().to_string();
    employee.phone = phone.filter(|p| !p.trim().is_empty());
    employee.lunch_time = lunch_time.filter(|t| !t.trim().is_empty());
    employee.updated_at = Utc::now();

    employees::upsert(&state, &employee).await?;

    if let Some(auth_user_id) = employee.auth_user_id.as_deref() {
        let auth = app.state::<AuthState>();
        auth.set_user_role_internal(auth_user_id, ba_role, Some(&actor))
            .await
            .map_err(|e| DbError::InvalidInput(e.to_string()))?;
    }

    Ok(true)
}

/// Records a punch. `day` is the frontend's "dd/mm/yyyy" key and `value` a
/// local "HH:MM[:SS]" time.
#[tauri::command]
pub(crate) async fn update_cache_hour_data(
    state: tauri::State<'_, DbState>,
    id: String,
    day: String,
    key_to_update: UpdateKey,
    value: String,
    punch_source: Option<String>,
) -> Result<bool, DbError> {
    let work_date = parse_day_key(&day)
        .ok_or_else(|| DbError::InvalidInput(format!("invalid day: {day}")))?;
    let timestamp = parse_local_time(work_date, &value)
        .ok_or_else(|| DbError::InvalidInput(format!("invalid time: {value}")))?;

    if employees::find_local(&state.lite, &id).await?.is_none() {
        return Err(DbError::NotFound("user".into()));
    }

    let source = punch_source.as_deref().filter(|s| !s.is_empty());
    time_entries::set_field(
        &state,
        &id,
        work_date,
        key_to_update,
        timestamp,
        source,
    )
    .await?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn delete_time_entry_day(
    state: tauri::State<'_, DbState>,
    employee_id: String,
    day: String,
) -> Result<bool, DbError> {
    let work_date = parse_day_key(&day)
        .ok_or_else(|| DbError::InvalidInput(format!("invalid day: {day}")))?;

    if employees::find_local(&state.lite, &employee_id).await?.is_none() {
        return Err(DbError::NotFound("user".into()));
    }

    if time_entries::find_local(&state.lite, &employee_id, work_date)
        .await?
        .is_none()
    {
        return Err(DbError::NotFound("time entry".into()));
    }

    time_entries::delete_day(&state, &employee_id, work_date).await?;
    Ok(true)
}

/// Legacy 16-char id, still used as the card payload until the card layer
/// rework replaces it with provisioned tokens.
#[tauri::command]
pub(crate) fn gen_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}
