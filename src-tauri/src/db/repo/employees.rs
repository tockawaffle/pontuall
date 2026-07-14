use sqlx::{PgPool, SqlitePool};

use crate::db::error::DbError;
use crate::db::models::Employee;
use crate::db::repo::outbox;
use crate::db::{lite_sql, DbState};

const UPSERT: &str = "\
INSERT INTO employees (id, name, email, phone, role, lunch_time, status, auth_user_id, terminated_at, created_at, updated_at, exclude_from_report) \
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
ON CONFLICT (id) DO UPDATE SET \
  name = excluded.name, email = excluded.email, phone = excluded.phone, \
  role = excluded.role, lunch_time = excluded.lunch_time, status = excluded.status, \
  auth_user_id = excluded.auth_user_id, \
  terminated_at = excluded.terminated_at, \
  updated_at = excluded.updated_at, \
  exclude_from_report = excluded.exclude_from_report \
WHERE employees.updated_at <= excluded.updated_at";

fn bind_upsert<'q, DB>(
    query: sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>,
    e: &'q Employee,
) -> sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database,
    String: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<String>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    chrono::DateTime<chrono::Utc>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<chrono::DateTime<chrono::Utc>>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    bool: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
{
    query
        .bind(&e.id)
        .bind(&e.name)
        .bind(&e.email)
        .bind(&e.phone)
        .bind(&e.role)
        .bind(&e.lunch_time)
        .bind(&e.status)
        .bind(&e.auth_user_id)
        .bind(e.terminated_at)
        .bind(e.created_at)
        .bind(e.updated_at)
        .bind(e.exclude_from_report)
}

pub(crate) async fn upsert_local(lite: &SqlitePool, e: &Employee) -> Result<(), DbError> {
    let sql = lite_sql(UPSERT);
    bind_upsert(sqlx::query(&sql), e).execute(lite).await?;
    Ok(())
}

pub(crate) async fn upsert_pg(pg: &PgPool, e: &Employee) -> Result<(), DbError> {
    bind_upsert(sqlx::query(UPSERT), e).execute(pg).await?;
    Ok(())
}

/// Writes locally, then to Postgres when online; a failed or unavailable
/// Postgres write lands in the outbox and flips the app offline.
pub(crate) async fn upsert(db: &DbState, e: &Employee) -> Result<(), DbError> {
    upsert_local(&db.lite, e).await?;

    match db.pg_if_online().await {
        Some(pg) => {
            if upsert_pg(&pg, e).await.is_err() {
                db.mark_offline();
                outbox::enqueue(&db.lite, "upsert_employee", e).await?;
            }
        }
        None => outbox::enqueue(&db.lite, "upsert_employee", e).await?,
    }
    Ok(())
}

pub(crate) async fn list_local(lite: &SqlitePool) -> Result<Vec<Employee>, DbError> {
    let rows = sqlx::query_as::<_, Employee>("SELECT * FROM employees ORDER BY name ASC")
        .fetch_all(lite)
        .await?;
    Ok(rows)
}

pub(crate) async fn find_local(lite: &SqlitePool, id: &str) -> Result<Option<Employee>, DbError> {
    let row = sqlx::query_as::<_, Employee>("SELECT * FROM employees WHERE id = ?1")
        .bind(id)
        .fetch_optional(lite)
        .await?;
    Ok(row)
}

pub(crate) async fn find_local_by_email(
    lite: &SqlitePool,
    email: &str,
) -> Result<Option<Employee>, DbError> {
    let row = sqlx::query_as::<_, Employee>("SELECT * FROM employees WHERE LOWER(email) = LOWER(?1)")
        .bind(email)
        .fetch_optional(lite)
        .await?;
    Ok(row)
}

pub(crate) async fn find_local_by_auth_user_id(
    lite: &SqlitePool,
    auth_user_id: &str,
) -> Result<Option<Employee>, DbError> {
    let row = sqlx::query_as::<_, Employee>("SELECT * FROM employees WHERE auth_user_id = ?1")
        .bind(auth_user_id)
        .fetch_optional(lite)
        .await?;
    Ok(row)
}

/// Whether any employee has a linked login account. Checked against
/// Postgres when online (bootstrap runs right after setup, before the local
/// mirror necessarily has data).
pub(crate) async fn has_login_account(db: &DbState) -> Result<bool, DbError> {
    const SQL: &str = "SELECT COUNT(*) FROM employees WHERE auth_user_id IS NOT NULL";
    let count: i64 = match db.pg_if_online().await {
        Some(pg) => sqlx::query_scalar(SQL).fetch_one(&pg).await?,
        None => sqlx::query_scalar(SQL).fetch_one(&db.lite).await?,
    };
    Ok(count > 0)
}

/// Mirrors every employee from Postgres into SQLite (Postgres is
/// authoritative for master data).
pub(crate) async fn pull_from_pg(pg: &PgPool, lite: &SqlitePool) -> Result<usize, DbError> {
    let rows = sqlx::query_as::<_, Employee>("SELECT * FROM employees")
        .fetch_all(pg)
        .await?;
    for e in &rows {
        upsert_local(lite, e).await?;
    }
    Ok(rows.len())
}
