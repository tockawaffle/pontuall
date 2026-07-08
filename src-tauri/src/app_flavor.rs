//! Build-time install flavor. Production uses the default build; enable
//! `test-flavor` for a parallel install that does not share credentials,
//! local data, or the auth sidecar port with an existing PontuAll kiosk.

pub const APP_DISPLAY_NAME: &str = if cfg!(feature = "test-flavor") {
    "PontuAll Test"
} else {
    "PontuAll"
};

pub const DATA_DIR_NAME: &str = APP_DISPLAY_NAME;

pub const KEYRING_SERVICE: &str = APP_DISPLAY_NAME;

pub const SIDECAR_BIN: &str = if cfg!(feature = "test-flavor") {
    "pontuall-auth-test"
} else {
    "pontuall-auth"
};

pub const DEFAULT_SIDECAR_PORT: u16 = if cfg!(feature = "test-flavor") {
    3436
} else {
    3435
};
