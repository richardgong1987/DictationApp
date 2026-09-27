use std::collections::HashMap;

use crate::error::AppResult;
use crate::lesson::repository::LessonRepository;
use crate::practice::comparison::{compare_answer, normalize_whitespace};
use crate::practice::repository::{NewAttempt, PracticeRepository};
use crate::practice::{resume_item_id, AnswerStatus, CheckResult, PracticeProgress, SavedAnswer};

pub struct PracticeService {
    lessons: LessonRepository,
    practice: PracticeRepository,
}

impl PracticeService {
    pub fn new(lessons: LessonRepository, practice: PracticeRepository) -> Self {
        Self { lessons, practice }
    }

    /// Compares the answer with the item's text, records the attempt and
    /// keeps the answer as checked.
    pub fn check_answer(
        &self,
        item_id: i64,
        answer: &str,
        replay_count: i64,
    ) -> AppResult<CheckResult> {
        let item = self.lessons.get_item(item_id)?;
        let result = check(&item.text, answer);
        let attempt = NewAttempt {
            item_id: item.id,
            answer: result.answer.clone(),
            is_correct: result.comparison.is_correct,
            accuracy: result.comparison.accuracy,
            replay_count: replay_count.max(0),
        };
        self.practice.record_check(&attempt, answer)?;
        Ok(result)
    }

    /// Keeps an answer that has not been checked yet. A blank answer means
    /// the learner cleared it, so the saved one is deleted.
    pub fn save_answer(&self, item_id: i64, answer: &str) -> AppResult<()> {
        let item = self.lessons.get_item(item_id)?;
        if answer.trim().is_empty() {
            self.practice.delete_answer(item.id)
        } else {
            self.practice.save_draft(item.id, answer)
        }
    }

    /// The saved answers of a lesson and the item to continue with.
    pub fn progress(&self, lesson_id: &str) -> AppResult<PracticeProgress> {
        let items = self.lessons.items(lesson_id)?;
        let answers = self.practice.answers(lesson_id)?;
        let item_ids: Vec<i64> = items.iter().map(|item| item.id).collect();
        let resume_item_id = resume_item_id(&item_ids, answers.last());

        let texts: HashMap<i64, &str> = items
            .iter()
            .map(|item| (item.id, item.text.as_str()))
            .collect();
        let answers = answers
            .into_iter()
            .filter_map(|answer| {
                let source_text = texts.get(&answer.item_id)?;
                let is_checked = answer.status == AnswerStatus::Checked;
                Some(SavedAnswer {
                    // Recomputed rather than stored, so it always matches the comparison rules.
                    result: is_checked.then(|| check(source_text, &answer.text)),
                    item_id: answer.item_id,
                    text: answer.text,
                })
            })
            .collect();
        Ok(PracticeProgress {
            answers,
            resume_item_id,
        })
    }
}

fn check(source_text: &str, answer: &str) -> CheckResult {
    let answer = normalize_whitespace(answer);
    CheckResult {
        source_text: source_text.to_string(),
        comparison: compare_answer(source_text, &answer),
        answer,
    }
}
