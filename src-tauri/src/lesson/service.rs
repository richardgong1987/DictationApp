//! Lesson workflows: import, browse, rename, pin and delete, and delete
//! single passages.

use std::path::Path;

use crate::audio::cache::AudioCache;
use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::parser::{parse_lesson, title_from_path, title_from_text, Passage};
use crate::lesson::repository::{LessonRepository, NewItem, NewLesson};
use crate::lesson::{
    is_too_long, DictationItem, ItemDetail, Lesson, LessonDetail, LessonHeader, LessonSummary,
};
use crate::practice::repository::PracticeRepository;
use crate::practice::ItemStats;

#[derive(Clone)]
pub struct LessonService {
    lessons: LessonRepository,
    practice: PracticeRepository,
    files: LessonFiles,
    audio_cache: AudioCache,
}

impl LessonService {
    pub fn new(
        lessons: LessonRepository,
        practice: PracticeRepository,
        files: LessonFiles,
        audio_cache: AudioCache,
    ) -> Self {
        Self {
            lessons,
            practice,
            files,
            audio_cache,
        }
    }

    pub fn list(&self) -> AppResult<Vec<LessonSummary>> {
        self.lessons
            .list()?
            .into_iter()
            .map(|lesson| self.summarize(lesson))
            .collect()
    }

    /// Imports a UTF-8 text file, titled after the file name.
    pub fn import_file(&self, source_path: &Path) -> AppResult<LessonDetail> {
        let content = LessonFiles::read_source(source_path)?;
        let title = title_from_path(source_path);
        let source_path = source_path.to_string_lossy().into_owned();
        self.add_and_show(LessonHeader::new(title, Some(source_path)), &content)
    }

    /// Creates a lesson from pasted text. A blank title is replaced by the
    /// text's opening words.
    pub fn import_text(&self, title: &str, content: &str) -> AppResult<LessonDetail> {
        let title = match title.trim() {
            "" => title_from_text(content),
            title => title.to_string(),
        };
        self.add_and_show(LessonHeader::new(title, None), content)
    }

    /// Each passage becomes one dictation item; `source_text` is kept as the
    /// lesson's own copy of its text. Audio is generated separately.
    pub fn add(
        &self,
        header: LessonHeader,
        source_text: &str,
        passages: Vec<Passage>,
    ) -> AppResult<()> {
        if passages.is_empty() {
            return Err(AppError::LessonHasNoItems);
        }

        let lesson_id = header.id;
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
            title: header.title,
            source_path: header.source_path,
            created_at: header.created_at,
            items,
        };

        self.files.create_lesson_folder(&lesson_id, source_text)?;
        if let Err(error) = self.lessons.insert(&lesson) {
            // Best-effort cleanup; the database error is the one worth reporting.
            let _ = self.files.delete_lesson_folder(&lesson_id);
            return Err(error);
        }
        self.write_metadata(&lesson_id)
    }

    /// Every block of text between blank lines becomes one dictation item.
    fn add_and_show(&self, header: LessonHeader, content: &str) -> AppResult<LessonDetail> {
        let lesson_id = header.id.clone();
        self.add(header, content, parse_lesson(content))?;
        self.detail(&lesson_id)
    }

    pub fn detail(&self, lesson_id: &str) -> AppResult<LessonDetail> {
        let lesson = self.lessons.get(lesson_id)?;
        let mut stats = self.practice.stats_by_item(lesson_id)?;
        let items = self
            .lessons
            .items(lesson_id)?
            .into_iter()
            .map(|item| {
                let item_stats = stats.remove(&item.id).unwrap_or_default();
                self.item_detail_of(item, item_stats)
            })
            .collect();
        Ok(LessonDetail { lesson, items })
    }

    pub fn item_detail(&self, item_id: i64) -> AppResult<ItemDetail> {
        let item = self.lessons.get_item(item_id)?;
        let stats = self
            .practice
            .stats_by_item(&item.lesson_id)?
            .remove(&item.id)
            .unwrap_or_default();
        Ok(self.item_detail_of(item, stats))
    }

    /// Only the lesson's own title changes; the imported file keeps its name.
    pub fn rename(&self, lesson_id: &str, title: &str) -> AppResult<Lesson> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::LessonTitleEmpty);
        }
        self.lessons.rename(lesson_id, title)?;
        self.write_metadata(lesson_id)?;
        self.lessons.get(lesson_id)
    }

    /// A pinned lesson stays at the top of the library however many lessons
    /// are added after it.
    pub fn set_pinned(&self, lesson_id: &str, pinned: bool) -> AppResult<Lesson> {
        self.lessons.set_pinned(lesson_id, pinned)?;
        self.write_metadata(lesson_id)?;
        self.lessons.get(lesson_id)
    }

    /// Removes a passage the learner does not want, such as a stray `---`
    /// that cannot be spoken, with its audio and practice history. The other
    /// passages keep their numbers, and with them their audio files. A
    /// lesson keeps at least one passage; deleting the lesson removes the last.
    pub fn delete_item(&self, item_id: i64) -> AppResult<()> {
        let item = self.lessons.get_item(item_id)?;
        if self.lessons.items(&item.lesson_id)?.len() == 1 {
            return Err(AppError::LastItemOfLesson);
        }
        self.lessons.delete_item(item_id)?;
        if let Some(audio_path) = &item.audio_path {
            self.files.delete_audio(audio_path)?;
        }
        self.lessons.touch(&item.lesson_id)?;
        self.write_metadata(&item.lesson_id)
    }

    /// Removes the lesson, its practice history and its folder. A text file the
    /// lesson was imported from is not touched.
    pub fn delete(&self, lesson_id: &str) -> AppResult<()> {
        self.lessons.delete(lesson_id)?;
        Ok(self.files.delete_lesson_folder(lesson_id)?)
    }

    fn summarize(&self, lesson: Lesson) -> AppResult<LessonSummary> {
        let items = self.lessons.items(&lesson.id)?;
        let audio_ready_count = items
            .iter()
            .filter(|item| self.audio_cache.has_file(item))
            .count();
        let long_item_count = items.iter().filter(|item| is_too_long(&item.text)).count();
        Ok(LessonSummary {
            item_count: items.len(),
            audio_ready_count,
            long_item_count,
            lesson,
        })
    }

    fn item_detail_of(&self, item: DictationItem, stats: ItemStats) -> ItemDetail {
        let audio_status = self.audio_cache.status(&item);
        ItemDetail::new(item, audio_status, stats)
    }

    /// Rewrites `metadata.json` from the database.
    pub fn write_metadata(&self, lesson_id: &str) -> AppResult<()> {
        let lesson = self.lessons.get(lesson_id)?;
        let items = self.lessons.items(lesson_id)?;
        self.files.write_metadata(&lesson, &items)
    }
}
