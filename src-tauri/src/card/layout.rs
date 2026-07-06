//! MIFARE Classic sector layout used by PontuAll and the access-bits
//! builder. A wrong trailer permanently bricks a sector, so the encoding is
//! implemented from the NXP MF1S50 datasheet truth table and unit-tested
//! against its known values.

use crate::card::apdu::{BLOCK_SIZE, KEY_SIZE};
use crate::card::keys::CardKeys;

/// Sector 1 is the app sector; sector 0 (manufacturer data) is untouched.
pub(crate) const MAGIC_BLOCK: u8 = 4;
pub(crate) const TOKEN_BLOCK: u8 = 5;
pub(crate) const COUNTER_BLOCK: u8 = 6;
pub(crate) const TRAILER_BLOCK: u8 = 7;

/// Block 4 contents: magic + format version, rest zero.
pub(crate) const MAGIC: &[u8; 4] = b"PNTA";
pub(crate) const FORMAT_VERSION: u8 = 0x01;

pub(crate) fn magic_block() -> [u8; BLOCK_SIZE] {
    let mut block = [0u8; BLOCK_SIZE];
    block[..4].copy_from_slice(MAGIC);
    block[4] = FORMAT_VERSION;
    block
}

pub(crate) fn is_magic_block(data: &[u8]) -> bool {
    data.len() >= 5 && &data[..4] == MAGIC && data[4] == FORMAT_VERSION
}

pub(crate) fn counter_block(counter: u64) -> [u8; BLOCK_SIZE] {
    let mut block = [0u8; BLOCK_SIZE];
    block[..8].copy_from_slice(&counter.to_be_bytes());
    block
}

/// Per-block access condition (C1, C2, C3) from the MF1S50 datasheet.
#[derive(Clone, Copy)]
pub(crate) struct AccessCondition(pub bool, pub bool, pub bool);

/// Data blocks: read and write only with Key B (C1C2C3 = 0,1,1).
pub(crate) const DATA_KEY_B_ONLY: AccessCondition = AccessCondition(false, true, true);
/// Trailer: keys writable with Key B, access bits readable A|B and
/// writable B (C1C2C3 = 0,1,1).
pub(crate) const TRAILER_KEY_B_MANAGES: AccessCondition = AccessCondition(false, true, true);
/// Transport configuration used by blank cards (data 0,0,0 / trailer 0,0,1).
pub(crate) const DATA_TRANSPORT: AccessCondition = AccessCondition(false, false, false);
pub(crate) const TRAILER_TRANSPORT: AccessCondition = AccessCondition(false, false, true);

/// Encodes the three access bytes for blocks 0..3 of a sector.
///
/// byte6 = ~C2 | ~C1, byte7 = C1 | ~C3, byte8 = C3 | C2 (high | low nibble),
/// where each nibble carries one bit per block (bit i = block i).
pub(crate) fn access_bytes(conditions: [AccessCondition; 4]) -> [u8; 3] {
    let mut c1 = 0u8;
    let mut c2 = 0u8;
    let mut c3 = 0u8;
    for (i, AccessCondition(b1, b2, b3)) in conditions.iter().enumerate() {
        if *b1 {
            c1 |= 1 << i;
        }
        if *b2 {
            c2 |= 1 << i;
        }
        if *b3 {
            c3 |= 1 << i;
        }
    }
    let inv = |n: u8| !n & 0x0F;
    [
        (inv(c2) << 4) | inv(c1),
        (c1 << 4) | inv(c3),
        (c3 << 4) | c2,
    ]
}

const GENERAL_PURPOSE_BYTE: u8 = 0x69;

fn trailer(keys_a: &[u8; KEY_SIZE], access: [u8; 3], keys_b: &[u8; KEY_SIZE]) -> [u8; BLOCK_SIZE] {
    let mut block = [0u8; BLOCK_SIZE];
    block[..6].copy_from_slice(keys_a);
    block[6..9].copy_from_slice(&access);
    block[9] = GENERAL_PURPOSE_BYTE;
    block[10..].copy_from_slice(keys_b);
    block
}

/// The provisioned trailer: derived keys, data blocks locked to Key B.
pub(crate) fn provisioned_trailer(keys: &CardKeys) -> [u8; BLOCK_SIZE] {
    let access = access_bytes([
        DATA_KEY_B_ONLY,
        DATA_KEY_B_ONLY,
        DATA_KEY_B_ONLY,
        TRAILER_KEY_B_MANAGES,
    ]);
    trailer(&keys.key_a, access, &keys.key_b)
}

/// The factory transport trailer, restored on unprovision.
pub(crate) fn transport_trailer() -> [u8; BLOCK_SIZE] {
    let access = access_bytes([
        DATA_TRANSPORT,
        DATA_TRANSPORT,
        DATA_TRANSPORT,
        TRAILER_TRANSPORT,
    ]);
    trailer(
        &crate::card::keys::FACTORY_KEY,
        access,
        &crate::card::keys::FACTORY_KEY,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The transport configuration must encode to the datasheet's canonical
    /// FF 07 80 access bytes.
    #[test]
    fn transport_access_bytes_match_datasheet() {
        let bytes = access_bytes([
            DATA_TRANSPORT,
            DATA_TRANSPORT,
            DATA_TRANSPORT,
            TRAILER_TRANSPORT,
        ]);
        assert_eq!(bytes, [0xFF, 0x07, 0x80]);
    }

    #[test]
    fn provisioned_access_bytes() {
        // All four blocks at C1C2C3 = 0,1,1:
        // b6 = (~C2)<<4|~C1 = 0x0F, b7 = C1<<4|~C3 = 0x00, b8 = C3<<4|C2 = 0xFF
        let bytes = access_bytes([
            DATA_KEY_B_ONLY,
            DATA_KEY_B_ONLY,
            DATA_KEY_B_ONLY,
            TRAILER_KEY_B_MANAGES,
        ]);
        assert_eq!(bytes, [0x0F, 0x00, 0xFF]);
    }

    #[test]
    fn trailer_layout() {
        let keys = CardKeys {
            key_a: [0xA1; 6],
            key_b: [0xB2; 6],
        };
        let block = provisioned_trailer(&keys);
        assert_eq!(&block[..6], &[0xA1; 6]);
        assert_eq!(&block[6..9], &[0x0F, 0x00, 0xFF]);
        assert_eq!(block[9], 0x69);
        assert_eq!(&block[10..], &[0xB2; 6]);

        let transport = transport_trailer();
        assert_eq!(&transport[..6], &[0xFF; 6]);
        assert_eq!(&transport[6..9], &[0xFF, 0x07, 0x80]);
        assert_eq!(&transport[10..], &[0xFF; 6]);
    }

    #[test]
    fn magic_and_counter_blocks() {
        let magic = magic_block();
        assert!(is_magic_block(&magic));
        assert!(!is_magic_block(&[0u8; 16]));

        let counter = counter_block(0x0102030405060708);
        assert_eq!(&counter[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(&counter[8..], &[0u8; 8]);
    }
}
