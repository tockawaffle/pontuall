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
        terminated_at: None,
        created_at: now,
        updated_at: now,
        exclude_from_report: false,
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminateEmployeeResult {
    /// Whether the data-export e-mail reached the employee (requires a
    /// registered e-mail and a configured SMTP server).
    pub export_sent: bool,
}

/// Terminates an employee (LGPD flow, .lgpd/retention.md §3):
/// 1. e-mails them a copy of their data and punch history (Art. 18, II/V);
/// 2. blocks their NFC cards;
/// 3. removes their login account;
/// 4. marks the record `terminated` so the retention job anonymizes it after
///    the legal retention window. Time entries are kept (CLT Art. 74).
#[tauri::command]
pub(crate) async fn employee_terminate(
    app: AppHandle,
    employee_id: String,
) -> Result<TerminateEmployeeResult, DbError> {
    let actor = guard::require_auth_admin_current(&app)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    let state = app.state::<DbState>();
    let mut employee = employees::find_local(&state.lite, &employee_id)
        .await?
        .ok_or_else(|| DbError::NotFound("employee".into()))?;
    if employee.status == "terminated" {
        return Err(DbError::Conflict("funcionário já desligado".into()));
    }

    // Send the data copy first: it needs the e-mail and must happen before
    // anything is blocked or removed. A send failure aborts the termination
    // (nothing has been changed yet) so the admin can retry.
    let mut export_sent = false;
    if let (Some(email), Some(smtp)) = (
        employee.email.clone().filter(|e| !e.trim().is_empty()),
        crate::misc::smtp::get_smtp_config()?,
    ) {
        let entries = time_entries::list_local(&state.lite).await?;
        let mut days: Vec<&crate::db::models::TimeEntry> = entries
            .iter()
            .filter(|e| e.employee_id == employee_id)
            .collect();
        days.sort_by_key(|e| e.work_date);

        let export = serde_json::json!({
            "employee": {
                "name": employee.name,
                "email": employee.email,
                "phone": employee.phone,
                "role": employee.role,
                "lunchTime": employee.lunch_time,
                "createdAt": employee.created_at.to_rfc3339(),
            },
            "timeEntries": days.iter().map(|e| {
                let h = e.to_hour_data();
                serde_json::json!({
                    "date": e.work_date.format(crate::db::models::DAY_KEY_FORMAT).to_string(),
                    "clockIn": h.clock_in,
                    "lunchOut": h.lunch_break_out,
                    "lunchReturn": h.lunch_break_return,
                    "clockOut": h.clocked_out,
                    "totalHours": h.total_hours,
                })
            }).collect::<Vec<_>>(),
        });

        let auth = app.state::<AuthState>();
        auth.send_data_export(&email, &export, &smtp, &actor)
            .await
            .map_err(|e| {
                DbError::InvalidInput(format!(
                    "envio dos dados ao funcionário falhou ({e}) — o desligamento foi cancelado, tente novamente"
                ))
            })?;
        export_sent = true;
    }

    // Block every card so it stops punching immediately.
    for mut card in crate::db::repo::cards::find_by_employee(&state, &employee_id).await? {
        if card.status != "blocked" {
            card.status = "blocked".to_string();
            crate::db::repo::cards::upsert(&state, &card).await?;
            crate::db::repo::cards::log_event(
                &state,
                Some(&card.id),
                "blocked",
                Some("desligamento do funcionário".into()),
            )
            .await?;
        }
    }

    // Remove the login account (revokes sessions on the sidecar side).
    if let Some(auth_user_id) = employee.auth_user_id.take() {
        let auth = app.state::<AuthState>();
        let token = auth
            .current_session()
            .await
            .map_err(|e| DbError::InvalidInput(e.to_string()))?;
        auth.admin_remove_user(&token, &auth_user_id)
            .await
            .map_err(|e| DbError::InvalidInput(e.to_string()))?;
        auth.clear_session_cache().await;
    }

    employee.status = "terminated".to_string();
    employee.terminated_at = Some(Utc::now());
    employee.updated_at = Utc::now();
    employees::upsert(&state, &employee).await?;

    Ok(TerminateEmployeeResult { export_sent })
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
