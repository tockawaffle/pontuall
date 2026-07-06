use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::auth::guard;
use crate::card::errors::CardError;
use crate::card::flows::{self, TapResult};
use crate::card::keys;
use crate::card::service::CardService;
use crate::auth::permissions::PermissionAction;
use crate::db::repo::cards;
use crate::db::DbState;

#[derive(Serialize)]
pub(crate) struct ReaderStatus {
    connected: bool,
    name: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct CardInfo {
    id: String,
    uid: String,
    employee_id: String,
    status: String,
}

#[derive(Serialize)]
pub(crate) struct CardDiag {
    uid: String,
    magic_ok: bool,
    authenticated: bool,
}

#[tauri::command]
pub(crate) async fn reader_status(
    service: State<'_, Arc<CardService>>,
) -> Result<ReaderStatus, CardError> {
    match service.reader_status().await {
        Ok(name) => Ok(ReaderStatus {
            connected: name.is_some(),
            name,
        }),
        Err(CardError::ReaderUnavailable) | Err(CardError::ServiceUnavailable(_)) => {
            Ok(ReaderStatus {
                connected: false,
                name: None,
            })
        }
        Err(e) => Err(e),
    }
}

/// Waits for one tap and returns the identified employee (or a distinct
/// outcome for unknown/blocked/clone cards). Records no punch.
#[tauri::command]
pub(crate) async fn card_await_tap(
    app: AppHandle,
    service: State<'_, Arc<CardService>>,
    db: State<'_, DbState>,
) -> Result<TapResult, CardError> {
    let result = flows::tap(&app, &service, &db).await?;
    let _ = tauri::Emitter::emit(&app, "card:tap_result", &result);
    Ok(result)
}

#[tauri::command]
pub(crate) async fn card_cancel(service: State<'_, Arc<CardService>>) -> Result<(), CardError> {
    service.cancel();
    Ok(())
}

#[tauri::command]
pub(crate) async fn provision_card(
    app: AppHandle,
    service: State<'_, Arc<CardService>>,
    db: State<'_, DbState>,
    employee_id: String,
    force: bool,
) -> Result<CardInfo, CardError> {
    guard::require_current(&app, PermissionAction::ProvisionCard).await?;
    let card = flows::provision(&service, &db, &employee_id, force).await?;
    Ok(CardInfo {
        id: card.id,
        uid: card.uid,
        employee_id: card.employee_id,
        status: card.status,
    })
}

/// Provisions a replacement card and blocks the employee's previous cards
/// (used when a card is lost or damaged).
#[tauri::command]
pub(crate) async fn reprovision_card(
    app: AppHandle,
    service: State<'_, Arc<CardService>>,
    db: State<'_, DbState>,
    employee_id: String,
    force: bool,
) -> Result<CardInfo, CardError> {
    guard::require_current(&app, PermissionAction::ProvisionCard).await?;
    let card = flows::reprovision(&service, &db, &employee_id, force).await?;
    Ok(CardInfo {
        id: card.id,
        uid: card.uid,
        employee_id: card.employee_id,
        status: card.status,
    })
}

#[tauri::command]
pub(crate) async fn unprovision_card(
    app: AppHandle,
    service: State<'_, Arc<CardService>>,
    db: State<'_, DbState>,
    card_id: String,
) -> Result<(), CardError> {
    guard::require_current(&app, PermissionAction::ProvisionCard).await?;
    flows::unprovision(&service, &db, &card_id).await
}

/// Unblock a card after a clone investigation (or otherwise change status).
#[tauri::command]
pub(crate) async fn set_card_status(
    app: AppHandle,
    db: State<'_, DbState>,
    card_id: String,
    status: String,
) -> Result<(), CardError> {
    guard::require_current(&app, PermissionAction::ProvisionCard).await?;
    if !matches!(status.as_str(), "active" | "blocked" | "clone_suspected") {
        return Err(CardError::Internal(format!("status inválido: {status}")));
    }
    let mut card = cards::find_by_id(&db, &card_id)
        .await?
        .ok_or_else(|| CardError::Internal("cartão não encontrado".into()))?;
    card.status = status;
    cards::upsert(&db, &card).await?;
    Ok(())
}

/// Diagnostic used by Settings: verifies the reader can see and authenticate
/// a provisioned card without rotating its token.
#[tauri::command]
pub(crate) async fn card_diagnostic(
    app: AppHandle,
    service: State<'_, Arc<CardService>>,
) -> Result<CardDiag, CardError> {
    guard::require_current(&app, PermissionAction::ReadSelf).await?;

    let uid = service.await_card_uid(10000).await?;
    let master = keys::master_key()?;
    let derived = keys::derive_keys(&master, &uid);

    match service.read_state(derived).await {
        Ok(state) => Ok(CardDiag {
            uid: hex::encode(&state.uid),
            magic_ok: state.magic_ok,
            authenticated: true,
        }),
        Err(CardError::CardRefused(_)) | Err(CardError::UnsupportedCard) => Ok(CardDiag {
            uid: hex::encode(&uid),
            magic_ok: false,
            authenticated: false,
        }),
        Err(e) => Err(e),
    }
}

/// Admin-only: reveal the card master key for offline backup. Losing this key
/// (e.g. Windows reinstall) makes all provisioned cards unwritable.
#[tauri::command]
pub(crate) async fn export_card_master_key(
    app: AppHandle,
) -> Result<String, CardError> {
    guard::require_current(&app, PermissionAction::SuperUser).await?;
    keys::export_master_key()
}

#[tauri::command]
pub(crate) async fn import_card_master_key(
    app: AppHandle,
    key_hex: String,
) -> Result<(), CardError> {
    guard::require_current(&app, PermissionAction::SuperUser).await?;
    keys::import_master_key(&key_hex)
}
