use crate::error::AppResult;
use crate::lesson::repository::LessonRepository;
use crate::practice::comparison::{compare_answer, normalize_whitespace};
use crate::practice::repository::{AttemptRepository, NewAttempt};
use crate::practice::CheckResult;

pub struct PracticeService {
    lessons: LessonRepository,
    attempts: AttemptRepository,
}

impl PracticeService {
    pub fn new(lessons: LessonRepository, attempts: AttemptRepository) -> Self {
        Self { lessons, attempts }
    }

    /// Compares the answer with the item's text and records the attempt.
    pub fn check_answer(
        &self,
        item_id: i64,
        answer: &str,
        replay_count: i64,
    ) -> AppResult<CheckResult> {
        let item = self.lessons.get_item(item_id)?;
        let answer = normalize_whitespace(answer);
        let comparison = compare_answer(&item.text, &answer);
        self.attempts.insert(&NewAttempt {
            item_id: item.id,
            answer: answer.clone(),
            is_correct: comparison.is_correct,
            accuracy: comparison.accuracy,
            replay_count: replay_count.max(0),
        })?;
        Ok(CheckResult {
            source_text: item.text,
            answer,
            comparison,
        })
    }
}
