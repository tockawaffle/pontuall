use chrono::{Duration, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::error::DbError;

const MAX_OTP_REQUESTS_PER_HOUR: i64 = 3;
const MAX_VERIFY_FAILURES_WINDOW_MIN: i64 = 15;
const MAX_VERIFY_FAILURES: i64 = 5;

/// Masks an e-mail the same way the sidecar audit log does ("ab***@domain"):
/// rate limiting keys on employee_id, so the log never needs the full address
/// (LGPD Art. 6º, III — LIA A005 in .lgpd/lia/).
fn mask_email(value: &str) -> String {
    match value.split_once('@') {
        Some((local, domain)) => {
            let prefix: String = local.chars().take(2).collect();
            format!("{prefix}***@{domain}")
        }
        None => "***".to_string(),
    }
}

pub(crate) async fn log_event(
    lite: &SqlitePool,
    employee_id: Option<&str>,
    email: Option<&str>,
    event_type: &str,
    success: bool,
    details: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO punch_auth_log (id, employee_id, email, event_type, success, details, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(employee_id)
    .bind(email.map(mask_email))
    .bind(event_type)
    .bind(if success { 1 } else { 0 })
    .bind(details)
    .bind(Utc::now().to_rfc3339())
    .execute(lite)
    .await?;
    Ok(())
}

pub(crate) async fn ensure_can_request_otp(
    lite: &SqlitePool,
    employee_id: &str,
) -> Result<(), DbError> {
    if is_locked_out(lite, employee_id).await? {
        return Err(DbError::InvalidInput(
            "muitas tentativas — aguarde 15 minutos".into(),
        ));
    }

    let since = (Utc::now() - Duration::hours(1)).to_rfc3339();
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM punch_auth_log \
         WHERE employee_id = ?1 AND event_type = 'otp_sent' AND success = 1 AND created_at >= ?2",
    )
    .bind(employee_id)
    .bind(since)
    .fetch_one(lite)
    .await?;

    if count >= MAX_OTP_REQUESTS_PER_HOUR {
        return Err(DbError::InvalidInput(
            "limite de códigos por hora atingido — tente mais tarde".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn ensure_can_verify_otp(
    lite: &SqlitePool,
    employee_id: &str,
) -> Result<(), DbError> {
    if is_locked_out(lite, employee_id).await? {
        return Err(DbError::InvalidInput(
            "muitas tentativas — aguarde 15 minutos".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::mask_email;

    #[test]
    fn mask_email_keeps_only_prefix_and_domain() {
        assert_eq!(mask_email("joao.silva@empresa.com"), "jo***@empresa.com");
        assert_eq!(mask_email("a@b.co"), "a***@b.co");
        assert_eq!(mask_email("not-an-email"), "***");
    }
}

async fn is_locked_out(lite: &SqlitePool, employee_id: &str) -> Result<bool, DbError> {
    let since = (Utc::now() - Duration::minutes(MAX_VERIFY_FAILURES_WINDOW_MIN)).to_rfc3339();
    let failures: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM punch_auth_log \
         WHERE employee_id = ?1 AND event_type = 'otp_verify_failed' AND created_at >= ?2",
    )
    .bind(employee_id)
    .bind(since)
    .fetch_one(lite)
    .await?;
    Ok(failures >= MAX_VERIFY_FAILURES)
}
