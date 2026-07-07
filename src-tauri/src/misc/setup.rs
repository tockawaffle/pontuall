use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::error::DbError;
use crate::db::{connect_postgres, keyring_get, DbState, KEYRING_APP_NAME, KEYRING_PG_URI};

pub(crate) struct SetupState {
    pub frontend_task: bool,
    pub backend_task: bool,
}

/// Backend boot: connect Postgres from the stored configuration (staying
/// offline when unreachable), refresh the SQLite mirror, start the
/// connectivity watcher.
async fn setup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();

    match (keyring_get(KEYRING_PG_URI), keyring_get(KEYRING_APP_NAME)) {
        (Ok(uri), Ok(app_name)) => match connect_postgres(&uri, &app_name).await {
            Ok(pool) => {
                *state.pg.write().await = Some(pool);
                state
                    .is_online
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            Err(e) => {
                eprintln!("PostgreSQL unreachable, starting offline: {e}");
            }
        },
        _ => {
            eprintln!("no database configured yet, starting offline");
        }
    }

    tauri::async_runtime::spawn(crate::db::online::watch_loop(app.clone()));
    tauri::async_runtime::spawn(crate::db::retention::retention_loop(app.clone()));

    // Auth requires Postgres; when offline the app still boots, but login
    // stays unavailable until connectivity returns.
    if let Err(e) = crate::auth::sidecar::start(&app).await {
        eprintln!("auth sidecar not started: {e}");
    }

    emit_progress(&app, "database");

    if let Err(e) = crate::db::sync::run_sync(&app).await {
        eprintln!("initial sync failed: {e}");
    }
    emit_progress(&app, "cache");
    emit_progress(&app, "finish");

    finish(&app, Task::Backend).map_err(|e| e.to_string())
}

fn emit_progress(app: &AppHandle, step: &str) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.emit("splashscreen:progress", (step, true));
    }
}

enum Task {
    Frontend,
    Backend,
}

/// Marks one side of the boot handshake done; when both frontend and backend
/// have finished, swaps the splashscreen for the main window.
fn finish(app: &AppHandle, task: Task) -> Result<(), DbError> {
    let state: State<'_, Mutex<SetupState>> = app.state();
    let mut lock = state
        .lock()
        .map_err(|_| DbError::Config("setup state poisoned".into()))?;

    match task {
        Task::Frontend => lock.frontend_task = true,
        Task::Backend => lock.backend_task = true,
    }

    if lock.backend_task && lock.frontend_task {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.maximize();
            let _ = main_window.center();
            let _ = main_window.show();
        } else {
            WebviewWindowBuilder::new(app, "main".to_string(), WebviewUrl::default())
                .title("PontuAll")
                .center()
                .maximized(true)
                .visible(true)
                .build()
                .map_err(|e| DbError::Config(format!("could not create main window: {e}")))?;
        }

        if let Some(splash) = app.get_webview_window("splashscreen") {
            let _ = splash.close();
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn complete_setup(app: AppHandle, task: String) -> Result<(), String> {
    match task.as_str() {
        "finish_frontend" => {
            finish(&app, Task::Frontend).map_err(|e| e.to_string())?;
            tauri::async_runtime::spawn(setup(app));
            Ok(())
        }
        "finish_backend" => finish(&app, Task::Backend).map_err(|e| e.to_string()),
        other => Err(format!("unknown setup task: {other}")),
    }
}
