//! Each lesson's folder inside the application data directory:
//!
//! ```text
//! lessons/<lesson-id>/
//! ├── source.txt      the imported text, unchanged
//! ├── metadata.json   readable summary; SQLite stays the source of truth
//! └── audio/
//!     ├── 001.mp3     one file per dictation item
//!     └── ...
//! ```

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::lesson::{DictationItem, Lesson};

#[derive(Clone)]
pub struct LessonFiles {
    data_dir: PathBuf,
}

impl LessonFiles {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    /// Reads a lesson file chosen by the user for import.
    pub fn read_source(path: &Path) -> AppResult<String> {
        String::from_utf8(std::fs::read(path)?).map_err(|_| AppError::LessonNotUtf8)
    }

    /// Where an item's MP3 lives, relative to the data directory. Always
    /// `/`-separated so it can be stored in the database as is.
    pub fn audio_path(lesson_id: &str, position: i64) -> String {
        format!("lessons/{lesson_id}/audio/{position:03}.mp3")
    }

    pub fn create_lesson_folder(&self, lesson_id: &str, source_text: &str) -> io::Result<()> {
        let dir = self.lesson_dir(lesson_id);
        std::fs::create_dir_all(dir.join("audio"))?;
        std::fs::write(dir.join("source.txt"), source_text)
    }

    /// The lesson's own copy of its text.
    pub fn read_lesson_text(&self, lesson_id: &str) -> io::Result<String> {
        std::fs::read_to_string(self.lesson_dir(lesson_id).join("source.txt"))
    }

    /// A folder that is already gone counts as deleted.
    pub fn delete_lesson_folder(&self, lesson_id: &str) -> io::Result<()> {
        match std::fs::remove_dir_all(self.lesson_dir(lesson_id)) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }

    pub fn write_metadata(&self, lesson: &Lesson, items: &[DictationItem]) -> AppResult<()> {
        let metadata = Metadata {
            lesson,
            items: items.iter().map(MetadataItem::from).collect(),
        };
        let dir = self.lesson_dir(&lesson.id);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(
            dir.join("metadata.json"),
            serde_json::to_vec_pretty(&metadata)?,
        )?;
        Ok(())
    }

    pub fn audio_exists(&self, audio_path: &str) -> bool {
        self.data_dir.join(audio_path).is_file()
    }

    pub fn read_audio(&self, audio_path: &str) -> io::Result<Vec<u8>> {
        std::fs::read(self.data_dir.join(audio_path))
    }

    /// Writes through a temporary file so a failed or interrupted write never
    /// leaves a truncated MP3 behind.
    pub fn write_audio(&self, audio_path: &str, audio: &[u8]) -> io::Result<()> {
        let target = self.data_dir.join(audio_path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let partial = target.with_extension("mp3.part");
        std::fs::write(&partial, audio)?;
        std::fs::rename(&partial, &target)
    }

    fn lesson_dir(&self, lesson_id: &str) -> PathBuf {
        self.data_dir.join("lessons").join(lesson_id)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metadata<'a> {
    #[serde(flatten)]
    lesson: &'a Lesson,
    items: Vec<MetadataItem<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataItem<'a> {
    position: i64,
    text: &'a str,
    audio_file: Option<&'a str>,
    audio_cache_key: Option<&'a str>,
}

impl<'a> From<&'a DictationItem> for MetadataItem<'a> {
    fn from(item: &'a DictationItem) -> Self {
        Self {
            position: item.position,
            text: &item.text,
            audio_file: item
                .audio_path
                .as_deref()
                .and_then(|path| path.rsplit('/').next()),
            audio_cache_key: item.audio_cache_key.as_deref(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_files_are_numbered_by_position() {
        assert_eq!(LessonFiles::audio_path("x", 1), "lessons/x/audio/001.mp3");
        assert_eq!(LessonFiles::audio_path("x", 42), "lessons/x/audio/042.mp3");
    }

    #[test]
    fn audio_write_leaves_no_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let files = LessonFiles::new(dir.path().to_path_buf());
        let path = LessonFiles::audio_path("x", 1);

        files.write_audio(&path, b"mp3").unwrap();

        assert!(files.audio_exists(&path));
        assert_eq!(files.read_audio(&path).unwrap(), b"mp3");
        assert!(!dir.path().join("lessons/x/audio/001.mp3.part").exists());
    }

    #[test]
    fn deleting_a_missing_folder_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let files = LessonFiles::new(dir.path().to_path_buf());
        files.delete_lesson_folder("never-created").unwrap();
    }
}
