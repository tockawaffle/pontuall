use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub(crate) enum ExcelError {
    #[error("data ou hora inválida: {0}")]
    InvalidDate(String),
    #[error("nenhum local de destino selecionado")]
    NoDestination,
    #[error("falha ao gerar a planilha: {0}")]
    Write(String),
    #[error(transparent)]
    Auth(#[from] crate::auth::error::AuthError),
}

impl ExcelError {
    fn code(&self) -> &'static str {
        match self {
            ExcelError::InvalidDate(_) => "invalid_date",
            ExcelError::NoDestination => "no_destination",
            ExcelError::Write(_) => "write_error",
            ExcelError::Auth(_) => "auth_error",
        }
    }
}

impl From<rust_xlsxwriter::XlsxError> for ExcelError {
    fn from(e: rust_xlsxwriter::XlsxError) -> Self {
        ExcelError::Write(e.to_string())
    }
}

impl Serialize for ExcelError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("ExcelError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
