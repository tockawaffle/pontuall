use crate::db::error::DbError;
use crate::db::{
    connect_pg_admin, connect_postgres, keyring_set, pg_database_name, KEYRING_APP_NAME,
    KEYRING_PG_URI,
};

/// LGPD Art. 46 (gap #5 em .lgpd/gaps.md): warns when the URI does not force
/// TLS — sqlx defaults to `prefer`, which silently falls back to plaintext.
fn tls_warning(uri: &str) -> Option<String> {
    let sslmode = uri.split_once('?').and_then(|(_, query)| {
        query.split('&').find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key.eq_ignore_ascii_case("sslmode") || key.eq_ignore_ascii_case("ssl-mode"))
                .then(|| value.to_ascii_lowercase())
        })
    });
    match sslmode.as_deref() {
        Some("require") | Some("verify-ca") | Some("verify-full") => None,
        _ => Some(
            "A conexão com o PostgreSQL não exige TLS, então dados pessoais podem trafegar \
             sem criptografia na rede. Se o servidor não estiver nesta máquina, adicione \
             `?sslmode=require` ao final da URI."
                .to_string(),
        ),
    }
}

/// Validates that the given PostgreSQL server is reachable. Returns a
/// warning message when the connection does not force TLS.
#[tauri::command]
pub(crate) async fn test_db_connection(uri: String) -> Result<Option<String>, DbError> {
    let pool = connect_pg_admin(&uri).await?;
    sqlx::query("SELECT 1").execute(&pool).await?;
    pool.close().await;
    Ok(tls_warning(&uri))
}

/// Stores the PostgreSQL configuration, creates the application database if
/// needed and runs migrations. Replaces the old `insert_uri` (which logged
/// the full URI, credentials included, to stdout).
#[tauri::command]
pub(crate) async fn insert_db_config(uri: String, app_name: String) -> Result<bool, DbError> {
    if app_name.trim().is_empty() {
        return Err(DbError::InvalidInput("app name cannot be empty".into()));
    }

    let db_name = pg_database_name(&app_name);

    let admin = connect_pg_admin(&uri).await?;
    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM pg_database WHERE datname = $1")
            .bind(&db_name)
            .fetch_optional(&admin)
            .await?;
    if exists.is_none() {
        // db_name is sanitized to [a-z0-9_] by pg_database_name.
        sqlx::query(&format!("CREATE DATABASE {db_name}"))
            .execute(&admin)
            .await?;
    }
    admin.close().await;

    // Run migrations now so setup fails loudly here instead of at first boot.
    let pool = connect_postgres(&uri, &app_name).await?;
    pool.close().await;

    keyring_set(KEYRING_PG_URI, &uri)?;
    keyring_set(KEYRING_APP_NAME, &app_name)?;

    Ok(true)
}
