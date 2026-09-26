//! SQLite persistence for lessons, items, attempts and settings.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::{Attempt, DictationItem, ItemStats, Lesson};
use crate::settings::Settings;

const SCHEMA_V1: &str = "
CREATE TABLE lessons (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    source_path TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE dictation_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id       TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    text            TEXT NOT NULL,
    audio_path      TEXT,
    audio_cache_key TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (lesson_id, position)
);
CREATE TABLE attempts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dictation_item_id INTEGER NOT NULL REFERENCES dictation_items(id) ON DELETE CASCADE,
    answer            TEXT NOT NULL,
    is_correct        INTEGER NOT NULL,
    accuracy          REAL NOT NULL,
    replay_count      INTEGER NOT NULL,
    created_at        TEXT NOT NULL
);
CREATE INDEX attempts_item ON attempts(dictation_item_id);
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

const SETTINGS_KEY: &str = "app";

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub struct Database {
    conn: Mutex<Connection>,
}

pub struct NewItem<'a> {
    pub position: i64,
    pub text: &'a str,
    pub audio_path: &'a str,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(&format!(
                "BEGIN; {SCHEMA_V1} PRAGMA user_version = 1; COMMIT;"
            ))?;
        }
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock cannot leave SQLite inconsistent,
        // so recover from poisoning instead of failing every later call.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn insert_lesson(&self, lesson: &Lesson, items: &[NewItem<'_>]) -> AppResult<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO lessons (id, title, source_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lesson.id, lesson.title, lesson.source_path, lesson.created_at, lesson.updated_at],
        )?;
        for item in items {
            tx.execute(
                "INSERT INTO dictation_items (lesson_id, position, text, audio_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![lesson.id, item.position, item.text, item.audio_path, lesson.created_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_lessons(&self) -> AppResult<Vec<Lesson>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, source_path, created_at, updated_at FROM lessons ORDER BY created_at DESC, title",
        )?;
        let lessons = stmt
            .query_map([], lesson_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(lessons)
    }

    pub fn get_lesson(&self, id: &str) -> AppResult<Lesson> {
        self.conn()
            .query_row(
                "SELECT id, title, source_path, created_at, updated_at FROM lessons WHERE id = ?1",
                [id],
                lesson_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Lesson".into()))
    }

    pub fn touch_lesson(&self, id: &str) -> AppResult<()> {
        self.conn().execute(
            "UPDATE lessons SET updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )?;
        Ok(())
    }

    pub fn delete_lesson(&self, id: &str) -> AppResult<()> {
        let n = self
            .conn()
            .execute("DELETE FROM lessons WHERE id = ?1", [id])?;
        if n == 0 {
            return Err(AppError::NotFound("Lesson".into()));
        }
        Ok(())
    }

    pub fn lesson_items(&self, lesson_id: &str) -> AppResult<Vec<DictationItem>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, lesson_id, position, text, audio_path, audio_cache_key, created_at
             FROM dictation_items WHERE lesson_id = ?1 ORDER BY position",
        )?;
        let items = stmt
            .query_map([lesson_id], item_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(items)
    }

    pub fn get_item(&self, id: i64) -> AppResult<DictationItem> {
        self.conn()
            .query_row(
                "SELECT id, lesson_id, position, text, audio_path, audio_cache_key, created_at
                 FROM dictation_items WHERE id = ?1",
                [id],
                item_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Dictation item".into()))
    }

    pub fn set_item_audio(&self, id: i64, audio_path: &str, cache_key: &str) -> AppResult<()> {
        self.conn().execute(
            "UPDATE dictation_items SET audio_path = ?1, audio_cache_key = ?2 WHERE id = ?3",
            params![audio_path, cache_key, id],
        )?;
        Ok(())
    }

    pub fn insert_attempt(
        &self,
        item_id: i64,
        answer: &str,
        is_correct: bool,
        accuracy: f64,
        replay_count: i64,
    ) -> AppResult<Attempt> {
        let conn = self.conn();
        let created_at = now();
        conn.execute(
            "INSERT INTO attempts (dictation_item_id, answer, is_correct, accuracy, replay_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_id, answer, is_correct, accuracy, replay_count, created_at],
        )?;
        Ok(Attempt {
            id: conn.last_insert_rowid(),
            dictation_item_id: item_id,
            answer: answer.to_string(),
            is_correct,
            accuracy,
            replay_count,
            created_at,
        })
    }

    /// Attempt statistics keyed by item id for one lesson.
    pub fn lesson_item_stats(
        &self,
        lesson_id: &str,
    ) -> AppResult<std::collections::HashMap<i64, ItemStats>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT a.dictation_item_id, COUNT(*), MAX(a.accuracy),
                    (SELECT accuracy FROM attempts l WHERE l.dictation_item_id = a.dictation_item_id
                     ORDER BY l.id DESC LIMIT 1)
             FROM attempts a JOIN dictation_items i ON i.id = a.dictation_item_id
             WHERE i.lesson_id = ?1 GROUP BY a.dictation_item_id",
        )?;
        let rows = stmt.query_map([lesson_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                ItemStats {
                    attempt_count: r.get(1)?,
                    best_accuracy: r.get(2)?,
                    last_accuracy: r.get(3)?,
                },
            ))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn load_settings(&self) -> AppResult<Settings> {
        let raw: Option<String> = self
            .conn()
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [SETTINGS_KEY],
                |r| r.get(0),
            )
            .optional()?;
        Ok(match raw {
            // Unreadable settings fall back to defaults rather than blocking startup.
            Some(json) => serde_json::from_str::<Settings>(&json)
                .unwrap_or_default()
                .sanitized(),
            None => Settings::default(),
        })
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<()> {
        let json = serde_json::to_string(settings)?;
        self.conn().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SETTINGS_KEY, json],
        )?;
        Ok(())
    }
}

fn lesson_from_row(r: &Row<'_>) -> rusqlite::Result<Lesson> {
    Ok(Lesson {
        id: r.get(0)?,
        title: r.get(1)?,
        source_path: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

fn item_from_row(r: &Row<'_>) -> rusqlite::Result<DictationItem> {
    Ok(DictationItem {
        id: r.get(0)?,
        lesson_id: r.get(1)?,
        position: r.get(2)?,
        text: r.get(3)?,
        audio_path: r.get(4)?,
        audio_cache_key: r.get(5)?,
        created_at: r.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lesson(id: &str) -> Lesson {
        Lesson {
            id: id.into(),
            title: "Daily English 01".into(),
            source_path: "/tmp/daily.txt".into(),
            created_at: now(),
            updated_at: now(),
        }
    }

    #[test]
    fn lesson_roundtrip_and_cascade_delete() {
        let db = Database::open_in_memory().unwrap();
        let items = [
            NewItem {
                position: 1,
                text: "One.",
                audio_path: "lessons/a/audio/001.mp3",
            },
            NewItem {
                position: 2,
                text: "Two.",
                audio_path: "lessons/a/audio/002.mp3",
            },
        ];
        db.insert_lesson(&lesson("a"), &items).unwrap();

        assert_eq!(db.list_lessons().unwrap().len(), 1);
        let stored = db.lesson_items("a").unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[1].text, "Two.");
        assert_eq!(stored[0].audio_cache_key, None);

        db.set_item_audio(stored[0].id, "lessons/a/audio/001.mp3", "key")
            .unwrap();
        assert_eq!(
            db.get_item(stored[0].id)
                .unwrap()
                .audio_cache_key
                .as_deref(),
            Some("key")
        );

        db.insert_attempt(stored[0].id, "one", true, 1.0, 2)
            .unwrap();
        db.insert_attempt(stored[0].id, "on", false, 0.5, 0)
            .unwrap();
        let stats = db.lesson_item_stats("a").unwrap();
        let s = &stats[&stored[0].id];
        assert_eq!(s.attempt_count, 2);
        assert_eq!(s.best_accuracy, Some(1.0));
        assert_eq!(s.last_accuracy, Some(0.5));

        db.delete_lesson("a").unwrap();
        assert!(db.list_lessons().unwrap().is_empty());
        assert!(db.get_item(stored[0].id).is_err());
        assert!(db.lesson_item_stats("a").unwrap().is_empty());
    }

    #[test]
    fn settings_roundtrip() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.load_settings().unwrap(), Settings::default());
        let s = Settings {
            voice: "en-GB-RyanNeural".into(),
            playback_speed: 0.75,
            loop_enabled: true,
            ..Settings::default()
        };
        db.save_settings(&s).unwrap();
        assert_eq!(db.load_settings().unwrap(), s);
    }

    #[test]
    fn reopening_keeps_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dictation.db");
        {
            let db = Database::open(&path).unwrap();
            db.insert_lesson(&lesson("b"), &[]).unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.get_lesson("b").unwrap().title, "Daily English 01");
    }
}
