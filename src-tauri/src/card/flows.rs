//! Tap / provision orchestration: rolling one-time token with clone
//! detection. The card holds an opaque random token; every successful tap
//! verifies it against the DB then writes a fresh one. A stale token means a
//! clone diverged, so the card is blocked and an alert is raised.

use chrono::Utc;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::card::apdu::BLOCK_SIZE;
use crate::card::errors::CardError;
use crate::card::keys::{self, CardKeys};
use crate::card::service::CardService;
use crate::db::repo::cards::{self, Card};
use crate::db::DbState;
use std::sync::Arc;

pub(crate) fn token_hash(token: &[u8]) -> String {
    hex::encode(Sha256::digest(token))
}

fn random_token() -> [u8; BLOCK_SIZE] {
    let mut token = [0u8; BLOCK_SIZE];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut token);
    token
}

fn card_keys(uid: &[u8]) -> Result<CardKeys, CardError> {
    let master = keys::master_key()?;
    Ok(keys::derive_keys(&master, uid))
}

/// The outcome of validating a card's token against the stored hashes.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TokenMatch {
    /// Token matches the active hash — normal tap.
    Active,
    /// Token matches the pending hash — a prior rotation crashed between the
    /// card write and the DB promote; promote it now (still validates once).
    Pending,
    /// Token matches neither — this card (or its clone) is stale.
    Clone,
}

/// Pure clone-detection decision (unit-tested).
pub(crate) fn classify_token(
    read_hash: &str,
    active_hash: &str,
    pending_hash: Option<&str>,
) -> TokenMatch {
    if read_hash == active_hash {
        TokenMatch::Active
    } else if pending_hash == Some(read_hash) {
        TokenMatch::Pending
    } else {
        TokenMatch::Clone
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum TapResult {
    Ok { employee_id: String },
    UnknownCard { uid: String },
    Blocked { employee_id: String },
    CloneDetected { employee_id: String, uid: String },
}

/// One tap: identify the card, verify + rotate the token, return the
/// employee. Never records a punch — the caller decides what a tap means.
pub(crate) async fn tap(
    app: &AppHandle,
    service: &Arc<CardService>,
    db: &DbState,
) -> Result<TapResult, CardError> {
    // 1. UID first (cheap, no auth) so unknown cards report their UID.
    let uid = service.await_card_uid(5000).await?;
    let uid_hex = hex::encode(&uid);
    let _ = tauri::Emitter::emit(app, "card:detected", serde_json::json!({ "uid": uid_hex }));

    let Some(mut card) = cards::find_by_uid(db, &uid_hex).await? else {
        cards::log_event(db, None, "unknown_card", Some(uid_hex.clone())).await?;
        return Ok(TapResult::UnknownCard { uid: uid_hex });
    };

    if card.status == "blocked" {
        return Ok(TapResult::Blocked {
            employee_id: card.employee_id,
        });
    }

    // 2. Authenticated read of magic + token.
    let keys = card_keys(&uid)?;
    let state = service.read_state(keys).await?;
    if !state.magic_ok {
        cards::log_event(db, Some(&card.id), "unknown_card", Some(uid_hex.clone())).await?;
        return Ok(TapResult::UnknownCard { uid: uid_hex });
    }

    let read_hash = token_hash(&state.token);
    match classify_token(&read_hash, &card.active_token_hash, card.pending_token_hash.as_deref()) {
        TokenMatch::Active => {}
        TokenMatch::Pending => {
            // Recover the interrupted prior rotation: promote pending.
            card.active_token_hash = read_hash.clone();
            card.pending_token_hash = None;
            card.token_counter += 1;
        }
        TokenMatch::Clone => {
            card.status = "blocked".to_string();
            card.last_seen_at = Some(Utc::now());
            cards::upsert(db, &card).await?;
            cards::log_event(db, Some(&card.id), "clone_detected", Some(uid_hex.clone())).await?;
            let _ = tauri::Emitter::emit(
                app,
                "card:clone_detected",
                serde_json::json!({ "employee_id": card.employee_id, "uid": uid_hex }),
            );
            return Ok(TapResult::CloneDetected {
                employee_id: card.employee_id,
                uid: uid_hex,
            });
        }
    }

    // 3. Rotate with the pending-token protocol so a token validates exactly
    //    once even if any single step fails.
    let new_token = random_token();
    let new_hash = token_hash(&new_token);
    let new_counter = (card.token_counter + 1) as u64;

    // (a) Persist pending BEFORE writing the card.
    card.pending_token_hash = Some(new_hash.clone());
    card.last_seen_at = Some(Utc::now());
    cards::upsert(db, &card).await?;

    // (b) Write the card (verified read-back inside write_token).
    let keys = card_keys(&uid)?;
    service.write_token(keys, new_token, new_counter).await?;

    // (c) Promote in the DB.
    card.active_token_hash = new_hash;
    card.pending_token_hash = None;
    card.token_counter = new_counter as i64;
    cards::upsert(db, &card).await?;
    cards::log_event(db, Some(&card.id), "tap_ok", None).await?;

    Ok(TapResult::Ok {
        employee_id: card.employee_id,
    })
}

/// Provisions a card for an employee: writes derived keys + an initial token
/// and records the card row.
pub(crate) async fn provision(
    service: &Arc<CardService>,
    db: &DbState,
    employee_id: &str,
) -> Result<Card, CardError> {
    // Read UID first (blank card authenticates with the factory key inside
    // service.provision), so derive keys after we have it.
    let probe_uid = service.await_card_uid(30000).await?;
    let uid_hex = hex::encode(&probe_uid);

    if let Some(existing) = cards::find_by_uid(db, &uid_hex).await? {
        if existing.status != "blocked" {
            return Err(CardError::Conflict(
                "este cartão já está provisionado".into(),
            ));
        }
    }

    let keys = card_keys(&probe_uid)?;
    let initial_token = random_token();
    let uid = service.provision(keys, initial_token).await?;
    let uid_hex = hex::encode(&uid);

    let card = Card {
        id: uuid::Uuid::new_v4().to_string(),
        uid: uid_hex,
        employee_id: employee_id.to_string(),
        active_token_hash: token_hash(&initial_token),
        pending_token_hash: None,
        token_counter: 0,
        status: "active".to_string(),
        provisioned_at: Utc::now(),
        last_seen_at: None,
    };
    cards::upsert(db, &card).await?;
    cards::log_event(db, Some(&card.id), "provisioned", None).await?;
    Ok(card)
}

/// Replaces an employee's card (e.g. after a loss): provisions a new blank
/// card first, then blocks every other card still linked to the employee so
/// a found/stolen old card stops working.
pub(crate) async fn reprovision(
    service: &Arc<CardService>,
    db: &DbState,
    employee_id: &str,
) -> Result<Card, CardError> {
    let new_card = provision(service, db, employee_id).await?;

    for mut old in cards::find_by_employee(db, employee_id).await? {
        if old.id == new_card.id || old.status == "blocked" {
            continue;
        }
        old.status = "blocked".to_string();
        cards::upsert(db, &old).await?;
        cards::log_event(db, Some(&old.id), "replaced", Some(new_card.id.clone())).await?;
    }
    Ok(new_card)
}

pub(crate) async fn unprovision(
    service: &Arc<CardService>,
    db: &DbState,
    card_id: &str,
) -> Result<(), CardError> {
    let card = cards::find_by_id(db, card_id)
        .await?
        .ok_or_else(|| CardError::Internal("cartão não encontrado".into()))?;

    let uid = hex::decode(&card.uid)
        .map_err(|_| CardError::Internal("UID armazenado inválido".into()))?;
    let keys = card_keys(&uid)?;

    service.unprovision(keys).await?;
    cards::delete(db, card_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_active_pending_clone() {
        let active = token_hash(b"active-token-abc");
        let pending = token_hash(b"pending-token-xy");
        let stale = token_hash(b"stale-token-0000");

        assert_eq!(
            classify_token(&active, &active, Some(&pending)),
            TokenMatch::Active
        );
        assert_eq!(
            classify_token(&pending, &active, Some(&pending)),
            TokenMatch::Pending
        );
        assert_eq!(
            classify_token(&stale, &active, Some(&pending)),
            TokenMatch::Clone
        );
        // No pending: anything but active is a clone.
        assert_eq!(classify_token(&stale, &active, None), TokenMatch::Clone);
        assert_eq!(classify_token(&active, &active, None), TokenMatch::Active);
    }
}
