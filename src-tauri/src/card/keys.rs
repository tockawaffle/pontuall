//! Per-card MIFARE key derivation. Keys are derived from a master secret in
//! the OS credential store and the card UID, so no key database is needed
//! and no two cards share keys.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::card::apdu::KEY_SIZE;
use crate::card::errors::CardError;
use crate::db::{keyring_get, keyring_set};

pub(crate) const KEYRING_CARD_MASTER: &str = "card_master_key";

pub(crate) const FACTORY_KEY: [u8; KEY_SIZE] = [0xFF; KEY_SIZE];

/// Well-known default MIFARE Classic keys, tried when force-formatting a card
/// whose trailer no longer authenticates with the factory or our derived keys
/// (e.g. a card left over from another system). This is a best-effort recovery:
/// a card with genuinely unknown custom keys still can't be reclaimed.
pub(crate) const COMMON_KEYS: &[[u8; KEY_SIZE]] = &[
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5],
    [0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7],
    [0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0],
    [0xA1, 0xB1, 0xC1, 0xD1, 0xE1, 0xF1],
    [0x4D, 0x3A, 0x99, 0xC3, 0x51, 0xDD],
    [0x1A, 0x98, 0x2C, 0x7E, 0x45, 0x9A],
    [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF],
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
    [0xB5, 0x78, 0xF3, 0x8A, 0x5C, 0x61],
    [0x71, 0x4C, 0x5C, 0x88, 0x6E, 0x97],
    [0x58, 0x7E, 0xE5, 0xF9, 0x35, 0x0F],
    [0xA0, 0x47, 0x8C, 0xC3, 0x90, 0x91],
    [0x53, 0x3C, 0xB6, 0xC7, 0x23, 0xF6],
    [0x8F, 0xD0, 0xA4, 0xF2, 0x56, 0xE9],
];

#[derive(Clone, Copy)]
pub(crate) struct CardKeys {
    pub key_a: [u8; KEY_SIZE],
    pub key_b: [u8; KEY_SIZE],
}

fn derive(master: &[u8], uid: &[u8], label: &[u8]) -> [u8; KEY_SIZE] {
    let mut mac = Hmac::<Sha256>::new_from_slice(master)
        .expect("HMAC accepts any key length");
    mac.update(uid);
    mac.update(label);
    let digest = mac.finalize().into_bytes();
    let mut key = [0u8; KEY_SIZE];
    key.copy_from_slice(&digest[..KEY_SIZE]);
    key
}

pub(crate) fn derive_keys(master: &[u8], uid: &[u8]) -> CardKeys {
    CardKeys {
        key_a: derive(master, uid, b"A"),
        key_b: derive(master, uid, b"B"),
    }
}

/// The master key from the credential store, created on first use.
/// Losing this entry makes provisioned cards unwritable — see the
/// export/import commands for the recovery path.
pub(crate) fn master_key() -> Result<Vec<u8>, CardError> {
    if let Ok(hex_key) = keyring_get(KEYRING_CARD_MASTER) {
        return hex::decode(hex_key.trim())
            .map_err(|_| CardError::Internal("chave-mestra armazenada é inválida".into()));
    }
    let mut bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    keyring_set(KEYRING_CARD_MASTER, &hex::encode(bytes)).map_err(CardError::Db)?;
    Ok(bytes.to_vec())
}

pub(crate) fn export_master_key() -> Result<String, CardError> {
    Ok(hex::encode(master_key()?))
}

pub(crate) fn import_master_key(hex_key: &str) -> Result<(), CardError> {
    let bytes = hex::decode(hex_key.trim())
        .map_err(|_| CardError::Internal("chave-mestra deve ser hexadecimal".into()))?;
    if bytes.len() != 32 {
        return Err(CardError::Internal(
            "chave-mestra deve ter 32 bytes (64 caracteres hexadecimais)".into(),
        ));
    }
    keyring_set(KEYRING_CARD_MASTER, &hex::encode(bytes)).map_err(CardError::Db)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic_and_distinct() {
        let master = [7u8; 32];
        let uid = [0xDE, 0xAD, 0xBE, 0xEF];

        let first = derive_keys(&master, &uid);
        let second = derive_keys(&master, &uid);
        assert_eq!(first.key_a, second.key_a);
        assert_eq!(first.key_b, second.key_b);
        assert_ne!(first.key_a, first.key_b);

        // Different UID ⇒ different keys.
        let other = derive_keys(&master, &[0xCA, 0xFE, 0xBA, 0xBE]);
        assert_ne!(first.key_a, other.key_a);
        assert_ne!(first.key_b, other.key_b);

        // Different master ⇒ different keys.
        let rotated = derive_keys(&[8u8; 32], &uid);
        assert_ne!(first.key_b, rotated.key_b);
    }
}
