use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub(crate) enum CardError {
    #[error("serviço de cartões indisponível: {0}")]
    ServiceUnavailable(String),
    #[error("leitor não conectado")]
    ReaderUnavailable,
    #[error("erro de comunicação com o cartão: {0}")]
    Transmit(String),
    #[error("o cartão recusou o comando (SW={0:04X})")]
    CardRefused(u16),
    #[error("tipo de cartão não suportado")]
    UnsupportedCard,
    #[error("operação cancelada")]
    Cancelled,
    #[error("tempo esgotado aguardando o cartão")]
    Timeout,
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
    #[error(transparent)]
    Db(#[from] crate::db::error::DbError),
    #[error(transparent)]
    Auth(#[from] crate::auth::error::AuthError),
}

impl From<pcsc::Error> for CardError {
    fn from(e: pcsc::Error) -> Self {
        match e {
            pcsc::Error::NoService | pcsc::Error::ServiceStopped => CardError::ServiceUnavailable(
                "o serviço de Cartão Inteligente (SCardSvr) do Windows não está em execução".into(),
            ),
            pcsc::Error::NoReadersAvailable
            | pcsc::Error::ReaderUnavailable
            | pcsc::Error::UnknownReader => CardError::ReaderUnavailable,
            pcsc::Error::Cancelled => CardError::Cancelled,
            pcsc::Error::Timeout => CardError::Timeout,
            other => CardError::Transmit(other.to_string()),
        }
    }
}

impl CardError {
    fn code(&self) -> &'static str {
        match self {
            CardError::ServiceUnavailable(_) => "service_unavailable",
            CardError::ReaderUnavailable => "reader_unavailable",
            CardError::Transmit(_) => "transmit_error",
            CardError::CardRefused(_) => "card_refused",
            CardError::UnsupportedCard => "unsupported_card",
            CardError::Cancelled => "cancelled",
            CardError::Timeout => "timeout",
            CardError::Conflict(_) => "conflict",
            CardError::Internal(_) => "internal",
            CardError::Db(_) => "db_error",
            CardError::Auth(_) => "auth_error",
        }
    }
}

impl Serialize for CardError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("CardError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
