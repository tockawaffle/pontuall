pub(crate) mod client;
pub(crate) mod commands;
pub(crate) mod error;
pub(crate) mod guard;
pub(crate) mod permissions;
pub(crate) mod sidecar;

use std::collections::HashMap;
use std::time::Instant;

use serde::Serialize;
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::{Mutex, RwLock};

use crate::auth::error::AuthError;

pub(crate) const KEYRING_AUTH_SECRET: &str = "better_auth_secret";

/// What the frontend knows about a logged-in user (never includes credentials).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserLoggedDto {
    pub id: String,
    pub name: String,
    pub image: Option<String>,
    /// Job title from the employee record.
    pub role: String,
    /// Better Auth access role (`employee`, `supervisor`, `administrator`).
    pub access_role: String,
}

pub(crate) struct CachedSession {
    pub user: UserLoggedDto,
    pub auth_role: String,
    pub fetched_at: Instant,
}

pub(crate) struct AuthState {
    pub port: RwLock<Option<u16>>,
    /// Per-launch key; the sidecar rejects requests without it so other
    /// local processes cannot talk to the auth listener.
    pub shared_key: String,
    pub client: reqwest::Client,
    pub session_cache: Mutex<HashMap<String, CachedSession>>,
    pub child: std::sync::Mutex<Option<CommandChild>>,
    /// The active user's session token, held only in the backend. The webview
    /// never receives it, so an XSS in the view cannot exfiltrate a session.
    /// Kiosk model: at most one privileged user is signed in at a time.
    current_session: RwLock<Option<String>>,
}

impl AuthState {
    pub(crate) fn new() -> Self {
        let mut key = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
        Self {
            port: RwLock::new(None),
            shared_key: hex::encode(key),
            client: reqwest::Client::new(),
            session_cache: Mutex::new(HashMap::new()),
            child: std::sync::Mutex::new(None),
            current_session: RwLock::new(None),
        }
    }

    /// Clears cached sessions after admin mutations (role, password, ban).
    pub(crate) async fn clear_session_cache(&self) {
        self.session_cache.lock().await.clear();
    }

    /// Records the token of the just-signed-in user.
    pub(crate) async fn set_current_session(&self, token: String) {
        *self.current_session.write().await = Some(token);
    }

    /// Removes and returns the active token (used on sign-out).
    pub(crate) async fn take_current_session(&self) -> Option<String> {
        self.current_session.write().await.take()
    }

    /// The active token, or `InvalidSession` when no one is signed in.
    pub(crate) async fn current_session(&self) -> Result<String, AuthError> {
        self.current_session
            .read()
            .await
            .clone()
            .ok_or(AuthError::InvalidSession)
    }
}
