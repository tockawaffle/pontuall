use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{connect_postgres, keyring_get, DbState, KEYRING_APP_NAME, KEYRING_PG_URI};

const CHECK_INTERVAL: Duration = Duration::from_secs(30);
const PING_TIMEOUT: Duration = Duration::from_secs(3);

/// Watches Postgres reachability. On transition it emits `status:offline`
/// (payload: `true` when offline, matching the legacy event) and kicks a
/// sync run when connectivity comes back.
pub(crate) async fn watch_loop(app: AppHandle) {
    loop {
        let state = app.state::<DbState>();
        let online_now = probe(&state).await;
        let was_online = state.is_online.swap(online_now, Ordering::SeqCst);

        if was_online != online_now {
            let _ = app.emit("status:offline", !online_now);
            if online_now {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = crate::db::sync::run_sync(&app).await {
                        eprintln!("sync after reconnect failed: {e}");
                    }
                });
            }
        }

        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

/// True when the Postgres pool answers `SELECT 1`. Reconnects the pool from
/// the stored configuration when it is missing (e.g. Postgres was down at
/// startup).
async fn probe(state: &DbState) -> bool {
    let pool = state.pg.read().await.clone();

    let pool = match pool {
        Some(pool) => pool,
        None => {
            let (Ok(uri), Ok(app_name)) = (keyring_get(KEYRING_PG_URI), keyring_get(KEYRING_APP_NAME))
            else {
                return false; // not configured yet
            };
            match connect_postgres(&uri, &app_name).await {
                Ok(pool) => {
                    *state.pg.write().await = Some(pool.clone());
                    pool
                }
                Err(_) => return false,
            }
        }
    };

    matches!(
        tokio::time::timeout(PING_TIMEOUT, sqlx::query("SELECT 1").execute(&pool)).await,
        Ok(Ok(_))
    )
}
