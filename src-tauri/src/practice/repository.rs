//! SQLite access for practice attempts.

use std::collections::HashMap;

use rusqlite::params;

use crate::database::{timestamp_now, Database};
use crate::error::AppResult;
use crate::practice::ItemStats;

pub struct NewAttempt {
    pub item_id: i64,
    pub answer: String,
    pub is_correct: bool,
    pub accuracy: f64,
    pub replay_count: i64,
}

#[derive(Clone)]
pub struct AttemptRepository {
    database: Database,
}

impl AttemptRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn insert(&self, attempt: &NewAttempt) -> AppResult<()> {
        self.database.connection().execute(
            "INSERT INTO attempts (dictation_item_id, answer, is_correct, accuracy, replay_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                attempt.item_id,
                attempt.answer,
                attempt.is_correct,
                attempt.accuracy,
                attempt.replay_count,
                timestamp_now()
            ],
        )?;
        Ok(())
    }

    /// Statistics for the lesson's items, keyed by item id. Items without
    /// attempts are absent.
    pub fn stats_by_item(&self, lesson_id: &str) -> AppResult<HashMap<i64, ItemStats>> {
        let connection = self.database.connection();
        let mut statement = connection.prepare(
            "SELECT a.dictation_item_id, COUNT(*), MAX(a.accuracy),
                    (SELECT accuracy FROM attempts l WHERE l.dictation_item_id = a.dictation_item_id
                     ORDER BY l.id DESC LIMIT 1)
             FROM attempts a JOIN dictation_items i ON i.id = a.dictation_item_id
             WHERE i.lesson_id = ?1 GROUP BY a.dictation_item_id",
        )?;
        let rows = statement.query_map([lesson_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                ItemStats {
                    attempt_count: row.get(1)?,
                    best_accuracy: row.get(2)?,
                    last_accuracy: row.get(3)?,
                },
            ))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lesson::repository::{LessonRepository, NewItem, NewLesson};

    fn attempt(item_id: i64, accuracy: f64) -> NewAttempt {
        NewAttempt {
            item_id,
            answer: "answer".into(),
            is_correct: accuracy == 1.0,
            accuracy,
            replay_count: 0,
        }
    }

    #[test]
    fn stats_track_count_best_and_last_and_go_with_the_lesson() {
        let database = Database::open_in_memory().unwrap();
        let lessons = LessonRepository::new(database.clone());
        let attempts = AttemptRepository::new(database);
        lessons
            .insert(&NewLesson {
                id: "a".into(),
                title: "Lesson".into(),
                source_path: "/tmp/a.txt".into(),
                items: vec![NewItem {
                    position: 1,
                    text: "One.".into(),
                    audio_path: "lessons/a/audio/001.mp3".into(),
                }],
            })
            .unwrap();
        let item_id = lessons.items("a").unwrap()[0].id;

        attempts.insert(&attempt(item_id, 1.0)).unwrap();
        attempts.insert(&attempt(item_id, 0.5)).unwrap();

        let stats = &attempts.stats_by_item("a").unwrap()[&item_id];
        assert_eq!(stats.attempt_count, 2);
        assert_eq!(stats.best_accuracy, Some(1.0));
        assert_eq!(stats.last_accuracy, Some(0.5));

        lessons.delete("a").unwrap();
        assert!(attempts.stats_by_item("a").unwrap().is_empty());
    }
}
