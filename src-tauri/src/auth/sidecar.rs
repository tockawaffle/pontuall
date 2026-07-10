use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::app_flavor::SIDECAR_BIN;
use crate::auth::error::AuthError;
use crate::auth::{AuthState, KEYRING_AUTH_SECRET};
use crate::db::{
    keyring_get, keyring_set, pg_database_name, DbState, KEYRING_APP_NAME, KEYRING_PG_URI,
};

/// Composes the sidecar's DATABASE_URL: stored server URI + application
/// database path.
fn database_url() -> Result<String, AuthError> {
    let uri = keyring_get(KEYRING_PG_URI)?;
    let app_name = keyring_get(KEYRING_APP_NAME)?;
    let mut url = url::Url::parse(&uri)
        .map_err(|e| AuthError::Internal(format!("stored PostgreSQL URI is invalid: {e}")))?;
    url.set_path(&pg_database_name(&app_name));
    Ok(url.to_string())
}

fn auth_secret() -> Result<String, AuthError> {
    if let Ok(secret) = keyring_get(KEYRING_AUTH_SECRET) {
        return Ok(secret);
    }
    let mut bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    let secret = hex::encode(bytes);
    keyring_set(KEYRING_AUTH_SECRET, &secret)?;
    Ok(secret)
}

/// Spawns the BetterAuth sidecar on a free localhost port and waits for its
/// health check (which only answers after its schema migrations ran).
/// Idempotent: a live sidecar is left untouched.
pub(crate) async fn start(app: &AppHandle) -> Result<(), AuthError> {
    let state = app.state::<AuthState>();

    if state.child.lock().map(|c| c.is_some()).unwrap_or(false) {
        return Ok(());
    }

    // Refuse to hand DATABASE_URL and the auth secret to a sidecar binary
    // that was swapped or tampered with on disk.
    #[cfg(windows)]
    crate::auth::signature::verify_sidecar()?;

    let db_url = database_url()?;
    let secret = auth_secret()?;

    // Domain config lives in app_config; migrate the legacy keyring value once,
    // then hand the origins to the sidecar so Better Auth trusts them at boot.
    let db_state = app.state::<DbState>();
    crate::misc::advanced::migrate_domain_config_from_keyring(&db_state)
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;
    let public_url = crate::misc::advanced::configured_public_url(&db_state).await;
    let trusted_origins = crate::misc::advanced::configured_trusted_origins(&db_state).await;

    // Prefer a stable port (Settings → Avançado, default 3435): password
    // links are e-mailed with the machine's address baked in, and a fixed
    // port keeps them valid across app restarts. Fall back to an ephemeral
    // port when it is taken.
    let preferred_port = crate::misc::advanced::configured_port();
    let port = match std::net::TcpListener::bind(("0.0.0.0", preferred_port)) {
        Ok(listener) => {
            drop(listener);
            preferred_port
        }
        Err(_) => {
            let listener = std::net::TcpListener::bind("0.0.0.0:0")
                .map_err(|e| AuthError::Internal(format!("could not reserve a port: {e}")))?;
            let port = listener
                .local_addr()
                .map_err(|e| AuthError::Internal(e.to_string()))?
                .port();
            drop(listener);
            port
        }
    };

    let command = app
        .shell()
        .sidecar(SIDECAR_BIN)
        .map_err(|e| AuthError::SidecarUnavailable(e.to_string()))?
        .env("PORT", port.to_string())
        .env("DATABASE_URL", db_url)
        .env("BETTER_AUTH_SECRET", secret)
        .env("PONTUALL_SHARED_KEY", state.shared_key.clone())
        .env("PONTUALL_PUBLIC_URL", public_url.clone().unwrap_or_default())
        .env("PONTUALL_TRUSTED_ORIGINS", trusted_origins.join(","));

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| AuthError::SidecarUnavailable(e.to_string()))?;

    if let Ok(mut slot) = state.child.lock() {
        *slot = Some(child);
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[auth] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[auth] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[auth] sidecar exited: {:?}", status.code);
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for /health; migrations on first run can take a few seconds.
    let health_url = format!("http://127.0.0.1:{port}/health");
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let response = state
            .client
            .get(&health_url)
            .header("x-pontuall-key", &state.shared_key)
            .timeout(Duration::from_secs(2))
            .send()
            .await;
        if matches!(response, Ok(r) if r.status().is_success()) {
            break;
        }
        if std::time::Instant::now() > deadline {
            stop(app);
            return Err(AuthError::SidecarUnavailable(
                "o serviço de autenticação não respondeu a tempo".into(),
            ));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    *state.port.write().await = Some(port);

    // Best-effort: pre-warm the sidecar's runtime SMTP config so employees
    // can request self-service password recovery from the portal without an
    // admin having sent an email first.
    if let Ok(Some(smtp)) = crate::misc::smtp::get_smtp_config() {
        if let Err(e) = state.push_smtp_config(&smtp).await {
            eprintln!("[auth] smtp push failed: {e}");
        }
    }

    // Best-effort: push work hours schedule to the sidecar so the missed-punch
    // notification scheduler knows when to fire.
    let db_state = app.state::<DbState>();
    if let Some(hours) = crate::misc::work_hours::get_work_hours(&db_state).await {
        if let Err(e) = state.push_work_hours(&hours).await {
            eprintln!("[auth] work hours push failed: {e}");
        }
    }

    Ok(())
}

/// Kills the sidecar; called on app exit.
pub(crate) fn stop(app: &AppHandle) {
    let state = app.state::<AuthState>();
    let child = match state.child.lock() {
        Ok(mut slot) => slot.take(),
        Err(_) => None,
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
}
