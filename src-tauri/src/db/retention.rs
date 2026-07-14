//! Daily LGPD retention job (.lgpd/retention.md §3): purges security logs
//! past their window and anonymizes employees terminated longer ago than the
//! labor retention duty. Better Auth tables (session, verification,
//! auth_audit_log) are purged by the sidecar, which owns them.

use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use tauri::{AppHandle, Manager};

use crate::db::error::DbError;
use crate::db::repo::employees;
use crate::db::DbState;

/// Retention windows from the LGPD retention policy (.lgpd/retention.md).
const PUNCH_AUTH_LOG_DAYS: i64 = 180; // ~6 months
const CARD_EVENTS_DAYS: i64 = 365; // 12 months
const EMPLOYEE_ANONYMIZE_DAYS: i64 = 5 * 365 + 1; // 5 years after termination

const RUN_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const FIRST_RUN_DELAY: Duration = Duration::from_secs(60);

pub(crate) async fn retention_loop(app: AppHandle) {
    tokio::time::sleep(FIRST_RUN_DELAY).await;
    loop {
        if let Err(e) = run_retention(&app).await {
            eprintln!("retention job failed: {e}");
        }
        tokio::time::sleep(RUN_INTERVAL).await;
    }
}

pub(crate) async fn run_retention(app: &AppHandle) -> Result<(), DbError> {
    let state = app.state::<DbState>();
    run_retention_on(&state).await
}

async fn run_retention_on(state: &DbState) -> Result<(), DbError> {
    let now = Utc::now();

    let punch_cutoff = now - ChronoDuration::days(PUNCH_AUTH_LOG_DAYS);
    let card_cutoff = now - ChronoDuration::days(CARD_EVENTS_DAYS);

    // punch_auth_log rows are written as `to_rfc3339()` strings; bind the
    // cutoff in the same format so the TEXT comparison stays chronological.
    let mut purged = sqlx::query("DELETE FROM punch_auth_log WHERE created_at < ?1")
        .bind(punch_cutoff.to_rfc3339())
        .execute(&state.lite)
        .await?
        .rows_affected();

    purged += sqlx::query("DELETE FROM card_events WHERE created_at < ?1")
        .bind(card_cutoff)
        .execute(&state.lite)
        .await?
        .rows_affected();

    if let Some(pg) = state.pg_if_online().await {
        purged += sqlx::query("DELETE FROM punch_auth_log WHERE created_at < $1")
            .bind(punch_cutoff)
            .execute(&pg)
            .await?
            .rows_affected();
        purged += sqlx::query("DELETE FROM card_events WHERE created_at < $1")
            .bind(card_cutoff)
            .execute(&pg)
            .await?
            .rows_affected();
    }

    let anonymized = anonymize_expired_terminated(state, now).await?;

    if purged > 0 || anonymized > 0 {
        println!(
            "retention: purged {purged} log rows, anonymized {anonymized} terminated employee(s)"
        );
    }
    Ok(())
}

/// Anonymizes employees whose termination passed the retention window: the
/// identity goes away (LGPD Art. 12), the time entries stay for the labor
/// retention duty (Art. 16, I). Uses the regular upsert so the change syncs
/// to Postgres (or queues in the outbox while offline).
async fn anonymize_expired_terminated(
    state: &DbState,
    now: DateTime<Utc>,
) -> Result<usize, DbError> {
    let cutoff = now - ChronoDuration::days(EMPLOYEE_ANONYMIZE_DAYS);
    let mut count = 0;

    for mut e in employees::list_local(&state.lite).await? {
        if e.status != "terminated" {
            continue;
        }
        let Some(terminated_at) = e.terminated_at else {
            continue;
        };
        if terminated_at >= cutoff {
            continue;
        }
        let already_anonymized =
            e.email.is_none() && e.phone.is_none() && e.name.starts_with("Ex-funcionário");
        if already_anonymized {
            continue;
        }

        sqlx::query("UPDATE punch_auth_log SET email = NULL WHERE employee_id = ?1")
            .bind(&e.id)
            .execute(&state.lite)
            .await?;
        if let Some(pg) = state.pg_if_online().await {
            let _ = sqlx::query("UPDATE punch_auth_log SET email = NULL WHERE employee_id = $1")
                .bind(&e.id)
                .execute(&pg)
                .await;
        }

        let short: String = e.id.chars().take(8).collect();
        e.name = format!("Ex-funcionário {short}");
        e.email = None;
        e.phone = None;
        e.auth_user_id = None;
        e.updated_at = Utc::now();
        employees::upsert(state, &e).await?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Employee;
    use crate::db::repo::punch_audit;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    async fn memory_db() -> DbState {
        let options = SqliteConnectOptions::new()
            .filename(":memory:")
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("in-memory sqlite");
        sqlx::migrate!("./migrations/sqlite")
            .run(&pool)
            .await
            .expect("sqlite migrations");
        DbState::new(pool)
    }

    fn employee(id: &str, terminated_days_ago: Option<i64>) -> Employee {
        let now = Utc::now();
        Employee {
            id: id.into(),
            name: format!("Employee {id}"),
            email: Some(format!("{id}@test.local")),
            phone: Some("11 99999-0000".into()),
            role: "Tester".into(),
            lunch_time: None,
            status: if terminated_days_ago.is_some() {
                "terminated".into()
            } else {
                "active".into()
            },
            auth_user_id: None,
            terminated_at: terminated_days_ago.map(|d| now - ChronoDuration::days(d)),
            created_at: now,
            updated_at: now,
            exclude_from_report: false,
        }
    }

    #[tokio::test]
    async fn purges_old_logs_and_keeps_recent_ones() {
        let db = memory_db().await;
        employees::upsert_local(&db.lite, &employee("emp1", None)).await.unwrap();

        // punch_auth_log: one row past the window, one recent.
        for (event, age_days) in [("old", PUNCH_AUTH_LOG_DAYS + 10), ("recent", 1)] {
            sqlx::query(
                "INSERT INTO punch_auth_log (id, employee_id, email, event_type, success, details, created_at) \
                 VALUES (?1, ?2, NULL, ?3, 1, NULL, ?4)",
            )
            .bind(format!("row-{event}"))
            .bind("emp1")
            .bind(event)
            .bind((Utc::now() - ChronoDuration::days(age_days)).to_rfc3339())
            .execute(&db.lite)
            .await
            .unwrap();
        }

        run_retention_on(&db).await.unwrap();

        let remaining: Vec<String> =
            sqlx::query_scalar("SELECT event_type FROM punch_auth_log")
                .fetch_all(&db.lite)
                .await
                .unwrap();
        assert_eq!(remaining, vec!["recent".to_string()]);
    }

    #[tokio::test]
    async fn anonymizes_only_expired_terminations() {
        let db = memory_db().await;
        employees::upsert_local(&db.lite, &employee("active", None)).await.unwrap();
        employees::upsert_local(&db.lite, &employee("fresh", Some(30))).await.unwrap();
        employees::upsert_local(
            &db.lite,
            &employee("expired", Some(EMPLOYEE_ANONYMIZE_DAYS + 30)),
        )
        .await
        .unwrap();
        punch_audit::log_event(&db.lite, Some("expired"), Some("expired@test.local"), "otp_sent", true, None)
            .await
            .unwrap();

        run_retention_on(&db).await.unwrap();

        let all = employees::list_local(&db.lite).await.unwrap();
        let by_id = |id: &str| all.iter().find(|e| e.id == id).unwrap();

        // Active and recently terminated employees keep their identity.
        assert_eq!(by_id("active").email.as_deref(), Some("active@test.local"));
        assert_eq!(by_id("fresh").email.as_deref(), Some("fresh@test.local"));

        // The expired one is anonymized but the row (and its punches) remain.
        let anon = by_id("expired");
        assert_eq!(anon.name, "Ex-funcionário expired");
        assert!(anon.email.is_none());
        assert!(anon.phone.is_none());
        assert_eq!(anon.status, "terminated");

        let log_email: Option<String> =
            sqlx::query_scalar("SELECT email FROM punch_auth_log WHERE employee_id = 'expired'")
                .fetch_one(&db.lite)
                .await
                .unwrap();
        assert!(log_email.is_none());

        // A second run must be a no-op (already anonymized).
        run_retention_on(&db).await.unwrap();
        assert_eq!(
            employees::list_local(&db.lite).await.unwrap().iter().filter(|e| e.name.starts_with("Ex-funcionário")).count(),
            1
        );
    }
}
