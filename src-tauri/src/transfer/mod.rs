//! Moving lessons between devices: every lesson and its audio go into one
//! file that another device imports, so no audio is paid for twice.

pub mod archive;
pub mod service;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub lesson_count: usize,
    pub audio_count: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Lessons this device did not have.
    pub added_lessons: usize,
    /// Lessons already here. They keep their text, audio, answers and statistics.
    pub existing_lessons: usize,
    /// Audio files copied in, for new lessons and for existing ones lacking
    /// them. They play as they are, whatever voice made them.
    pub added_audio: usize,
}
