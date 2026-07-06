use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, SqlitePool};

use crate::db::error::DbError;
use crate::db::repo::outbox;
use crate::db::{lite_sql, DbState};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub(crate) struct Card {
    pub id: String,
    pub uid: String,
    pub employee_id: String,
    pub active_token_hash: String,
    pub pending_token_hash: Option<String>,
    pub token_counter: i64,
    pub status: String,
    pub provisioned_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

const UPSERT: &str = "\
INSERT INTO cards (id, uid, employee_id, active_token_hash, pending_token_hash, token_counter, status, provisioned_at, last_seen_at) \
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
ON CONFLICT (id) DO UPDATE SET \
  uid = excluded.uid, employee_id = excluded.employee_id, \
  active_token_hash = excluded.active_token_hash, pending_token_hash = excluded.pending_token_hash, \
  token_counter = excluded.token_counter, status = excluded.status, last_seen_at = excluded.last_seen_at";

fn bind_upsert<'q, DB>(
    query: sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>,
    c: &'q Card,
) -> sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database,
    String: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<String>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    i64: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    DateTime<Utc>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
    Option<DateTime<Utc>>: sqlx::Type<DB> + sqlx::Encode<'q, DB>,
{
    query
        .bind(&c.id)
        .bind(&c.uid)
        .bind(&c.employee_id)
        .bind(&c.active_token_hash)
        .bind(&c.pending_token_hash)
        .bind(c.token_counter)
        .bind(&c.status)
        .bind(c.provisioned_at)
        .bind(c.last_seen_at)
}

pub(crate) async fn upsert_local(lite: &SqlitePool, c: &Card) -> Result<(), DbError> {
    let sql = lite_sql(UPSERT);
    bind_upsert(sqlx::query(&sql), c).execute(lite).await?;
    Ok(())
}

pub(crate) async fn upsert_pg(pg: &PgPool, c: &Card) -> Result<(), DbError> {
    bind_upsert(sqlx::query(UPSERT), c).execute(pg).await?;
    Ok(())
}

/// Persists a card locally and, when online, to Postgres; offline it queues
/// a `card_token_rotate` op so the sync replay keeps counters aligned.
pub(crate) async fn upsert(db: &DbState, c: &Card) -> Result<(), DbError> {
    upsert_local(&db.lite, c).await?;
    match db.pg_if_online().await {
        Some(pg) => {
            if upsert_pg(&pg, c).await.is_err() {
                db.mark_offline();
                outbox::enqueue(&db.lite, "card_token_rotate", c).await?;
            }
        }
        None => outbox::enqueue(&db.lite, "card_token_rotate", c).await?,
    }
    Ok(())
}

pub(crate) async fn find_by_uid(db: &DbState, uid: &str) -> Result<Option<Card>, DbError> {
    // Prefer Postgres when online so a rotation on another terminal is seen.
    if let Some(pg) = db.pg_if_online().await {
        let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE uid = $1")
            .bind(uid)
            .fetch_optional(&pg)
            .await?;
        if let Some(row) = &row {
            upsert_local(&db.lite, row).await?;
        }
        return Ok(row);
    }
    let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE uid = ?1")
        .bind(uid)
        .fetch_optional(&db.lite)
        .await?;
    Ok(row)
}

pub(crate) async fn find_by_employee(db: &DbState, employee_id: &str) -> Result<Vec<Card>, DbError> {
    if let Some(pg) = db.pg_if_online().await {
        let rows = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_all(&pg)
            .await?;
        return Ok(rows);
    }
    let rows = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE employee_id = ?1")
        .bind(employee_id)
        .fetch_all(&db.lite)
        .await?;
    Ok(rows)
}

pub(crate) async fn find_by_id(db: &DbState, id: &str) -> Result<Option<Card>, DbError> {
    if let Some(pg) = db.pg_if_online().await {
        let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = $1")
            .bind(id)
            .fetch_optional(&pg)
            .await?;
        return Ok(row);
    }
    let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ?1")
        .bind(id)
        .fetch_optional(&db.lite)
        .await?;
    Ok(row)
}

pub(crate) async fn delete(db: &DbState, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM cards WHERE id = ?1")
        .bind(id)
        .execute(&db.lite)
        .await?;
    if let Some(pg) = db.pg_if_online().await {
        sqlx::query("DELETE FROM cards WHERE id = $1")
            .bind(id)
            .execute(&pg)
            .await?;
    }
    Ok(())
}

pub(crate) async fn log_event(
    db: &DbState,
    card_id: Option<&str>,
    event_type: &str,
    details: Option<String>,
) -> Result<(), DbError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO card_events (id, card_id, event_type, details, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&id)
    .bind(card_id)
    .bind(event_type)
    .bind(&details)
    .bind(now)
    .execute(&db.lite)
    .await?;

    if let Some(pg) = db.pg_if_online().await {
        let _ = sqlx::query(
            "INSERT INTO card_events (id, card_id, event_type, details, created_at) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&id)
        .bind(card_id)
        .bind(event_type)
        .bind(&details)
        .bind(now)
        .execute(&pg)
        .await;
    }
    Ok(())
}
