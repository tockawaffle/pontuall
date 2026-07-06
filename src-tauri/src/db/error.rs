use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub(crate) enum DbError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("credential store error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("{0}")]
    Config(String),
    #[error("{0} not found")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl DbError {
    fn code(&self) -> &'static str {
        match self {
            DbError::Sqlx(_) => "db_error",
            DbError::Migrate(_) => "migration_error",
            DbError::Keyring(_) => "keyring_error",
            DbError::Config(_) => "config_error",
            DbError::NotFound(_) => "not_found",
            DbError::Conflict(_) => "conflict",
            DbError::InvalidInput(_) => "invalid_input",
        }
    }
}

// Commands return errors to the webview as `{ code, message }` so the
// frontend can map codes to user-facing messages.
impl Serialize for DbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("DbError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
