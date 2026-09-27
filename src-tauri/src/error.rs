//! The error every command returns. Errors cross the IPC boundary as plain
//! messages, so each variant's text is what the user sees.

use serde::{Serialize, Serializer};

use crate::tts::TtsError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("The lesson file is not valid UTF-8 text.")]
    LessonNotUtf8,
    #[error("No dictation items found. Separate passages with blank lines.")]
    LessonHasNoItems,
    #[error("Lesson not found")]
    LessonNotFound,
    #[error("Dictation item not found")]
    ItemNotFound,
    #[error("Audio for this item not found")]
    AudioNotFound,
    #[error("Audio for this lesson is already being generated.")]
    GenerationAlreadyRunning,
    #[error("Azure Speech credentials are not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or enter them in Settings.")]
    MissingSpeechCredentials,
    #[error("{0}")]
    Tts(#[from] TtsError),
    #[error("Could not save audio: {0}")]
    AudioNotSaved(std::io::Error),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
