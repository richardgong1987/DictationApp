//! Moving lessons between devices: every lesson and its audio go into one
//! file that another device imports, so no audio is paid for twice.

pub mod archive;
pub mod service;

use serde::Serialize;

use crate::settings::VoiceSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub lesson_count: usize,
    pub audio_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Lessons this device did not have.
    pub added_lessons: usize,
    /// Lessons already here. They keep their text, audio, answers and statistics.
    pub existing_lessons: usize,
    /// Audio files copied in, for new lessons and for existing ones lacking them.
    pub added_audio: usize,
    /// Of `added_audio`, files made with voice settings other than this
    /// device's. They show as "Voice changed", and practicing them here would
    /// generate them again.
    pub audio_with_other_voice: usize,
    /// The exporting device's voice settings, which this device can switch to.
    pub exported_voice: VoiceSettings,
}
