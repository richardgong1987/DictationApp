//! Answer comparison: normalization plus a word-level diff.
//!
//! Words are compared case-insensitively with surrounding punctuation removed,
//! so the score reflects listening accuracy. Every word still counts: a
//! missing article, preposition or verb ending is reported, never ignored.
//!
//! The diff is a plain LCS over normalized words. It lives behind
//! [`compare_answer`] so a smarter token diff can replace it later.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffKind {
    /// Word heard correctly.
    Equal,
    /// Word in the source that the answer lacks.
    Missing,
    /// Word in the answer that the source lacks.
    Extra,
    /// Answer wrote a different word in this position.
    Changed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffToken {
    pub kind: DiffKind,
    /// Source word as written (with punctuation), if any.
    pub expected: Option<String>,
    /// Answer word as typed, if any.
    pub actual: Option<String>,
}

impl DiffToken {
    fn new(kind: DiffKind, expected: Option<&str>, actual: Option<&str>) -> Self {
        Self {
            kind,
            expected: expected.map(str::to_string),
            actual: actual.map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Same words in the same order, ignoring case and punctuation.
    pub is_correct: bool,
    /// Correct words / max(source words, answer words), in `0.0..=1.0`.
    pub accuracy: f64,
    pub correct_words: usize,
    pub source_words: usize,
    pub answer_words: usize,
    pub diff: Vec<DiffToken>,
}

/// Collapses whitespace and trims; used for storing/displaying the answer.
pub fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalizes one word for comparison: lowercase, typographic apostrophes and
/// dashes unified, leading/trailing punctuation removed. Inner apostrophes and
/// hyphens stay (`doesn't`, `well-known`).
fn normalize_word(word: &str) -> String {
    let unified: String = word
        .chars()
        .map(|c| match c {
            '\u{2018}' | '\u{2019}' | '\u{02bc}' | '`' => '\'',
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' => '-',
            _ => c,
        })
        .collect();
    unified
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

pub fn compare_answer(source: &str, answer: &str) -> Comparison {
    let source_words = words(source);
    let answer_words = words(answer);
    let lcs = lcs_table(&source_words, &answer_words);
    let correct = lcs[0][0];
    let (n, m) = (source_words.len(), answer_words.len());
    let accuracy = match n.max(m) {
        0 => 1.0,
        longest => correct as f64 / longest as f64,
    };
    Comparison {
        is_correct: n == m && correct == n,
        accuracy,
        correct_words: correct,
        source_words: n,
        answer_words: m,
        diff: word_diff(&source_words, &answer_words, &lcs),
    }
}

struct Word<'a> {
    raw: &'a str,
    normalized: String,
}

fn words(text: &str) -> Vec<Word<'_>> {
    text.split_whitespace()
        .map(|raw| Word {
            raw,
            normalized: normalize_word(raw),
        })
        .filter(|word| !word.normalized.is_empty())
        .collect()
}

/// `table[i][j]` = length of the longest common subsequence of
/// `source[i..]` and `answer[j..]`.
fn lcs_table(source: &[Word<'_>], answer: &[Word<'_>]) -> Vec<Vec<usize>> {
    let (n, m) = (source.len(), answer.len());
    let mut table = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            table[i][j] = if source[i].normalized == answer[j].normalized {
                table[i + 1][j + 1] + 1
            } else {
                table[i + 1][j].max(table[i][j + 1])
            };
        }
    }
    table
}

/// Walks the LCS table, emitting matches as they come and collecting the
/// differences between two matches as one gap.
fn word_diff(source: &[Word<'_>], answer: &[Word<'_>], lcs: &[Vec<usize>]) -> Vec<DiffToken> {
    let (n, m) = (source.len(), answer.len());
    let mut diff = Vec::with_capacity(n.max(m));
    let mut gap = Gap::default();
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && source[i].normalized == answer[j].normalized {
            gap.flush_into(&mut diff);
            diff.push(DiffToken::new(
                DiffKind::Equal,
                Some(source[i].raw),
                Some(answer[j].raw),
            ));
            i += 1;
            j += 1;
        } else if j == m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
            gap.missing.push(source[i].raw);
            i += 1;
        } else {
            gap.extra.push(answer[j].raw);
            j += 1;
        }
    }
    gap.flush_into(&mut diff);
    diff
}

/// Differences between two matching words. Missing and extra words in the
/// same gap are paired up as changes; leftovers stay missing/extra.
#[derive(Default)]
struct Gap<'a> {
    missing: Vec<&'a str>,
    extra: Vec<&'a str>,
}

impl Gap<'_> {
    fn flush_into(&mut self, diff: &mut Vec<DiffToken>) {
        let paired = self.missing.len().min(self.extra.len());
        for (&expected, &actual) in self.missing.iter().zip(&self.extra) {
            diff.push(DiffToken::new(
                DiffKind::Changed,
                Some(expected),
                Some(actual),
            ));
        }
        for &expected in &self.missing[paired..] {
            diff.push(DiffToken::new(DiffKind::Missing, Some(expected), None));
        }
        for &actual in &self.extra[paired..] {
            diff.push(DiffToken::new(DiffKind::Extra, None, Some(actual)));
        }
        self.missing.clear();
        self.extra.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(comparison: &Comparison) -> Vec<(DiffKind, Option<&str>, Option<&str>)> {
        comparison
            .diff
            .iter()
            .map(|t| (t.kind.clone(), t.expected.as_deref(), t.actual.as_deref()))
            .collect()
    }

    #[test]
    fn normalizes_words() {
        assert_eq!(normalize_word("Earlier."), "earlier");
        assert_eq!(normalize_word("\"Hello,\""), "hello");
        assert_eq!(normalize_word("doesn\u{2019}t"), "doesn't");
        assert_eq!(normalize_word("well-known"), "well-known");
        assert_eq!(normalize_word("—"), "");
        assert_eq!(normalize_whitespace("  a \n b\t c "), "a b c");
    }

    #[test]
    fn ignores_case_punctuation_and_spacing() {
        let c = compare_answer(
            "I should have told you earlier.",
            "  i SHOULD have   told you earlier ",
        );
        assert!(c.is_correct);
        assert_eq!(c.accuracy, 1.0);
        assert!(c.diff.iter().all(|t| t.kind == DiffKind::Equal));
    }

    #[test]
    fn readme_example_reports_missing_and_changed_words() {
        let c = compare_answer(
            "I should have told you earlier.",
            "I should told you early.",
        );
        assert!(!c.is_correct);
        assert_eq!(
            kinds(&c),
            vec![
                (DiffKind::Equal, Some("I"), Some("I")),
                (DiffKind::Equal, Some("should"), Some("should")),
                (DiffKind::Missing, Some("have"), None),
                (DiffKind::Equal, Some("told"), Some("told")),
                (DiffKind::Equal, Some("you"), Some("you")),
                (DiffKind::Changed, Some("earlier."), Some("early.")),
            ]
        );
        assert_eq!(c.correct_words, 4);
        assert!((c.accuracy - 4.0 / 6.0).abs() < 1e-9);
    }

    #[test]
    fn small_words_are_never_ignored() {
        let c = compare_answer("She takes the train to work.", "She take train work.");
        let missing: Vec<_> = c
            .diff
            .iter()
            .filter(|t| t.kind == DiffKind::Missing)
            .filter_map(|t| t.expected.as_deref())
            .collect();
        assert_eq!(missing, vec!["the", "to"]);
        assert!(c
            .diff
            .iter()
            .any(|t| t.kind == DiffKind::Changed && t.actual.as_deref() == Some("take")));
    }

    #[test]
    fn extra_words_lower_accuracy() {
        let c = compare_answer("See you soon.", "See you very soon.");
        assert!(!c.is_correct);
        assert_eq!(c.correct_words, 3);
        assert_eq!(c.accuracy, 0.75);
        assert!(kinds(&c).contains(&(DiffKind::Extra, None, Some("very"))));
    }

    #[test]
    fn empty_answer_is_all_missing() {
        let c = compare_answer("Would you mind?", "   ");
        assert_eq!(c.accuracy, 0.0);
        assert_eq!(c.diff.len(), 3);
        assert!(c.diff.iter().all(|t| t.kind == DiffKind::Missing));
    }
}
