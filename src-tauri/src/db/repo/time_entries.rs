use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgPool, SqlitePool};

use crate::db::error::DbError;
use crate::db::models::TimeEntry;
use crate::db::repo::outbox;
use crate::db::{lite_sql, DbState};

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(crate) enum UpdateKey {
    ClockIn,
    ClockLunchOut,
    ClockLunchReturn,
    ClockOut,
}

impl UpdateKey {
    fn column(self) -> &'static str {
        match self {
            UpdateKey::ClockIn => "clock_in",
            UpdateKey::ClockLunchOut => "lunch_out",
            UpdateKey::ClockLunchReturn => "lunch_return",
            UpdateKey::ClockOut => "clock_out",
        }
    }

    fn source_key(self) -> &'static str {
        match self {
            UpdateKey::ClockIn => "clock_in",
            UpdateKey::ClockLunchOut => "lunch_out",
            UpdateKey::ClockLunchReturn => "lunch_return",
            UpdateKey::ClockOut => "clock_out",
        }
    }
}

fn merge_punch_source(existing: Option<&str>, field: &str, source: &str) -> String {
    let mut map: serde_json::Map<String, serde_json::Value> = existing
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    map.insert(
        field.to_string(),
        serde_json::Value::String(source.to_string()),
    );
    serde_json::Value::Object(map).to_string()
}

const UPSERT_ROW: &str = "\
INSERT INTO time_entries (id, employee_id, work_date, clock_in, lunch_out, lunch_return, clock_out, updated_at, punch_sources) \
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
ON CONFLICT (employee_id, work_date) DO UPDATE SET \
  clock_in = excluded.clock_in, lunch_out = excluded.lunch_out, \
  lunch_return = excluded.lunch_return, clock_out = excluded.clock_out, \
  updated_at = excluded.updated_at, punch_sources = excluded.punch_sources \
WHERE time_entries.updated_at <= excluded.updated_at";

fn bind_row<'q, DB>(
    query: sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>,
    e: &'q TimeEntry,
) -> sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database,
    String: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    NaiveDate: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<DateTime<Utc>>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    DateTime<Utc>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<String>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
{
    query
        .bind(&e.id)
        .bind(&e.employee_id)
        .bind(e.work_date)
        .bind(e.clock_in)
        .bind(e.lunch_out)
        .bind(e.lunch_return)
        .bind(e.clock_out)
        .bind(e.updated_at)
        .bind(&e.punch_sources)
}

pub(crate) async fn upsert_row_local(lite: &SqlitePool, e: &TimeEntry) -> Result<(), DbError> {
    let sql = lite_sql(UPSERT_ROW);
    bind_row(sqlx::query(&sql), e).execute(lite).await?;
    Ok(())
}

pub(crate) async fn upsert_row_pg(pg: &PgPool, e: &TimeEntry) -> Result<(), DbError> {
    bind_row(sqlx::query(UPSERT_ROW), e).execute(pg).await?;
    Ok(())
}

/// Sets a single punch field for an employee/date, writing locally first and
/// mirroring to Postgres (or the outbox when offline).
pub(crate) async fn set_field(
    db: &DbState,
    employee_id: &str,
    work_date: NaiveDate,
    key: UpdateKey,
    value: DateTime<Utc>,
    punch_source: Option<&str>,
) -> Result<(), DbError> {
    let column = key.column();
    let existing = find_local(&db.lite, employee_id, work_date).await?;
    let punch_sources = punch_source.map(|source| {
        merge_punch_source(
            existing.as_ref().and_then(|e| e.punch_sources.as_deref()),
            key.source_key(),
            source,
        )
    });

    let sql = if punch_sources.is_some() {
        format!(
            "INSERT INTO time_entries (id, employee_id, work_date, {column}, updated_at, punch_sources) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (employee_id, work_date) DO UPDATE SET \
               {column} = excluded.{column}, updated_at = excluded.updated_at, \
               punch_sources = excluded.punch_sources"
        )
    } else {
        format!(
            "INSERT INTO time_entries (id, employee_id, work_date, {column}, updated_at) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (employee_id, work_date) DO UPDATE SET \
               {column} = excluded.{column}, updated_at = excluded.updated_at"
        )
    };
    let now = Utc::now();
    let id = uuid::Uuid::new_v4().to_string();

    if let Some(sources) = punch_sources.as_ref() {
        sqlx::query(&lite_sql(&sql))
            .bind(&id)
            .bind(employee_id)
            .bind(work_date)
            .bind(value)
            .bind(now)
            .bind(sources)
            .execute(&db.lite)
            .await?;
    } else {
        sqlx::query(&lite_sql(&sql))
            .bind(&id)
            .bind(employee_id)
            .bind(work_date)
            .bind(value)
            .bind(now)
            .execute(&db.lite)
            .await?;
    }

    // The local row now holds the merged state; replicate the whole row so
    // replay is a simple last-write-wins upsert.
    let row = find_local(&db.lite, employee_id, work_date)
        .await?
        .ok_or_else(|| DbError::NotFound("time entry".into()))?;

    match db.pg_if_online().await {
        Some(pg) => {
            if upsert_row_pg(&pg, &row).await.is_err() {
                db.mark_offline();
                outbox::enqueue(&db.lite, "upsert_time_entry", &row).await?;
            }
        }
        None => outbox::enqueue(&db.lite, "upsert_time_entry", &row).await?,
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct DeleteTimeEntryDay {
    pub employee_id: String,
    pub work_date: NaiveDate,
}

/// Removes every punch for an employee on a given day (local first, then Postgres/outbox).
pub(crate) async fn delete_day(
    db: &DbState,
    employee_id: &str,
    work_date: NaiveDate,
) -> Result<(), DbError> {
    sqlx::query("DELETE FROM time_entries WHERE employee_id = ?1 AND work_date = ?2")
        .bind(employee_id)
        .bind(work_date)
        .execute(&db.lite)
        .await?;

    let payload = DeleteTimeEntryDay {
        employee_id: employee_id.to_string(),
        work_date,
    };

    match db.pg_if_online().await {
        Some(pg) => {
            if sqlx::query("DELETE FROM time_entries WHERE employee_id = $1 AND work_date = $2")
                .bind(employee_id)
                .bind(work_date)
                .execute(&pg)
                .await
                .is_err()
            {
                db.mark_offline();
                outbox::enqueue(&db.lite, "delete_time_entry", &payload).await?;
            }
        }
        None => outbox::enqueue(&db.lite, "delete_time_entry", &payload).await?,
    }
    Ok(())
}

pub(crate) async fn delete_day_pg(pg: &PgPool, payload: &DeleteTimeEntryDay) -> Result<(), DbError> {
    sqlx::query("DELETE FROM time_entries WHERE employee_id = $1 AND work_date = $2")
        .bind(&payload.employee_id)
        .bind(payload.work_date)
        .execute(pg)
        .await?;
    Ok(())
}

pub(crate) async fn find_local(
    lite: &SqlitePool,
    employee_id: &str,
    work_date: NaiveDate,
) -> Result<Option<TimeEntry>, DbError> {
    let row = sqlx::query_as::<_, TimeEntry>(
        "SELECT * FROM time_entries WHERE employee_id = ?1 AND work_date = ?2",
    )
    .bind(employee_id)
    .bind(work_date)
    .fetch_optional(lite)
    .await?;
    Ok(row)
}

pub(crate) async fn list_local(lite: &SqlitePool) -> Result<Vec<TimeEntry>, DbError> {
    let rows = sqlx::query_as::<_, TimeEntry>("SELECT * FROM time_entries")
        .fetch_all(lite)
        .await?;
    Ok(rows)
}

/// Mirrors every time entry from Postgres into SQLite (last write wins).
pub(crate) async fn pull_from_pg(pg: &PgPool, lite: &SqlitePool) -> Result<usize, DbError> {
    let rows = sqlx::query_as::<_, TimeEntry>("SELECT * FROM time_entries")
        .fetch_all(pg)
        .await?;
    for e in &rows {
        upsert_row_local(lite, e).await?;
    }
    Ok(rows.len())
}
