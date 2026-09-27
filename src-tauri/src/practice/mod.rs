//! Practice: checking typed answers and keeping per-item statistics.

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
    /// The answer as stored: whitespace collapsed, otherwise as typed.
    pub answer: String,
    #[serde(flatten)]
    pub comparison: Comparison,
}
