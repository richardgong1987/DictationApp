//! Item audio: MP3s cached on disk and generated through a TTS provider.

pub mod cache;
pub mod service;

use serde::Serialize;

use crate::audio::cache::{AudioOutcome, AudioStatus};
use crate::error::AppResult;

/// Emitted after each item while a lesson's audio is generated; the payload
/// is [`AudioGenerationProgress`].
pub const GENERATION_PROGRESS_EVENT: &str = "audio-generation-progress";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioGenerationSummary {
    pub generated: usize,
    pub cached: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

impl AudioGenerationSummary {
    /// Counts one item's result and returns its error message, if it failed.
    fn record(&mut self, position: i64, result: AppResult<AudioOutcome>) -> Option<String> {
        match result {
            Ok(AudioOutcome::Generated) => {
                self.generated += 1;
                None
            }
            Ok(AudioOutcome::Cached) => {
                self.cached += 1;
                None
            }
            Err(error) => {
                let message = format!("Item {position}: {error}");
                self.failed += 1;
                self.errors.push(message.clone());
                Some(message)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioGenerationProgress {
    pub lesson_id: String,
    pub item_id: i64,
    pub done: usize,
    pub total: usize,
    pub audio_status: AudioStatus,
    pub error: Option<String>,
}
