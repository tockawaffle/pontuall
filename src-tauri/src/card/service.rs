//! Owns the PC/SC context and runs all blocking smartcard I/O on blocking
//! threads (never a tokio worker). One operation at a time is enforced by a
//! mutex; cancellation is cooperative via an atomic flag.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use pcsc::{Context, Protocols, Scope, ShareMode, State};
use tokio::sync::Mutex;

use crate::card::apdu::{self, KeyType, BLOCK_SIZE, KEY_SIZE};
use crate::card::errors::CardError;
use crate::card::keys::CardKeys;
use crate::card::layout;

/// Raw state read from a provisioned card in one authenticated session.
pub(crate) struct CardReadState {
    pub uid: Vec<u8>,
    pub magic_ok: bool,
    pub token: [u8; BLOCK_SIZE],
}

pub(crate) struct CardService {
    ctx: std::sync::Mutex<Option<Context>>,
    op_lock: Mutex<()>,
    cancel: AtomicBool,
}

impl CardService {
    pub(crate) fn new() -> Self {
        Self {
            ctx: std::sync::Mutex::new(None),
            op_lock: Mutex::new(()),
            cancel: AtomicBool::new(false),
        }
    }

    pub(crate) fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Runs `f` with the shared PC/SC context on a blocking thread, holding
    /// the single-operation lock for its whole duration.
    async fn with_ctx<T, F>(self: &Arc<Self>, f: F) -> Result<T, CardError>
    where
        T: Send + 'static,
        F: FnOnce(&Context, &AtomicBool) -> Result<T, CardError> + Send + 'static,
    {
        let _guard = self.op_lock.lock().await;
        self.cancel.store(false, Ordering::SeqCst);
        let this = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let ctx = this.ensure_ctx()?;
            f(&ctx, &this.cancel)
        })
        .await
        .map_err(|e| CardError::Internal(format!("card task panicked: {e}")))?
    }

    fn ensure_ctx(&self) -> Result<Context, CardError> {
        let mut slot = self
            .ctx
            .lock()
            .map_err(|_| CardError::Internal("card context poisoned".into()))?;
        if let Some(ctx) = slot.as_ref() {
            // Detect a dead context (service restarted) and rebuild.
            if ctx.is_valid().is_ok() {
                return Ok(ctx.clone());
            }
        }
        let ctx = Context::establish(Scope::User)?;
        *slot = Some(ctx.clone());
        Ok(ctx)
    }

    pub(crate) async fn reader_status(self: &Arc<Self>) -> Result<Option<String>, CardError> {
        self.with_ctx(|ctx, _| Ok(first_acr_reader(ctx))).await
    }

    /// Waits for a card and returns its UID. Polls with a finite timeout so
    /// cancellation and the overall deadline are honoured.
    pub(crate) async fn await_card_uid(
        self: &Arc<Self>,
        timeout_ms: u64,
    ) -> Result<Vec<u8>, CardError> {
        self.with_ctx(move |ctx, cancel| {
            let reader = require_reader(ctx)?;
            wait_for_card(ctx, &reader, cancel, Duration::from_millis(timeout_ms))?;
            read_uid(ctx, &reader)
        })
        .await
    }

    /// Authenticates sector 1 with the derived Key B and reads magic + token.
    pub(crate) async fn read_state(
        self: &Arc<Self>,
        keys: CardKeys,
    ) -> Result<CardReadState, CardError> {
        self.with_ctx(move |ctx, cancel| {
            let reader = require_reader(ctx)?;
            wait_for_card(ctx, &reader, cancel, Duration::from_secs(5))?;
            let uid = read_uid(ctx, &reader)?;

            let mut card = ctx.connect(&reader, ShareMode::Shared, Protocols::ANY)?;
            let tx = card.transaction()?;
            ensure_mifare(&tx)?;

            authenticate(&tx, layout::TOKEN_BLOCK, &keys.key_b)?;
            let magic = read_block(&tx, layout::MAGIC_BLOCK)?;
            let token = read_block(&tx, layout::TOKEN_BLOCK)?;

            Ok(CardReadState {
                uid,
                magic_ok: layout::is_magic_block(&magic),
                token,
            })
        })
        .await
    }

    /// Writes the new token + counter and reads the token block back to
    /// confirm the write landed.
    pub(crate) async fn write_token(
        self: &Arc<Self>,
        keys: CardKeys,
        token: [u8; BLOCK_SIZE],
        counter: u64,
    ) -> Result<(), CardError> {
        self.with_ctx(move |ctx, cancel| {
            let reader = require_reader(ctx)?;
            wait_for_card(ctx, &reader, cancel, Duration::from_secs(5))?;

            let mut card = ctx.connect(&reader, ShareMode::Shared, Protocols::ANY)?;
            let tx = card.transaction()?;
            ensure_mifare(&tx)?;

            authenticate(&tx, layout::TOKEN_BLOCK, &keys.key_b)?;
            write_block(&tx, layout::TOKEN_BLOCK, &token)?;
            write_block(&tx, layout::COUNTER_BLOCK, &layout::counter_block(counter))?;

            let readback = read_block(&tx, layout::TOKEN_BLOCK)?;
            if readback != token {
                return Err(CardError::Transmit(
                    "verificação de escrita do token falhou".into(),
                ));
            }
            Ok(())
        })
        .await
    }

    /// Provisions a blank (or re-provisions a known) card: write trailer with
    /// derived keys, then magic/token/counter. Returns the card UID.
    pub(crate) async fn provision(
        self: &Arc<Self>,
        keys: CardKeys,
        initial_token: [u8; BLOCK_SIZE],
        force: bool,
    ) -> Result<Vec<u8>, CardError> {
        self.with_ctx(move |ctx, cancel| {
            let reader = require_reader(ctx)?;
            wait_for_card(ctx, &reader, cancel, Duration::from_secs(30))?;
            let uid = read_uid(ctx, &reader)?;

            let mut card = ctx.connect(&reader, ShareMode::Shared, Protocols::ANY)?;
            let tx = card.transaction()?;
            ensure_mifare(&tx)?;

            // Blank card authenticates with the factory key; a re-provision
            // authenticates with the current derived Key B.
            let owned = authenticate(&tx, layout::TRAILER_BLOCK, &crate::card::keys::FACTORY_KEY)
                .is_ok()
                || authenticate(&tx, layout::TRAILER_BLOCK, &keys.key_b).is_ok();

            if owned {
                write_block(&tx, layout::TRAILER_BLOCK, &layout::provisioned_trailer(&keys))?;
            } else if force {
                // Card isn't blank and isn't ours: try known default keys to
                // regain control of the sector trailer and reformat it.
                force_format_trailer(&tx, &keys)?;
            } else {
                return Err(CardError::NotBlank(
                    "cartão não está em branco ou é de outro sistema".into(),
                ));
            }

            // Re-authenticate with the new Key B before touching data blocks.
            authenticate(&tx, layout::TOKEN_BLOCK, &keys.key_b)?;
            write_block(&tx, layout::MAGIC_BLOCK, &layout::magic_block())?;
            write_block(&tx, layout::TOKEN_BLOCK, &initial_token)?;
            write_block(&tx, layout::COUNTER_BLOCK, &layout::counter_block(0))?;

            Ok(uid)
        })
        .await
    }

    /// Restores factory keys and wipes the app blocks.
    pub(crate) async fn unprovision(self: &Arc<Self>, keys: CardKeys) -> Result<(), CardError> {
        self.with_ctx(move |ctx, cancel| {
            let reader = require_reader(ctx)?;
            wait_for_card(ctx, &reader, cancel, Duration::from_secs(30))?;

            let mut card = ctx.connect(&reader, ShareMode::Shared, Protocols::ANY)?;
            let tx = card.transaction()?;
            ensure_mifare(&tx)?;

            authenticate(&tx, layout::TOKEN_BLOCK, &keys.key_b)?;
            write_block(&tx, layout::MAGIC_BLOCK, &[0u8; BLOCK_SIZE])?;
            write_block(&tx, layout::TOKEN_BLOCK, &[0u8; BLOCK_SIZE])?;
            write_block(&tx, layout::COUNTER_BLOCK, &[0u8; BLOCK_SIZE])?;

            authenticate(&tx, layout::TRAILER_BLOCK, &keys.key_b)?;
            write_block(&tx, layout::TRAILER_BLOCK, &layout::transport_trailer())?;
            Ok(())
        })
        .await
    }
}

fn first_acr_reader(ctx: &Context) -> Option<String> {
    let mut buf = [0u8; 2048];
    let readers = ctx.list_readers(&mut buf).ok()?;
    for reader in readers {
        if let Ok(name) = reader.to_str() {
            if name.contains("ACR122") {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn require_reader(ctx: &Context) -> Result<std::ffi::CString, CardError> {
    let name = first_acr_reader(ctx).ok_or(CardError::ReaderUnavailable)?;
    std::ffi::CString::new(name).map_err(|_| CardError::ReaderUnavailable)
}

/// Polls `get_status_change` with a 500 ms timeout so cancellation and the
/// deadline are checked regularly; never blocks indefinitely.
fn wait_for_card(
    ctx: &Context,
    reader: &std::ffi::CStr,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<(), CardError> {
    use pcsc::ReaderState;

    let deadline = Instant::now() + timeout;
    let mut states = vec![ReaderState::new(reader, State::UNAWARE)];

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(CardError::Cancelled);
        }
        for s in &mut states {
            s.sync_current_state();
        }
        match ctx.get_status_change(Duration::from_millis(500), &mut states) {
            Ok(()) => {}
            Err(pcsc::Error::Timeout) => {}
            Err(e) => return Err(e.into()),
        }
        if states[0].event_state().contains(State::PRESENT) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(CardError::Timeout);
        }
    }
}

fn read_uid(ctx: &Context, reader: &std::ffi::CStr) -> Result<Vec<u8>, CardError> {
    let mut card = ctx.connect(reader, ShareMode::Shared, Protocols::ANY)?;
    let tx = card.transaction()?;
    let mut buf = [0u8; 64];
    let response = tx.transmit(&apdu::get_uid(), &mut buf)?;
    Ok(apdu::parse_response(response)?.to_vec())
}

fn ensure_mifare(tx: &pcsc::Transaction) -> Result<(), CardError> {
    let status = tx.status2_owned()?;
    if apdu::is_mifare_classic(status.atr()) {
        Ok(())
    } else {
        Err(CardError::UnsupportedCard)
    }
}

fn authenticate_kt(
    tx: &pcsc::Transaction,
    block: u8,
    key: &[u8; KEY_SIZE],
    key_type: KeyType,
) -> Result<(), CardError> {
    let mut buf = [0u8; 64];
    // Reader key slots are volatile; load the key immediately before auth.
    let response = tx.transmit(&apdu::load_key(0, key), &mut buf)?;
    apdu::parse_response(response)?;

    let mut buf = [0u8; 64];
    let response = tx.transmit(&apdu::authenticate(block, key_type, 0), &mut buf)?;
    apdu::parse_response(response)?;
    Ok(())
}

fn authenticate(
    tx: &pcsc::Transaction,
    block: u8,
    key: &[u8; KEY_SIZE],
) -> Result<(), CardError> {
    authenticate_kt(tx, block, key, KeyType::B)
}

/// Best-effort reclaim of a non-blank foreign card: walk a dictionary of
/// well-known default keys (with both Key A and Key B) until one authenticates
/// the sector trailer AND permits overwriting it with our provisioned trailer.
fn force_format_trailer(tx: &pcsc::Transaction, keys: &CardKeys) -> Result<(), CardError> {
    let provisioned = layout::provisioned_trailer(keys);

    let mut candidates: Vec<[u8; KEY_SIZE]> =
        vec![crate::card::keys::FACTORY_KEY, keys.key_a, keys.key_b];
    candidates.extend_from_slice(crate::card::keys::COMMON_KEYS);

    for key in &candidates {
        for key_type in [KeyType::A, KeyType::B] {
            if authenticate_kt(tx, layout::TRAILER_BLOCK, key, key_type).is_err() {
                continue;
            }
            // Auth succeeded; the access bits still decide whether this key slot
            // may rewrite the trailer, so only a successful write counts.
            if write_block(tx, layout::TRAILER_BLOCK, &provisioned).is_ok() {
                return Ok(());
            }
        }
    }

    Err(CardError::Conflict(
        "não foi possível formatar o cartão: as chaves de segurança são desconhecidas".into(),
    ))
}

fn read_block(tx: &pcsc::Transaction, block: u8) -> Result<[u8; BLOCK_SIZE], CardError> {
    let mut buf = [0u8; 64];
    let response = tx.transmit(&apdu::read_block(block), &mut buf)?;
    let payload = apdu::parse_response(response)?;
    if payload.len() < BLOCK_SIZE {
        return Err(CardError::Transmit("bloco lido incompleto".into()));
    }
    let mut out = [0u8; BLOCK_SIZE];
    out.copy_from_slice(&payload[..BLOCK_SIZE]);
    Ok(out)
}

fn write_block(
    tx: &pcsc::Transaction,
    block: u8,
    data: &[u8; BLOCK_SIZE],
) -> Result<(), CardError> {
    let mut buf = [0u8; 64];
    let response = tx.transmit(&apdu::write_block(block, data), &mut buf)?;
    apdu::parse_response(response)?;
    Ok(())
}
