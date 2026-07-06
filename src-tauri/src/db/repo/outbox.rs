use chrono::Utc;
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

use crate::db::error::DbError;

#[derive(Debug, FromRow)]
pub(crate) struct OutboxRow {
    pub id: i64,
    pub op_type: String,
    pub payload: String,
}

pub(crate) async fn enqueue<T: Serialize>(
    lite: &SqlitePool,
    op_type: &str,
    payload: &T,
) -> Result<(), DbError> {
    let payload = serde_json::to_string(payload)
        .map_err(|e| DbError::InvalidInput(format!("could not serialize outbox payload: {e}")))?;
    sqlx::query("INSERT INTO sync_outbox (op_type, payload, created_at) VALUES (?1, ?2, ?3)")
        .bind(op_type)
        .bind(payload)
        .bind(Utc::now())
        .execute(lite)
        .await?;
    Ok(())
}

pub(crate) async fn pending(lite: &SqlitePool) -> Result<Vec<OutboxRow>, DbError> {
    let rows = sqlx::query_as::<_, OutboxRow>(
        "SELECT id, op_type, payload FROM sync_outbox WHERE synced_at IS NULL ORDER BY id ASC",
    )
    .fetch_all(lite)
    .await?;
    Ok(rows)
}

pub(crate) async fn mark_synced(lite: &SqlitePool, id: i64) -> Result<(), DbError> {
    sqlx::query("UPDATE sync_outbox SET synced_at = ?1 WHERE id = ?2")
        .bind(Utc::now())
        .bind(id)
        .execute(lite)
        .await?;
    Ok(())
}
