//! SQLite access for practice: `attempts`, the history of checks, and
//! `answers`, the latest answer to each item.

use std::collections::HashMap;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{params, Row};

use crate::database::{timestamp_now, Database};
use crate::error::AppResult;
use crate::practice::{Answer, AnswerStatus, ItemStats};

/// One check of an answer, as it goes into the statistics.
pub struct NewAttempt {
    pub item_id: i64,
    /// Whitespace collapsed, as compared.
    pub answer: String,
    pub is_correct: bool,
    pub accuracy: f64,
    pub replay_count: i64,
}

#[derive(Clone)]
pub struct PracticeRepository {
    database: Database,
}

impl PracticeRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    /// Records a check: the attempt, and the answer as typed, now checked.
    /// Both are stored or neither.
    pub fn record_check(&self, attempt: &NewAttempt, typed_answer: &str) -> AppResult<()> {
        let now = timestamp_now();
        let mut connection = self.database.connection();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO attempts (dictation_item_id, answer, is_correct, accuracy, replay_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                attempt.item_id,
                attempt.answer,
                attempt.is_correct,
                attempt.accuracy,
                attempt.replay_count,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO answers (dictation_item_id, text, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(dictation_item_id) DO UPDATE
             SET text = excluded.text, status = excluded.status, updated_at = excluded.updated_at",
            params![attempt.item_id, typed_answer, AnswerStatus::Checked, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Saves an answer that has not been checked. Saving the text that is
    /// already stored changes nothing, so a checked answer stays checked.
    pub fn save_draft(&self, item_id: i64, text: &str) -> AppResult<()> {
        self.database.connection().execute(
            "INSERT INTO answers (dictation_item_id, text, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(dictation_item_id) DO UPDATE
             SET text = excluded.text, status = excluded.status, updated_at = excluded.updated_at
             WHERE answers.text <> excluded.text",
            params![item_id, text, AnswerStatus::Draft, timestamp_now()],
        )?;
        Ok(())
    }

    pub fn delete_answer(&self, item_id: i64) -> AppResult<()> {
        self.database.connection().execute(
            "DELETE FROM answers WHERE dictation_item_id = ?1",
            [item_id],
        )?;
        Ok(())
    }

    /// Deletes every answer in the lesson. Attempts, and so the statistics, stay.
    pub fn delete_lesson_answers(&self, lesson_id: &str) -> AppResult<()> {
        self.database.connection().execute(
            "DELETE FROM answers
             WHERE dictation_item_id IN (SELECT id FROM dictation_items WHERE lesson_id = ?1)",
            [lesson_id],
        )?;
        Ok(())
    }

    /// The lesson's answers, least recently updated first. Answers updated in
    /// the same second are in lesson order.
    pub fn answers(&self, lesson_id: &str) -> AppResult<Vec<Answer>> {
        let connection = self.database.connection();
        let mut statement = connection.prepare(
            "SELECT a.dictation_item_id, a.text, a.status
             FROM answers a JOIN dictation_items i ON i.id = a.dictation_item_id
             WHERE i.lesson_id = ?1 ORDER BY a.updated_at, i.position",
        )?;
        let answers = statement
            .query_map([lesson_id], answer_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(answers)
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

fn answer_from_row(row: &Row<'_>) -> rusqlite::Result<Answer> {
    Ok(Answer {
        item_id: row.get(0)?,
        text: row.get(1)?,
        status: row.get(2)?,
    })
}

impl ToSql for AnswerStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(match self {
            AnswerStatus::Draft => "draft",
            AnswerStatus::Checked => "checked",
        }))
    }
}

impl FromSql for AnswerStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "draft" => Ok(AnswerStatus::Draft),
            "checked" => Ok(AnswerStatus::Checked),
            other => Err(FromSqlError::Other(
                format!("unknown answer status {other:?}").into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lesson::repository::{LessonRepository, NewItem, NewLesson};

    /// A lesson "a" with `item_count` items; returns their ids in order.
    fn setup(item_count: i64) -> (LessonRepository, PracticeRepository, Vec<i64>) {
        let database = Database::open_in_memory().unwrap();
        let lessons = LessonRepository::new(database.clone());
        lessons
            .insert(&NewLesson {
                id: "a".into(),
                title: "Lesson".into(),
                source_path: Some("/tmp/a.txt".into()),
                created_at: timestamp_now(),
                items: (1..=item_count)
                    .map(|position| NewItem {
                        position,
                        text: format!("Item {position}."),
                        audio_path: format!("lessons/a/audio/{position:03}.mp3"),
                    })
                    .collect(),
            })
            .unwrap();
        let ids = lessons.items("a").unwrap().iter().map(|i| i.id).collect();
        (lessons, PracticeRepository::new(database), ids)
    }

    fn attempt(item_id: i64, accuracy: f64) -> NewAttempt {
        NewAttempt {
            item_id,
            answer: "answer".into(),
            is_correct: accuracy == 1.0,
            accuracy,
            replay_count: 0,
        }
    }

    fn statuses(practice: &PracticeRepository) -> Vec<(i64, String, AnswerStatus)> {
        practice
            .answers("a")
            .unwrap()
            .into_iter()
            .map(|a| (a.item_id, a.text, a.status))
            .collect()
    }

    #[test]
    fn stats_track_count_best_and_last_and_go_with_the_lesson() {
        let (lessons, practice, ids) = setup(1);

        practice
            .record_check(&attempt(ids[0], 1.0), "One.")
            .unwrap();
        practice.record_check(&attempt(ids[0], 0.5), "On.").unwrap();

        let stats = &practice.stats_by_item("a").unwrap()[&ids[0]];
        assert_eq!(stats.attempt_count, 2);
        assert_eq!(stats.best_accuracy, Some(1.0));
        assert_eq!(stats.last_accuracy, Some(0.5));

        lessons.delete("a").unwrap();
        assert!(practice.stats_by_item("a").unwrap().is_empty());
        assert!(practice.answers("a").unwrap().is_empty());
    }

    #[test]
    fn a_draft_becomes_checked_and_editing_makes_it_a_draft_again() {
        let (_lessons, practice, ids) = setup(1);

        practice.save_draft(ids[0], "one").unwrap();
        assert_eq!(
            statuses(&practice),
            [(ids[0], "one".into(), AnswerStatus::Draft)]
        );

        practice.record_check(&attempt(ids[0], 0.5), "one").unwrap();
        assert_eq!(
            statuses(&practice),
            [(ids[0], "one".into(), AnswerStatus::Checked)]
        );

        // A late save of the same text must not undo the check.
        practice.save_draft(ids[0], "one").unwrap();
        assert_eq!(
            statuses(&practice),
            [(ids[0], "one".into(), AnswerStatus::Checked)]
        );

        practice.save_draft(ids[0], "One.").unwrap();
        assert_eq!(
            statuses(&practice),
            [(ids[0], "One.".into(), AnswerStatus::Draft)]
        );

        practice.delete_answer(ids[0]).unwrap();
        assert!(statuses(&practice).is_empty());
    }

    #[test]
    fn answers_saved_in_the_same_second_are_in_lesson_order() {
        let (_lessons, practice, ids) = setup(3);

        practice.save_draft(ids[2], "three").unwrap();
        practice.save_draft(ids[0], "one").unwrap();
        practice
            .database
            .connection()
            .execute("UPDATE answers SET updated_at = '2026-01-01T00:00:00Z'", [])
            .unwrap();

        let order: Vec<i64> = statuses(&practice).iter().map(|a| a.0).collect();
        assert_eq!(order, [ids[0], ids[2]]);
    }

    #[test]
    fn clearing_a_lesson_keeps_its_statistics_and_other_lessons() {
        let (lessons, practice, ids) = setup(2);
        lessons
            .insert(&NewLesson {
                id: "b".into(),
                title: "Other".into(),
                source_path: Some("/tmp/b.txt".into()),
                created_at: timestamp_now(),
                items: vec![NewItem {
                    position: 1,
                    text: "Other.".into(),
                    audio_path: "lessons/b/audio/001.mp3".into(),
                }],
            })
            .unwrap();
        let other_id = lessons.items("b").unwrap()[0].id;
        practice.save_draft(ids[0], "one").unwrap();
        practice.record_check(&attempt(ids[1], 0.5), "two").unwrap();
        practice.save_draft(other_id, "other").unwrap();

        practice.delete_lesson_answers("a").unwrap();

        assert!(practice.answers("a").unwrap().is_empty());
        assert_eq!(practice.answers("b").unwrap().len(), 1);
        assert_eq!(
            practice.stats_by_item("a").unwrap()[&ids[1]].attempt_count,
            1
        );
    }
}
