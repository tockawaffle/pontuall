use sqlx::{PgPool, SqlitePool};

use crate::db::error::DbError;

pub(crate) async fn get_local(lite: &SqlitePool, key: &str) -> Result<Option<String>, DbError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_config WHERE key = ?1")
            .bind(key)
            .fetch_optional(lite)
            .await?;
    Ok(row.map(|(v,)| v))
}

pub(crate) async fn set_local(lite: &SqlitePool, key: &str, value: &str) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(lite)
    .await?;
    Ok(())
}

pub(crate) async fn upsert_pg(pg: &PgPool, key: &str, value: &str) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO app_config (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(key)
    .bind(value)
    .execute(pg)
    .await?;
    Ok(())
}
