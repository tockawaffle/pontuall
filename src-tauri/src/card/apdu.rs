//! Pure APDU builders/parsers for the ACR122U (PC/SC pass-through to
//! MIFARE Classic). No I/O here so everything is unit-testable.

use crate::card::errors::CardError;

pub(crate) const BLOCK_SIZE: usize = 16;
pub(crate) const KEY_SIZE: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyType {
    // Provisioned cards lock data blocks to Key B; Key A is only used when
    // force-formatting a foreign card whose trailer we must reclaim.
    A = 0x60,
    B = 0x61,
}

/// FF CA 00 00 00 — returns the card UID.
pub(crate) fn get_uid() -> [u8; 5] {
    [0xFF, 0xCA, 0x00, 0x00, 0x00]
}

/// FF 82 00 <slot> 06 <key> — loads a key into a volatile reader slot.
/// Reader key slots do not survive power cycles; always load before auth.
pub(crate) fn load_key(slot: u8, key: &[u8; KEY_SIZE]) -> [u8; 11] {
    let mut apdu = [0u8; 11];
    apdu[..5].copy_from_slice(&[0xFF, 0x82, 0x00, slot, 0x06]);
    apdu[5..].copy_from_slice(key);
    apdu
}

/// FF 86 00 00 05 01 00 <block> <keyType> <slot> — MIFARE authentication.
pub(crate) fn authenticate(block: u8, key_type: KeyType, slot: u8) -> [u8; 10] {
    [
        0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, block, key_type as u8, slot,
    ]
}

/// FF B0 00 <block> <len> — read a data block.
pub(crate) fn read_block(block: u8) -> [u8; 5] {
    [0xFF, 0xB0, 0x00, block, BLOCK_SIZE as u8]
}

/// FF D6 00 <block> 10 <data> — write a data block.
pub(crate) fn write_block(block: u8, data: &[u8; BLOCK_SIZE]) -> [u8; 21] {
    let mut apdu = [0u8; 21];
    apdu[..5].copy_from_slice(&[0xFF, 0xD6, 0x00, block, BLOCK_SIZE as u8]);
    apdu[5..].copy_from_slice(data);
    apdu
}

/// Splits a response into payload + status word, requiring SW 9000.
pub(crate) fn parse_response(response: &[u8]) -> Result<&[u8], CardError> {
    if response.len() < 2 {
        return Err(CardError::Transmit("resposta curta demais".into()));
    }
    let (payload, sw) = response.split_at(response.len() - 2);
    let sw = u16::from_be_bytes([sw[0], sw[1]]);
    if sw != 0x9000 {
        return Err(CardError::CardRefused(sw));
    }
    Ok(payload)
}

/// MIFARE Classic 1K ATR prefix accepted by this app.
pub(crate) fn is_mifare_classic(atr: &[u8]) -> bool {
    atr.starts_with(&[0x3B, 0x8F, 0x80, 0x01, 0x80, 0x4F])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_key_layout() {
        let apdu = load_key(0, &[0xFF; 6]);
        assert_eq!(
            apdu,
            [0xFF, 0x82, 0x00, 0x00, 0x06, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]
        );
    }

    #[test]
    fn authenticate_layout() {
        assert_eq!(
            authenticate(7, KeyType::B, 0),
            [0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, 7, 0x61, 0x00]
        );
        assert_eq!(authenticate(4, KeyType::A, 1)[8], 0x60);
    }

    #[test]
    fn read_write_layout() {
        assert_eq!(read_block(5), [0xFF, 0xB0, 0x00, 5, 16]);
        let data = [0xAB; 16];
        let apdu = write_block(6, &data);
        assert_eq!(&apdu[..5], &[0xFF, 0xD6, 0x00, 6, 16]);
        assert_eq!(&apdu[5..], &data);
    }

    #[test]
    fn parse_response_checks_status_word() {
        assert_eq!(parse_response(&[0x01, 0x02, 0x90, 0x00]).unwrap(), &[0x01, 0x02]);
        assert!(matches!(
            parse_response(&[0x63, 0x00]),
            Err(CardError::CardRefused(0x6300))
        ));
        assert!(parse_response(&[0x90]).is_err());
    }
}
