//! Lessons: imported text files, split into dictation items.

pub mod files;
pub mod parser;
pub mod repository;
pub mod service;

use serde::Serialize;

use crate::audio::cache::AudioStatus;
use crate::practice::ItemStats;

/// Passages longer than this trigger a warning (but are still accepted).
pub const MAX_RECOMMENDED_WORDS: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub title: String,
    /// Where the file was imported from; the lesson keeps its own copy.
    pub source_path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One passage of a lesson: the unit that is spoken, typed and checked.
#[derive(Debug, Clone)]
pub struct DictationItem {
    pub id: i64,
    pub lesson_id: String,
    /// 1-based position inside the lesson.
    pub position: i64,
    pub text: String,
    /// Relative to the application data directory.
    pub audio_path: Option<String>,
    /// Cache key of the voice settings that produced the file at `audio_path`.
    pub audio_cache_key: Option<String>,
}

pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

pub fn is_too_long(text: &str) -> bool {
    word_count(text) > MAX_RECOMMENDED_WORDS
}

/// A lesson row in the library.
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
    pub items: Vec<ItemDetail>,
}

/// An item as the lesson and practice screens show it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub id: i64,
    pub position: i64,
    pub text: String,
    pub word_count: usize,
    pub too_long: bool,
    pub audio_status: AudioStatus,
    #[serde(flatten)]
    pub stats: ItemStats,
}

impl ItemDetail {
    pub fn new(item: DictationItem, audio_status: AudioStatus, stats: ItemStats) -> Self {
        Self {
            id: item.id,
            position: item.position,
            word_count: word_count(&item.text),
            too_long: is_too_long(&item.text),
            text: item.text,
            audio_status,
            stats,
        }
    }
}
