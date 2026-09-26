use serde::Serialize;

use crate::cache::AudioStatus;
use crate::compare::Comparison;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub title: String,
    pub source_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationItem {
    pub id: i64,
    pub lesson_id: String,
    pub position: i64,
    pub text: String,
    /// Relative to the application data directory.
    pub audio_path: Option<String>,
    pub audio_cache_key: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: i64,
    pub dictation_item_id: i64,
    pub answer: String,
    pub is_correct: bool,
    pub accuracy: f64,
    pub replay_count: i64,
    pub created_at: String,
}

/// Per-item practice statistics.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub attempt_count: i64,
    pub best_accuracy: Option<f64>,
    pub last_accuracy: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    pub id: i64,
    pub position: i64,
    pub text: String,
    pub word_count: usize,
    pub too_long: bool,
    pub audio_status: AudioStatus,
    #[serde(flatten)]
    pub stats: ItemStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonSummary {
    #[serde(flatten)]
    pub lesson: Lesson,
    pub item_count: usize,
    pub audio_ready_count: usize,
    pub long_item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonDetail {
    pub lesson: Lesson,
    pub items: Vec<ItemView>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationSummary {
    pub generated: usize,
    pub cached: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

/// Emitted as `audio-progress` while a lesson's audio is generated.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProgress {
    pub lesson_id: String,
    pub item_id: i64,
    pub done: usize,
    pub total: usize,
    pub audio_status: AudioStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub source_text: String,
    pub answer: String,
    #[serde(flatten)]
    pub comparison: Comparison,
}
