//! SQLite access for lessons and their dictation items.

use rusqlite::{params, OptionalExtension, Row};

use crate::database::{timestamp_now, Database};
use crate::error::{AppError, AppResult};
use crate::lesson::{DictationItem, Lesson};

/// A lesson about to be stored, with its items in order.
pub struct NewLesson {
    pub id: String,
    pub title: String,
    /// `None` for pasted text.
    pub source_path: Option<String>,
    /// Kept from the original when the lesson is copied from another device.
    pub created_at: String,
    pub items: Vec<NewItem>,
}

pub struct NewItem {
    pub position: i64,
    pub text: String,
    pub audio_path: String,
}

#[derive(Clone)]
pub struct LessonRepository {
    database: Database,
}

impl LessonRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    /// Stores the lesson and all of its items, or nothing.
    pub fn insert(&self, lesson: &NewLesson) -> AppResult<()> {
        let now = timestamp_now();
        let mut connection = self.database.connection();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO lessons (id, title, source_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lesson.id, lesson.title, lesson.source_path, lesson.created_at, now],
        )?;
        for item in &lesson.items {
            transaction.execute(
                "INSERT INTO dictation_items (lesson_id, position, text, audio_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![lesson.id, item.position, item.text, item.audio_path, now],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Newest first.
    pub fn list(&self) -> AppResult<Vec<Lesson>> {
        let connection = self.database.connection();
        let mut statement = connection.prepare(
            "SELECT id, title, source_path, created_at, updated_at FROM lessons ORDER BY created_at DESC, title",
        )?;
        let lessons = statement
            .query_map([], lesson_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(lessons)
    }

    pub fn get(&self, id: &str) -> AppResult<Lesson> {
        self.database
            .connection()
            .query_row(
                "SELECT id, title, source_path, created_at, updated_at FROM lessons WHERE id = ?1",
                [id],
                lesson_from_row,
            )
            .optional()?
            .ok_or(AppError::LessonNotFound)
    }

    pub fn exists(&self, id: &str) -> AppResult<bool> {
        let found = self
            .database
            .connection()
            .query_row("SELECT 1 FROM lessons WHERE id = ?1", [id], |_| Ok(()))
            .optional()?;
        Ok(found.is_some())
    }

    pub fn rename(&self, id: &str, title: &str) -> AppResult<()> {
        let renamed = self.database.connection().execute(
            "UPDATE lessons SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, timestamp_now(), id],
        )?;
        if renamed == 0 {
            return Err(AppError::LessonNotFound);
        }
        Ok(())
    }

    pub fn touch(&self, id: &str) -> AppResult<()> {
        self.database.connection().execute(
            "UPDATE lessons SET updated_at = ?1 WHERE id = ?2",
            params![timestamp_now(), id],
        )?;
        Ok(())
    }

    /// Items and their attempts go with the lesson (`ON DELETE CASCADE`).
    pub fn delete(&self, id: &str) -> AppResult<()> {
        let deleted = self
            .database
            .connection()
            .execute("DELETE FROM lessons WHERE id = ?1", [id])?;
        if deleted == 0 {
            return Err(AppError::LessonNotFound);
        }
        Ok(())
    }

    /// In lesson order.
    pub fn items(&self, lesson_id: &str) -> AppResult<Vec<DictationItem>> {
        let connection = self.database.connection();
        let mut statement = connection.prepare(
            "SELECT id, lesson_id, position, text, audio_path, audio_cache_key
             FROM dictation_items WHERE lesson_id = ?1 ORDER BY position",
        )?;
        let items = statement
            .query_map([lesson_id], item_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(items)
    }

    pub fn get_item(&self, id: i64) -> AppResult<DictationItem> {
        self.database
            .connection()
            .query_row(
                "SELECT id, lesson_id, position, text, audio_path, audio_cache_key
                 FROM dictation_items WHERE id = ?1",
                [id],
                item_from_row,
            )
            .optional()?
            .ok_or(AppError::ItemNotFound)
    }

    pub fn set_item_audio(&self, id: i64, audio_path: &str, cache_key: &str) -> AppResult<()> {
        self.database.connection().execute(
            "UPDATE dictation_items SET audio_path = ?1, audio_cache_key = ?2 WHERE id = ?3",
            params![audio_path, cache_key, id],
        )?;
        Ok(())
    }
}

fn lesson_from_row(row: &Row<'_>) -> rusqlite::Result<Lesson> {
    Ok(Lesson {
        id: row.get(0)?,
        title: row.get(1)?,
        source_path: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<DictationItem> {
    Ok(DictationItem {
        id: row.get(0)?,
        lesson_id: row.get(1)?,
        position: row.get(2)?,
        text: row.get(3)?,
        audio_path: row.get(4)?,
        audio_cache_key: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_lesson(id: &str, texts: &[&str]) -> NewLesson {
        NewLesson {
            id: id.into(),
            title: "Daily English 01".into(),
            source_path: Some("/tmp/daily.txt".into()),
            created_at: timestamp_now(),
            items: texts
                .iter()
                .zip(1..)
                .map(|(text, position)| NewItem {
                    position,
                    text: text.to_string(),
                    audio_path: format!("lessons/{id}/audio/{position:03}.mp3"),
                })
                .collect(),
        }
    }

    #[test]
    fn lesson_roundtrip_and_delete() {
        let repository = LessonRepository::new(Database::open_in_memory().unwrap());
        repository
            .insert(&new_lesson("a", &["One.", "Two."]))
            .unwrap();

        assert_eq!(repository.list().unwrap().len(), 1);
        assert!(repository.exists("a").unwrap());
        assert!(!repository.exists("b").unwrap());
        let items = repository.items("a").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].text, "Two.");
        assert_eq!(items[0].audio_cache_key, None);

        repository
            .set_item_audio(items[0].id, "lessons/a/audio/001.mp3", "key")
            .unwrap();
        let updated = repository.get_item(items[0].id).unwrap();
        assert_eq!(updated.audio_cache_key.as_deref(), Some("key"));

        repository.delete("a").unwrap();
        assert!(repository.list().unwrap().is_empty());
        assert!(matches!(
            repository.get_item(items[0].id),
            Err(AppError::ItemNotFound)
        ));
        assert!(matches!(
            repository.delete("a"),
            Err(AppError::LessonNotFound)
        ));
    }

    #[test]
    fn reopening_keeps_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dictation.db");
        {
            let repository = LessonRepository::new(Database::open(&path).unwrap());
            repository.insert(&new_lesson("b", &[])).unwrap();
        }
        let repository = LessonRepository::new(Database::open(&path).unwrap());
        assert_eq!(repository.get("b").unwrap().title, "Daily English 01");
    }
}
