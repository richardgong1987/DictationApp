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

/// Applied in order; `PRAGMA user_version` counts how many already ran.
const MIGRATIONS: [&str; 2] = [SCHEMA_V1, SCHEMA_V2];

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

    /// Enables foreign keys and brings the schema up to date.
    fn initialize(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let applied: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        for (index, migration) in MIGRATIONS.iter().enumerate().skip(applied.max(0) as usize) {
            let version = index + 1;
            connection.execute_batch(&format!(
                "BEGIN; {migration} PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
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
