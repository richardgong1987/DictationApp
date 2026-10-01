//! Settings are stored as one JSON document in the `settings` table.

use rusqlite::{params, OptionalExtension};

use crate::database::Database;
use crate::error::AppResult;
use crate::settings::Settings;

const SETTINGS_KEY: &str = "app";

#[derive(Clone)]
pub struct SettingsRepository {
    database: Database,
}

impl SettingsRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn load(&self) -> AppResult<Settings> {
        let stored: Option<String> = self
            .database
            .connection()
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()?;
        // Unreadable settings fall back to defaults rather than blocking startup.
        let settings = stored
            .and_then(|json| serde_json::from_str::<Settings>(&json).ok())
            .unwrap_or_default();
        Ok(settings.sanitized())
    }

    pub fn save(&self, settings: &Settings) -> AppResult<()> {
        let json = serde_json::to_string(settings)?;
        self.database.connection().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SETTINGS_KEY, json],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip() {
        let repository = SettingsRepository::new(Database::open_in_memory().unwrap());
        assert_eq!(repository.load().unwrap(), Settings::default());

        let settings = Settings {
            azure_voice: "en-GB-RyanNeural".into(),
            playback_speed: 0.75,
            loop_enabled: true,
            ..Settings::default()
        };
        repository.save(&settings).unwrap();
        assert_eq!(repository.load().unwrap(), settings);
    }
}
