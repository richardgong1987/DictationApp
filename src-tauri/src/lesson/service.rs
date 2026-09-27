//! Lesson workflows: import, browse and delete.

use std::path::Path;

use uuid::Uuid;

use crate::audio::cache::{AudioCache, AudioStatus};
use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::parser::{parse_lesson, title_from_path};
use crate::lesson::repository::{LessonRepository, NewItem, NewLesson};
use crate::lesson::{is_too_long, DictationItem, ItemDetail, Lesson, LessonDetail, LessonSummary};
use crate::practice::repository::PracticeRepository;
use crate::practice::ItemStats;
use crate::settings::service::SettingsService;
use crate::settings::Settings;

pub struct LessonService {
    lessons: LessonRepository,
    practice: PracticeRepository,
    settings: SettingsService,
    files: LessonFiles,
    audio_cache: AudioCache,
}

impl LessonService {
    pub fn new(
        lessons: LessonRepository,
        practice: PracticeRepository,
        settings: SettingsService,
        files: LessonFiles,
        audio_cache: AudioCache,
    ) -> Self {
        Self {
            lessons,
            practice,
            settings,
            files,
            audio_cache,
        }
    }

    pub fn list(&self) -> AppResult<Vec<LessonSummary>> {
        let settings = self.settings.load()?;
        self.lessons
            .list()?
            .into_iter()
            .map(|lesson| self.summarize(lesson, &settings))
            .collect()
    }

    /// Imports a UTF-8 text file: every passage between blank lines becomes one
    /// dictation item. Audio is generated separately.
    pub fn import(&self, source_path: &Path) -> AppResult<LessonDetail> {
        let content = LessonFiles::read_source(source_path)?;
        let passages = parse_lesson(&content);
        if passages.is_empty() {
            return Err(AppError::LessonHasNoItems);
        }

        let lesson_id = Uuid::new_v4().to_string();
        let items = passages
            .into_iter()
            .map(|passage| NewItem {
                audio_path: LessonFiles::audio_path(&lesson_id, passage.position),
                position: passage.position,
                text: passage.text,
            })
            .collect();
        let lesson = NewLesson {
            id: lesson_id.clone(),
            title: title_from_path(source_path),
            source_path: source_path.to_string_lossy().into_owned(),
            items,
        };

        self.files.create_lesson_folder(&lesson_id, &content)?;
        if let Err(error) = self.lessons.insert(&lesson) {
            // Best-effort cleanup; the database error is the one worth reporting.
            let _ = self.files.delete_lesson_folder(&lesson_id);
            return Err(error);
        }
        self.write_metadata(&lesson_id)?;
        self.detail(&lesson_id)
    }

    pub fn detail(&self, lesson_id: &str) -> AppResult<LessonDetail> {
        let lesson = self.lessons.get(lesson_id)?;
        let settings = self.settings.load()?;
        let mut stats = self.practice.stats_by_item(lesson_id)?;
        let items = self
            .lessons
            .items(lesson_id)?
            .into_iter()
            .map(|item| {
                let item_stats = stats.remove(&item.id).unwrap_or_default();
                self.item_detail_of(item, &settings, item_stats)
            })
            .collect();
        Ok(LessonDetail { lesson, items })
    }

    pub fn item_detail(&self, item_id: i64) -> AppResult<ItemDetail> {
        let item = self.lessons.get_item(item_id)?;
        let settings = self.settings.load()?;
        let stats = self
            .practice
            .stats_by_item(&item.lesson_id)?
            .remove(&item.id)
            .unwrap_or_default();
        Ok(self.item_detail_of(item, &settings, stats))
    }

    /// Removes the lesson, its practice history and its folder. The original
    /// text file the user imported is not touched.
    pub fn delete(&self, lesson_id: &str) -> AppResult<()> {
        self.lessons.delete(lesson_id)?;
        Ok(self.files.delete_lesson_folder(lesson_id)?)
    }

    fn summarize(&self, lesson: Lesson, settings: &Settings) -> AppResult<LessonSummary> {
        let items = self.lessons.items(&lesson.id)?;
        let audio_ready_count = items
            .iter()
            .filter(|item| self.audio_cache.status(item, settings) == AudioStatus::Ready)
            .count();
        let long_item_count = items.iter().filter(|item| is_too_long(&item.text)).count();
        Ok(LessonSummary {
            item_count: items.len(),
            audio_ready_count,
            long_item_count,
            lesson,
        })
    }

    fn item_detail_of(
        &self,
        item: DictationItem,
        settings: &Settings,
        stats: ItemStats,
    ) -> ItemDetail {
        let audio_status = self.audio_cache.status(&item, settings);
        ItemDetail::new(item, audio_status, stats)
    }

    fn write_metadata(&self, lesson_id: &str) -> AppResult<()> {
        let lesson = self.lessons.get(lesson_id)?;
        let items = self.lessons.items(lesson_id)?;
        self.files.write_metadata(&lesson, &items)
    }
}
