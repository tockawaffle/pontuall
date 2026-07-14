use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::app_flavor::DEFAULT_SIDECAR_PORT;
use crate::auth::guard;
use crate::auth::permissions::PermissionAction;
use crate::db::error::DbError;
use crate::db::repo::{config, outbox};
use crate::db::{keyring_get, keyring_set, DbState};

pub(crate) const KEYRING_SIDECAR_PORT: &str = "sidecar_port";
/// Legacy keyring key; value is migrated into `app_config` on startup.
pub(crate) const KEYRING_PUBLIC_URL: &str = "public_url";

const KEY_PUBLIC_URL: &str = "public_url";
const KEY_TRUSTED_ORIGINS: &str = "trusted_origins";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdvancedConfigDto {
    pub port: u16,
    pub public_url: String,
    pub trusted_origins: Vec<String>,
}

/// Port the auth sidecar should listen on. Stays in the keyring — it is not
/// domain config and is read before the DB pool in some paths.
pub(crate) fn configured_port() -> u16 {
    keyring_get(KEYRING_SIDECAR_PORT)
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_SIDECAR_PORT)
}

fn normalize_origin(raw: &str) -> Option<String> {
    let t = raw.trim().trim_end_matches('/');
    if t.is_empty() { None } else { Some(t.to_string()) }
}

/// Parses a user-supplied value into a bare `scheme://host[:port]` origin,
/// rejecting anything that is not a plain http(s) origin (path, query,
/// fragment, userinfo, or an embedded separator). Trusted origins are stored
/// newline-joined but handed to the sidecar comma-joined, so a comma or newline
/// inside one value would be re-split downstream into extra trusted origins;
/// canonicalizing on write closes that parser differential.
fn canonical_origin(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || t.contains(',') || t.contains('\n') {
        return None;
    }
    let url = url::Url::parse(t).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    if url.path() != "/" && !url.path().is_empty() {
        return None;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    })
}

/// Base URL for e-mailed links (domain / reverse proxy), from `app_config`.
pub(crate) async fn configured_public_url(db: &DbState) -> Option<String> {
    let raw = config::get_local(&db.lite, KEY_PUBLIC_URL).await.ok()??;
    normalize_origin(&raw)
}

/// Additional origins trusted by Better Auth's CSRF/origin check (proxied
/// domains), stored newline-separated in `app_config`.
pub(crate) async fn configured_trusted_origins(db: &DbState) -> Vec<String> {
    let Some(raw) = config::get_local(&db.lite, KEY_TRUSTED_ORIGINS).await.ok().flatten() else {
        return Vec::new();
    };
    raw.lines().filter_map(normalize_origin).collect()
}

async fn save_config(db: &DbState, key: &str, value: &str) -> Result<(), DbError> {
    config::set_local(&db.lite, key, value).await?;

    #[derive(Serialize)]
    struct OutboxPayload<'a> {
        key: &'a str,
        value: &'a str,
    }
    outbox::enqueue(&db.lite, "upsert_app_config", &OutboxPayload { key, value }).await?;

    if let Some(pg) = db.pg_if_online().await {
        let _ = config::upsert_pg(&pg, key, value).await;
    }
    Ok(())
}

/// One-time move of the legacy keyring `public_url` into `app_config`. No-op
/// once `app_config` holds the key.
pub(crate) async fn migrate_domain_config_from_keyring(db: &DbState) -> Result<(), DbError> {
    if config::get_local(&db.lite, KEY_PUBLIC_URL).await?.is_some() {
        return Ok(());
    }
    if let Ok(value) = keyring_get(KEYRING_PUBLIC_URL) {
        if let Some(normalized) = normalize_origin(&value) {
            save_config(db, KEY_PUBLIC_URL, &normalized).await?;
        }
    }
    Ok(())
}

/// Persists port (keyring) + public URL and trusted origins (app_config).
pub(crate) async fn save_advanced(
    db: &DbState,
    port: u16,
    public_url: &str,
    trusted_origins: &[String],
) -> Result<(), DbError> {
    keyring_set(KEYRING_SIDECAR_PORT, &port.to_string())?;

    let public = canonical_origin(public_url).unwrap_or_default();
    save_config(db, KEY_PUBLIC_URL, &public).await?;

    let mut seen = std::collections::HashSet::new();
    let list: Vec<String> = trusted_origins
        .iter()
        .filter_map(|o| canonical_origin(o))
        .filter(|o| seen.insert(o.clone()))
        .collect();
    save_config(db, KEY_TRUSTED_ORIGINS, &list.join("\n")).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_advanced_config_cmd(app: AppHandle) -> Result<AdvancedConfigDto, DbError> {
    let db = app.state::<DbState>();
    Ok(AdvancedConfigDto {
        port: configured_port(),
        public_url: configured_public_url(&db).await.unwrap_or_default(),
        trusted_origins: configured_trusted_origins(&db).await,
    })
}

#[tauri::command]
pub(crate) async fn set_advanced_config_cmd(
    app: AppHandle,
    port: u16,
    public_url: String,
    trusted_origins: Vec<String>,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    if port < 1024 {
        return Err(DbError::InvalidInput("a porta deve ser 1024 ou maior".into()));
    }
    let validate = |value: &str| -> Result<(), DbError> {
        if !value.trim().is_empty() && canonical_origin(value).is_none() {
            return Err(DbError::InvalidInput(
                "os endereços devem ser uma origem http(s) simples, sem caminho".into(),
            ));
        }
        Ok(())
    };
    validate(&public_url)?;
    for origin in &trusted_origins {
        validate(origin)?;
    }

    let db = app.state::<DbState>();
    save_advanced(&db, port, &public_url, &trusted_origins).await?;

    // Push to the running sidecar so the change applies without a restart.
    let auth = app.state::<crate::auth::AuthState>();
    let public = configured_public_url(&db).await;
    let origins = configured_trusted_origins(&db).await;
    if let Err(e) = auth.push_public_origins(public.as_deref(), &origins).await {
        eprintln!("[advanced] public-origins push failed: {e}");
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbState;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    async fn memory_db() -> DbState {
        let options = SqliteConnectOptions::new().filename(":memory:").foreign_keys(true);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        sqlx::migrate!("./migrations/sqlite").run(&pool).await.unwrap();
        DbState::new(pool)
    }

    #[test]
    fn canonical_origin_rejects_non_bare_origins() {
        assert_eq!(canonical_origin("https://a.com/"), Some("https://a.com".into()));
        assert_eq!(canonical_origin("  https://a.com  "), Some("https://a.com".into()));
        assert_eq!(canonical_origin("https://a.com:8443"), Some("https://a.com:8443".into()));
        // Default ports are dropped so the stored origin matches the browser's.
        assert_eq!(canonical_origin("https://a.com:443"), Some("https://a.com".into()));

        for bad in [
            "",
            "a.com",
            "ftp://a.com",
            "https://a.com/path",
            "https://a.com/?q=1",
            "https://a.com/#frag",
            "https://user:pass@a.com",
            "https://a.com,https://evil.com",
            "https://a.com\nhttps://evil.com",
        ] {
            assert_eq!(canonical_origin(bad), None, "should reject {bad:?}");
        }
    }

    #[tokio::test]
    async fn saves_and_reads_domain_config() {
        let db = memory_db().await;
        assert_eq!(configured_public_url(&db).await, None);
        assert!(configured_trusted_origins(&db).await.is_empty());

        save_advanced(
            &db,
            4000,
            "https://ponto.example.com/",
            &["https://a.trycloudflare.com".into(), " ".into(), "https://b.playit.gg/".into()],
        )
        .await
        .unwrap();

        assert_eq!(configured_public_url(&db).await, Some("https://ponto.example.com".into()));
        assert_eq!(
            configured_trusted_origins(&db).await,
            vec!["https://a.trycloudflare.com".to_string(), "https://b.playit.gg".to_string()],
        );
    }
}
