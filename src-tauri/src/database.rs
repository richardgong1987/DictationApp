//! SQLite connection and schema. Each feature's repository runs its own
//! queries through [`Database::connection`].

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::AppResult;

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

/// The learner's latest answer per item, kept until they clear it, so
/// practice can continue where it stopped. `attempts` stays the history of
/// checks; this is the working copy, including answers not checked yet.
const SCHEMA_V2: &str = "
CREATE TABLE answers (
    dictation_item_id INTEGER PRIMARY KEY REFERENCES dictation_items(id) ON DELETE CASCADE,
    text              TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('draft', 'checked')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
";

/// Pasted lessons have no source file, so `source_path` becomes nullable: NULL
/// means the text was pasted. SQLite cannot drop NOT NULL in place, so the
/// table is rebuilt.
const SCHEMA_V3: &str = "
CREATE TABLE lessons_v3 (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    source_path TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
INSERT INTO lessons_v3 (id, title, source_path, created_at, updated_at)
    SELECT id, title, source_path, created_at, updated_at FROM lessons;
DROP TABLE lessons;
ALTER TABLE lessons_v3 RENAME TO lessons;
";

/// Applied in order; `PRAGMA user_version` counts how many already ran.
const MIGRATIONS: [&str; 3] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

/// Shared handle to the application database; cloning it is cheap.
#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::initialize(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::initialize(Connection::open_in_memory()?)
    }

    /// Brings the schema up to date, then enables foreign keys. They stay off
    /// while migrating: dropping the old copy of a rebuilt table would
    /// otherwise cascade-delete every row that refers to it.
    fn initialize(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let applied: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        for (index, migration) in MIGRATIONS.iter().enumerate().skip(applied.max(0) as usize) {
            let version = index + 1;
            connection.execute_batch(&format!(
                "BEGIN; {migration} PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn connection(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock cannot leave SQLite inconsistent,
        // so recover from poisoning instead of failing every later call.
        self.connection.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The timestamp format stored in every table: RFC 3339, UTC, whole seconds.
pub fn timestamp_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_version(database: &Database) -> i64 {
        database
            .connection()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn a_version_1_database_is_upgraded_without_losing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dictation.db");
        {
            // A database as the first release left it.
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(&format!(
                    "{SCHEMA_V1} PRAGMA user_version = 1;
                     INSERT INTO lessons VALUES ('a', 'Old lesson', '/tmp/a.txt', 't', 't');"
                ))
                .unwrap();
        }

        let database = Database::open(&path).unwrap();

        assert_eq!(user_version(&database), MIGRATIONS.len() as i64);
        let connection = database.connection();
        let title: String = connection
            .query_row("SELECT title FROM lessons WHERE id = 'a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "Old lesson");
        let answers: i64 = connection
            .query_row("SELECT COUNT(*) FROM answers", [], |row| row.get(0))
            .unwrap();
        assert_eq!(answers, 0);
    }

    #[test]
    fn rebuilding_lessons_keeps_items_attempts_and_answers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dictation.db");
        {
            // A version 2 database with practice history, foreign keys on as the app runs it.
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(&format!(
                    "PRAGMA foreign_keys = ON; {SCHEMA_V1} {SCHEMA_V2} PRAGMA user_version = 2;
                     INSERT INTO lessons VALUES ('a', 'Old lesson', '/tmp/a.txt', 't', 't');
                     INSERT INTO dictation_items (id, lesson_id, position, text, created_at)
                         VALUES (7, 'a', 1, 'One.', 't');
                     INSERT INTO attempts (dictation_item_id, answer, is_correct, accuracy, replay_count, created_at)
                         VALUES (7, 'one', 1, 1.0, 0, 't');
                     INSERT INTO answers VALUES (7, 'one', 'checked', 't', 't');"
                ))
                .unwrap();
        }

        let database = Database::open(&path).unwrap();

        let connection = database.connection();
        let count = |table: &str| -> i64 {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
        };
        assert_eq!(
            [
                count("lessons"),
                count("dictation_items"),
                count("attempts"),
                count("answers")
            ],
            [1, 1, 1, 1]
        );
        let source_path: Option<String> = connection
            .query_row(
                "SELECT source_path FROM lessons WHERE id = 'a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_path.as_deref(), Some("/tmp/a.txt"));

        // Pasted lessons store no path, and items still belong to their lesson.
        connection
            .execute(
                "INSERT INTO lessons VALUES ('b', 'Pasted', NULL, 't', 't')",
                [],
            )
            .unwrap();
        connection
            .execute("DELETE FROM lessons WHERE id = 'a'", [])
            .unwrap();
        assert_eq!([count("dictation_items"), count("answers")], [0, 0]);
    }

    #[test]
    fn reopening_an_up_to_date_database_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dictation.db");
        drop(Database::open(&path).unwrap());
        assert_eq!(
            user_version(&Database::open(&path).unwrap()),
            MIGRATIONS.len() as i64
        );
    }
}
