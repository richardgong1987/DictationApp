//! Text-to-speech. Audio generation depends only on [`TtsProvider`]; the
//! provider picked in Settings ([`TtsProviderKind`]) is reached through
//! [`TtsClient`]. Each provider has its own module, and `http` holds the
//! retry handling they share.

pub mod azure;
pub mod elevenlabs;
mod http;

use std::fmt;
use std::future::Future;
use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};

use crate::tts::azure::AzureTts;
use crate::tts::elevenlabs::ElevenLabsTts;

/// The service that generates new audio.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TtsProviderKind {
    #[default]
    Azure,
    ElevenLabs,
}

impl TtsProviderKind {
    /// Speaking rate adjustments in percent that the provider accepts.
    /// ElevenLabs only speaks at 0.7x to 1.2x.
    pub fn speaking_rate_range(self) -> RangeInclusive<i32> {
        match self {
            Self::Azure => -50..=100,
            Self::ElevenLabs => -30..=20,
        }
    }
}

impl fmt::Display for TtsProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Azure => "Azure",
            Self::ElevenLabs => "ElevenLabs",
        })
    }
}

/// Everything that determines the synthesized audio. Every field is part of
/// the audio cache key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TtsRequest {
    pub provider: TtsProviderKind,
    pub text: String,
    /// Azure voice name or ElevenLabs voice ID.
    pub voice: String,
    /// ElevenLabs model ID; empty for Azure, which has no model choice.
    pub model: String,
    /// Speaking rate adjustment in percent.
    pub rate: i32,
    /// Pitch adjustment in percent; always 0 for ElevenLabs, which cannot change it.
    pub pitch: i32,
    pub output_format: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TtsError {
    #[error("Invalid Azure region \"{0}\" (expected something like \"eastus\")")]
    InvalidRegion(String),
    #[error("Invalid ElevenLabs voice ID \"{0}\" (expected letters and digits, like \"JBFqnCBsd6RMkjVDRZzb\")")]
    InvalidVoiceId(String),
    #[error("Network error while calling {provider} TTS: {message}")]
    Network {
        provider: TtsProviderKind,
        message: String,
    },
    #[error("{provider} TTS request failed ({status}): {message}")]
    Api {
        provider: TtsProviderKind,
        status: u16,
        message: String,
    },
    #[error("{0} TTS returned empty audio")]
    EmptyAudio(TtsProviderKind),
}

/// Turns one text item into encoded audio bytes.
pub trait TtsProvider {
    fn synthesize(
        &self,
        request: &TtsRequest,
    ) -> impl Future<Output = Result<Vec<u8>, TtsError>> + Send;
}

/// A client for the provider selected in Settings.
pub enum TtsClient {
    Azure(AzureTts),
    ElevenLabs(ElevenLabsTts),
}

impl TtsProvider for TtsClient {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        match self {
            Self::Azure(azure) => azure.synthesize(request).await,
            Self::ElevenLabs(elevenlabs) => elevenlabs.synthesize(request).await,
        }
    }
}
