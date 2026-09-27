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

    /// Enables foreign keys and applies the schema to a new database.
    fn initialize(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 1 {
            connection.execute_batch(&format!(
                "BEGIN; {SCHEMA_V1} PRAGMA user_version = 1; COMMIT;"
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
