//! Export every lesson with its audio; import lessons exported on another device.

use std::path::Path;

use crate::audio::cache::{AudioCache, AudioStatus};
use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::repository::LessonRepository;
use crate::lesson::service::LessonService;
use crate::lesson::{DictationItem, Lesson, LessonHeader};
use crate::settings::service::SettingsService;
use crate::settings::Settings;
use crate::transfer::archive::{
    ArchiveReader, ArchiveWriter, ExportedItem, ExportedLesson, Manifest,
};
use crate::transfer::{ExportSummary, ImportSummary};

pub struct TransferService {
    lesson_service: LessonService,
    lessons: LessonRepository,
    settings: SettingsService,
    files: LessonFiles,
    audio_cache: AudioCache,
}

impl TransferService {
    pub fn new(
        lesson_service: LessonService,
        lessons: LessonRepository,
        settings: SettingsService,
        files: LessonFiles,
        audio_cache: AudioCache,
    ) -> Self {
        Self {
            lesson_service,
            lessons,
            settings,
            files,
            audio_cache,
        }
    }

    /// Writes every lesson, with all the audio it has, to one file at `path`.
    pub fn export(&self, path: &Path) -> AppResult<ExportSummary> {
        let mut archive = ArchiveWriter::create(path)?;
        let manifest = match self.write_lessons(&mut archive) {
            Ok(manifest) => manifest,
            Err(error) => {
                archive.discard();
                return Err(error);
            }
        };
        archive.finish(&manifest)?;
        Ok(ExportSummary {
            lesson_count: manifest.lessons.len(),
            audio_count: manifest
                .lessons
                .iter()
                .flat_map(|lesson| &lesson.items)
                .filter(|item| item.audio_cache_key.is_some())
                .count(),
        })
    }

    /// Adds the lessons this device does not have yet, and the audio its
    /// lessons lack. Nothing already here is replaced. Lessons are recognized
    /// by id, so importing a file again only adds what is still missing, which
    /// also completes an import that failed halfway.
    pub fn import(&self, path: &Path) -> AppResult<ImportSummary> {
        let (mut archive, manifest) = ArchiveReader::open(path)?;
        let settings = self.settings.load()?;
        let mut summary = ImportSummary {
            added_lessons: 0,
            existing_lessons: 0,
            added_audio: 0,
            audio_with_other_voice: 0,
            exported_voice: manifest.voice,
        };
        for lesson in &manifest.lessons {
            if self.lessons.exists(&lesson.id)? {
                summary.existing_lessons += 1;
            } else {
                self.add_lesson(lesson)?;
                summary.added_lessons += 1;
            }
            self.copy_missing_audio(&mut archive, lesson, &settings, &mut summary)?;
        }
        Ok(summary)
    }

    fn write_lessons(&self, archive: &mut ArchiveWriter) -> AppResult<Manifest> {
        let mut manifest = Manifest::new(self.settings.load()?.voice());
        for lesson in self.lessons.list()? {
            let items = self
                .lessons
                .items(&lesson.id)?
                .into_iter()
                .map(|item| self.export_item(archive, item))
                .collect::<AppResult<_>>()?;
            manifest.lessons.push(self.export_lesson(lesson, items)?);
        }
        Ok(manifest)
    }

    fn export_lesson(&self, lesson: Lesson, items: Vec<ExportedItem>) -> AppResult<ExportedLesson> {
        Ok(ExportedLesson {
            source_text: self.files.read_lesson_text(&lesson.id)?,
            id: lesson.id,
            title: lesson.title,
            created_at: lesson.created_at,
            items,
        })
    }

    /// Audio goes along whatever voice made it; the importing device decides
    /// whether it matches its own settings.
    fn export_item(
        &self,
        archive: &mut ArchiveWriter,
        item: DictationItem,
    ) -> AppResult<ExportedItem> {
        let audio_cache_key = match item.audio_cache_key.clone() {
            Some(key) if self.audio_cache.has_file(&item) => {
                let audio = self.audio_cache.read(&item)?;
                archive.add_audio(&item.lesson_id, item.position, &audio)?;
                Some(key)
            }
            _ => None,
        };
        Ok(ExportedItem {
            position: item.position,
            text: item.text,
            audio_cache_key,
        })
    }

    /// Keeps the lesson's id, so importing it again finds it, and its creation
    /// time, so both devices list lessons in the same order.
    fn add_lesson(&self, lesson: &ExportedLesson) -> AppResult<()> {
        let header = LessonHeader {
            id: lesson.id.clone(),
            title: lesson.title.clone(),
            source_path: None,
            created_at: lesson.created_at.clone(),
        };
        self.lesson_service.add(header, &lesson.source_text)
    }

    fn copy_missing_audio(
        &self,
        archive: &mut ArchiveReader,
        lesson: &ExportedLesson,
        settings: &Settings,
        summary: &mut ImportSummary,
    ) -> AppResult<()> {
        let mut copied = 0;
        for item in self.lessons.items(&lesson.id)? {
            if self.audio_cache.has_file(&item) {
                continue;
            }
            let Some(cache_key) = exported_audio_key(lesson, &item) else {
                continue;
            };
            let audio = archive.read_audio(&lesson.id, item.position)?;
            let path = LessonFiles::audio_path(&item.lesson_id, item.position);
            self.files
                .write_audio(&path, &audio)
                .map_err(AppError::AudioNotSaved)?;
            self.lessons.set_item_audio(item.id, &path, cache_key)?;

            let stored = DictationItem {
                audio_path: Some(path),
                audio_cache_key: Some(cache_key.to_string()),
                ..item
            };
            copied += 1;
            summary.added_audio += 1;
            if self.audio_cache.status(&stored, settings) != AudioStatus::Ready {
                summary.audio_with_other_voice += 1;
            }
        }
        if copied > 0 {
            self.lesson_service.write_metadata(&lesson.id)?;
        }
        Ok(())
    }
}

/// The cache key of the archive's audio for `item`. Audio only goes to an
/// item with the same position and text, so a lesson that this device split
/// into passages differently never gets another passage's audio.
fn exported_audio_key<'a>(lesson: &'a ExportedLesson, item: &DictationItem) -> Option<&'a str> {
    lesson
        .items
        .iter()
        .find(|exported| exported.position == item.position && exported.text == item.text)
        .and_then(|exported| exported.audio_cache_key.as_deref())
}
