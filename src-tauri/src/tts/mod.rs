//! Text-to-speech. Audio generation depends only on [`TtsProvider`], so another
//! provider can replace Azure (in [`azure`]) without touching the audio code.

pub mod azure;

use std::future::Future;

/// Everything that determines the synthesized audio. Every field is part of
/// the audio cache key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TtsRequest {
    pub text: String,
    pub voice: String,
    /// Speaking rate adjustment in percent.
    pub rate: i32,
    /// Pitch adjustment in percent.
    pub pitch: i32,
    pub output_format: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TtsError {
    #[error("Invalid Azure region \"{0}\" (expected something like \"eastus\")")]
    InvalidRegion(String),
    #[error("Network error while calling Azure TTS: {0}")]
    Network(String),
    #[error("Azure TTS request failed ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("Azure TTS returned empty audio")]
    EmptyAudio,
}

/// Turns one text item into encoded audio bytes.
pub trait TtsProvider {
    fn synthesize(
        &self,
        request: &TtsRequest,
    ) -> impl Future<Output = Result<Vec<u8>, TtsError>> + Send;
}
