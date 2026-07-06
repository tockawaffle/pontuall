use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub(crate) enum AuthError {
    #[error("credenciais inválidas")]
    InvalidCredentials,
    #[error("sessão inválida ou expirada")]
    InvalidSession,
    #[error("permissão negada")]
    Forbidden,
    #[error("serviço de autenticação indisponível: {0}")]
    SidecarUnavailable(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
    #[error(transparent)]
    Db(#[from] crate::db::error::DbError),
}

impl From<reqwest::Error> for AuthError {
    fn from(e: reqwest::Error) -> Self {
        AuthError::SidecarUnavailable(e.to_string())
    }
}

impl AuthError {
    fn code(&self) -> &'static str {
        match self {
            AuthError::InvalidCredentials => "invalid_credentials",
            AuthError::InvalidSession => "invalid_session",
            AuthError::Forbidden => "forbidden",
            AuthError::SidecarUnavailable(_) => "auth_unavailable",
            AuthError::Conflict(_) => "conflict",
            AuthError::Internal(_) => "internal",
            AuthError::Db(_) => "db_error",
        }
    }
}

impl Serialize for AuthError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AuthError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
