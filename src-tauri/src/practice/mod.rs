//! Practice: checking typed answers, keeping them between sessions, and
//! per-item statistics.

pub mod comparison;
pub mod repository;
pub mod service;

use serde::Serialize;

use crate::practice::comparison::Comparison;

/// Per-item practice statistics.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub attempt_count: i64,
    pub best_accuracy: Option<f64>,
    pub last_accuracy: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub source_text: String,
    /// The answer as compared: whitespace collapsed, otherwise as typed.
    pub answer: String,
    #[serde(flatten)]
    pub comparison: Comparison,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerStatus {
    /// Typed, or edited since its last check.
    Draft,
    /// Checked against the original text as it is now.
    Checked,
}

/// The learner's latest answer to one item, as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub item_id: i64,
    /// Exactly as typed, so it can be shown again unchanged.
    pub text: String,
    pub status: AnswerStatus,
}

/// A stored answer as the practice screen restores it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAnswer {
    pub item_id: i64,
    pub text: String,
    /// The comparison with the original text, for checked answers only.
    pub result: Option<CheckResult>,
}

/// What the practice screen needs to continue a lesson where it stopped.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeProgress {
    pub answers: Vec<SavedAnswer>,
    /// `None` until the lesson has been practised.
    pub resume_item_id: Option<i64>,
}

/// Where to continue: the item answered last, or the one after it once that
/// answer is checked (staying on the last item at the end of the lesson).
/// `item_ids` are in lesson order.
pub fn resume_item_id(item_ids: &[i64], latest: Option<&Answer>) -> Option<i64> {
    let latest = latest?;
    let position = item_ids.iter().position(|&id| id == latest.item_id)?;
    let resume_position = match latest.status {
        AnswerStatus::Draft => position,
        AnswerStatus::Checked => (position + 1).min(item_ids.len() - 1),
    };
    Some(item_ids[resume_position])
}

#[cfg(test)]
mod tests {
    use super::*;

    const ITEMS: [i64; 3] = [10, 11, 12];

    fn answer(item_id: i64, status: AnswerStatus) -> Answer {
        Answer {
            item_id,
            text: "typed".into(),
            status,
        }
    }

    #[test]
    fn a_new_lesson_has_no_resume_point() {
        assert_eq!(resume_item_id(&ITEMS, None), None);
    }

    #[test]
    fn resumes_on_an_unchecked_answer() {
        let latest = answer(11, AnswerStatus::Draft);
        assert_eq!(resume_item_id(&ITEMS, Some(&latest)), Some(11));
    }

    #[test]
    fn resumes_after_a_checked_answer() {
        let latest = answer(11, AnswerStatus::Checked);
        assert_eq!(resume_item_id(&ITEMS, Some(&latest)), Some(12));
    }

    #[test]
    fn stays_on_the_last_item_once_it_is_checked() {
        let latest = answer(12, AnswerStatus::Checked);
        assert_eq!(resume_item_id(&ITEMS, Some(&latest)), Some(12));
    }
}
