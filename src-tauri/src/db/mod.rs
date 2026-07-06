pub(crate) mod commands;
pub(crate) mod error;
pub(crate) mod models;
pub(crate) mod online;
pub(crate) mod repo;
pub(crate) mod setup_cmds;
pub(crate) mod sync;

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{ConnectOptions, PgPool, SqlitePool};
use tokio::sync::RwLock;

use error::DbError;

pub(crate) const KEYRING_SERVICE: &str = "PontuAll";
pub(crate) const KEYRING_PG_URI: &str = "postgres_uri";
pub(crate) const KEYRING_APP_NAME: &str = "app_name";

pub(crate) struct DbState {
    pub lite: SqlitePool,
    pub pg: RwLock<Option<PgPool>>,
    pub is_online: AtomicBool,
}

impl DbState {
    pub(crate) fn new(lite: SqlitePool) -> Self {
        Self {
            lite,
            pg: RwLock::new(None),
            is_online: AtomicBool::new(false),
        }
    }

    /// The Postgres pool, but only while the app considers itself online.
    pub(crate) async fn pg_if_online(&self) -> Option<PgPool> {
        if self.is_online.load(Ordering::SeqCst) {
            self.pg.read().await.clone()
        } else {
            None
        }
    }

    pub(crate) fn mark_offline(&self) {
        self.is_online.store(false, Ordering::SeqCst);
    }
}

/// Rewrites `$1, $2, ...` placeholders to SQLite's `?1, ?2, ...` so the same
/// SQL constant can run against both backends.
pub(crate) fn lite_sql(sql: &str) -> String {
    sql.replace('$', "?")
}

pub(crate) async fn init_sqlite() -> Result<SqlitePool, DbError> {
    let dir = dirs::data_dir()
        .ok_or_else(|| DbError::Config("could not resolve the local data directory".into()))?
        .join("PontuAll");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| DbError::Config(format!("could not create data directory: {e}")))?;

    let options = SqliteConnectOptions::new()
        .filename(dir.join("offline.db"))
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations/sqlite").run(&pool).await?;

    Ok(pool)
}

/// Sanitized database name for a company/app name: `pontuall_{app_name}`.
pub(crate) fn pg_database_name(app_name: &str) -> String {
    let safe: String = app_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    format!("pontuall_{safe}")
}

fn pg_options(uri: &str, database: &str) -> Result<PgConnectOptions, DbError> {
    let options = PgConnectOptions::from_str(uri)
        .map_err(|e| DbError::Config(format!("invalid PostgreSQL URI: {e}")))?
        .database(database);
    Ok(options.disable_statement_logging())
}

/// Connects to the server's maintenance database; used to validate the URI
/// and to create the application database.
pub(crate) async fn connect_pg_admin(uri: &str) -> Result<PgPool, DbError> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(pg_options(uri, "postgres")?)
        .await?;
    Ok(pool)
}

/// Connects to the application database and runs migrations.
pub(crate) async fn connect_postgres(uri: &str, app_name: &str) -> Result<PgPool, DbError> {
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(pg_options(uri, &pg_database_name(app_name))?)
        .await?;

    sqlx::migrate!("./migrations/postgres").run(&pool).await?;

    Ok(pool)
}

pub(crate) fn keyring_get(key: &str) -> Result<String, DbError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key)?;
    Ok(entry.get_password()?)
}

pub(crate) fn keyring_set(key: &str, value: &str) -> Result<(), DbError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key)?;
    entry.set_password(value)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{Employee, DAY_KEY_FORMAT};
    use crate::db::repo::time_entries::UpdateKey;
    use crate::db::repo::{employees, outbox, time_entries};
    use chrono::{NaiveDate, Utc};

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

    fn employee(id: &str, name: &str) -> Employee {
        let now = Utc::now();
        Employee {
            id: id.into(),
            name: name.into(),
            email: Some(format!("{id}@test.local")),
            phone: None,
            role: "Tester".into(),
            lunch_time: Some("12:00".into()),
            status: "active".into(),
            auth_user_id: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn employee_and_punch_roundtrip() {
        let db = memory_db().await;

        // Offline write lands locally and queues for sync.
        employees::upsert(&db, &employee("emp1", "Alice")).await.unwrap();
        let listed = employees::list_local(&db.lite).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Alice");

        let date = NaiveDate::from_ymd_opt(2026, 7, 3).unwrap();
        let ts = Utc::now();
        time_entries::set_field(&db, "emp1", date, UpdateKey::ClockIn, ts)
            .await
            .unwrap();
        time_entries::set_field(&db, "emp1", date, UpdateKey::ClockOut, ts)
            .await
            .unwrap();

        // Both fields merged into one row.
        let row = time_entries::find_local(&db.lite, "emp1", date)
            .await
            .unwrap()
            .expect("time entry row");
        assert!(row.clock_in.is_some());
        assert!(row.clock_out.is_some());

        // 1 employee + 2 punch snapshots queued.
        assert_eq!(outbox::pending(&db.lite).await.unwrap().len(), 3);

        // Legacy wire shape used by the frontend.
        let user = listed[0].to_user_external(std::slice::from_ref(&row));
        let hour_data = user.hour_data.unwrap();
        let key = date.format(DAY_KEY_FORMAT).to_string();
        assert!(hour_data.contains_key(&key));
        assert_ne!(hour_data[&key].clock_in, "N/A");
    }

    /// Needs a live server: TEST_PG_URI=postgres://user:pass@host:port
    /// cargo test postgres_roundtrip -- --ignored
    #[tokio::test]
    #[ignore]
    async fn postgres_roundtrip() {
        let uri = std::env::var("TEST_PG_URI").expect("TEST_PG_URI not set");
        let app_name = "migrationtest";
        let db_name = pg_database_name(app_name);

        let admin = connect_pg_admin(&uri).await.unwrap();
        sqlx::query(&format!("DROP DATABASE IF EXISTS {db_name}"))
            .execute(&admin)
            .await
            .unwrap();
        sqlx::query(&format!("CREATE DATABASE {db_name}"))
            .execute(&admin)
            .await
            .unwrap();
        admin.close().await;

        let pool = connect_postgres(&uri, app_name).await.unwrap();

        let e = employee("pg1", "Postgres Alice");
        employees::upsert_pg(&pool, &e).await.unwrap();
        // Second upsert with the same id must update, not fail.
        employees::upsert_pg(&pool, &e).await.unwrap();

        let date = NaiveDate::from_ymd_opt(2026, 7, 3).unwrap();
        let entry = crate::db::models::TimeEntry {
            id: "te1".into(),
            employee_id: "pg1".into(),
            work_date: date,
            clock_in: Some(Utc::now()),
            lunch_out: None,
            lunch_return: None,
            clock_out: None,
            updated_at: Utc::now(),
            punch_sources: None,
        };
        time_entries::upsert_row_pg(&pool, &entry).await.unwrap();
        time_entries::upsert_row_pg(&pool, &entry).await.unwrap();

        let rows = sqlx::query_as::<_, Employee>("SELECT * FROM employees")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Postgres Alice");

        // Mirror pull path used by sync.
        let lite = memory_db().await;
        employees::pull_from_pg(&pool, &lite.lite).await.unwrap();
        time_entries::pull_from_pg(&pool, &lite.lite).await.unwrap();
        assert_eq!(employees::list_local(&lite.lite).await.unwrap().len(), 1);
        assert_eq!(time_entries::list_local(&lite.lite).await.unwrap().len(), 1);

        pool.close().await;
    }

    #[tokio::test]
    async fn duplicate_email_is_rejected_by_unique_index() {
        let db = memory_db().await;
        let mut a = employee("a", "A");
        let mut b = employee("b", "B");
        a.email = Some("same@test.local".into());
        b.email = Some("same@test.local".into());
        employees::upsert_local(&db.lite, &a).await.unwrap();
        assert!(employees::upsert_local(&db.lite, &b).await.is_err());
    }
}
