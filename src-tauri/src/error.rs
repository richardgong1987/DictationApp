use serde::{Serialize, Serializer};

use crate::cache::CacheError;
use crate::tts::TtsError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tts(#[from] TtsError),
    #[error(transparent)]
    Cache(#[from] CacheError),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0} not found")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
}

/// Errors cross the Tauri IPC boundary as plain messages.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
