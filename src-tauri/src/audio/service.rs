//! Audio generation workflows for whole lessons and single items.

use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use crate::audio::cache::{AudioCache, AudioOutcome, AudioStatus};
use crate::audio::{AudioGenerationProgress, AudioGenerationSummary};
use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::repository::LessonRepository;
use crate::lesson::DictationItem;
use crate::settings::service::SettingsService;
use crate::settings::Settings;
use crate::tts::azure::AzureTts;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

pub struct AudioService {
    lessons: LessonRepository,
    settings: SettingsService,
    files: LessonFiles,
    cache: AudioCache,
    http: reqwest::Client,
    running: RunningGenerations,
}

impl AudioService {
    pub fn new(
        lessons: LessonRepository,
        settings: SettingsService,
        files: LessonFiles,
        cache: AudioCache,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            lessons,
            settings,
            files,
            cache,
            http,
            running: RunningGenerations::default(),
        }
    }

    /// Generates audio for every item that lacks up-to-date audio (every item
    /// when `force`), one at a time to stay within Azure free-tier limits.
    /// Reports progress after each item and keeps going when one item fails.
    pub async fn generate_lesson(
        &self,
        lesson_id: &str,
        force: bool,
        on_progress: impl Fn(AudioGenerationProgress),
    ) -> AppResult<AudioGenerationSummary> {
        let _running = self.running.start(lesson_id)?;
        let settings = self.settings.load()?;
        let items = self.lessons.items(lesson_id)?;
        let provider = self.tts_provider(&settings)?;
        let needs_synthesis = force
            || items
                .iter()
                .any(|item| self.cache.status(item, &settings) != AudioStatus::Ready);
        if needs_synthesis && provider.is_none() {
            return Err(AppError::MissingSpeechCredentials);
        }

        let mut summary = AudioGenerationSummary::default();
        for (index, item) in items.iter().enumerate() {
            let result = self
                .ensure_item_audio(provider.as_ref(), &settings, item, force)
                .await;
            let error = summary.record(item.position, result);
            let updated = self.lessons.get_item(item.id)?;
            on_progress(AudioGenerationProgress {
                lesson_id: lesson_id.to_string(),
                item_id: item.id,
                done: index + 1,
                total: items.len(),
                audio_status: self.cache.status(&updated, &settings),
                error,
            });
        }

        self.lessons.touch(lesson_id)?;
        self.write_metadata(lesson_id)?;
        Ok(summary)
    }

    /// Generates one item's audio if it is missing or outdated (always when `force`).
    pub async fn generate_item(&self, item_id: i64, force: bool) -> AppResult<()> {
        let settings = self.settings.load()?;
        let item = self.lessons.get_item(item_id)?;
        let provider = self.tts_provider(&settings)?;
        self.ensure_item_audio(provider.as_ref(), &settings, &item, force)
            .await?;
        self.write_metadata(&item.lesson_id)
    }

    /// Raw MP3 bytes; playback itself happens in the WebView.
    pub fn read_item_audio(&self, item_id: i64) -> AppResult<Vec<u8>> {
        self.cache.read(&self.lessons.get_item(item_id)?)
    }

    /// Makes sure the item has current audio and records where it is.
    async fn ensure_item_audio(
        &self,
        provider: Option<&AzureTts>,
        settings: &Settings,
        item: &DictationItem,
        force: bool,
    ) -> AppResult<AudioOutcome> {
        let audio = self.cache.ensure(provider, item, settings, force).await?;
        let is_recorded = item.audio_path.as_deref() == Some(audio.path.as_str())
            && item.audio_cache_key.as_deref() == Some(audio.cache_key.as_str());
        if !is_recorded {
            self.lessons
                .set_item_audio(item.id, &audio.path, &audio.cache_key)?;
        }
        Ok(audio.outcome)
    }

    /// `None` when no credentials are configured; cached audio still works then.
    fn tts_provider(&self, settings: &Settings) -> AppResult<Option<AzureTts>> {
        match self.settings.credentials(settings) {
            Some(credentials) => Ok(Some(AzureTts::new(self.http.clone(), credentials)?)),
            None => Ok(None),
        }
    }

    fn write_metadata(&self, lesson_id: &str) -> AppResult<()> {
        let lesson = self.lessons.get(lesson_id)?;
        let items = self.lessons.items(lesson_id)?;
        self.files.write_metadata(&lesson, &items)
    }
}

/// Lessons whose audio is being generated. A second run for the same lesson
/// is refused instead of racing the first one on the same files.
#[derive(Default)]
struct RunningGenerations(Mutex<HashSet<String>>);

impl RunningGenerations {
    /// Marks the lesson as running until the returned guard is dropped.
    fn start(&self, lesson_id: &str) -> AppResult<RunningGeneration<'_>> {
        if !self.lock().insert(lesson_id.to_string()) {
            return Err(AppError::GenerationAlreadyRunning);
        }
        Ok(RunningGeneration {
            registry: self,
            lesson_id: lesson_id.to_string(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashSet<String>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

struct RunningGeneration<'a> {
    registry: &'a RunningGenerations,
    lesson_id: String,
}

impl Drop for RunningGeneration<'_> {
    fn drop(&mut self) {
        self.registry.lock().remove(&self.lesson_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lesson_cannot_generate_twice_at_once() {
        let running = RunningGenerations::default();
        let first = running.start("a").unwrap();
        assert!(matches!(
            running.start("a"),
            Err(AppError::GenerationAlreadyRunning)
        ));
        assert!(running.start("b").is_ok());

        drop(first);
        assert!(running.start("a").is_ok());
    }
}
