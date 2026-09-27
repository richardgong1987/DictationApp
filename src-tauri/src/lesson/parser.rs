//! Lesson text format.
//!
//! A lesson is a UTF-8 text file. Blank lines (empty or whitespace-only) are the
//! only separator between dictation items; periods never split an item.

use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedItem {
    /// 1-based position inside the lesson.
    pub position: i64,
    pub text: String,
}

/// Splits lesson content into dictation items.
///
/// Rules:
/// - a UTF-8 BOM and `\r\n` line endings are tolerated;
/// - one or more blank lines separate items;
/// - each item is trimmed, and hard-wrapped lines inside an item are joined
///   with a single space so the passage reads (and is spoken) as one block;
/// - empty items are ignored;
/// - punctuation is preserved.
pub fn parse_lesson(content: &str) -> Vec<ParsedItem> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let lines: Vec<&str> = content.lines().map(str::trim).collect();
    lines
        .split(|line| line.is_empty())
        .filter(|passage| !passage.is_empty())
        .zip(1..)
        .map(|(passage, position)| ParsedItem {
            position,
            text: passage.join(" "),
        })
        .collect()
}

/// Derives a lesson title from the imported file name.
pub fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "Untitled lesson".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lesson::{is_too_long, word_count};

    fn texts(content: &str) -> Vec<String> {
        parse_lesson(content)
            .into_iter()
            .map(|item| item.text)
            .collect()
    }

    #[test]
    fn splits_on_blank_lines() {
        let content = "I should have told you earlier.\n\nThe meeting has been moved to Friday afternoon.\n\nIf I had known about the problem, I would have called you.\n\nShe doesn't usually take the train to work.\n";
        let items = parse_lesson(content);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].text, "I should have told you earlier.");
        assert_eq!(items[3].text, "She doesn't usually take the train to work.");
        assert_eq!(
            items.iter().map(|item| item.position).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
    }

    #[test]
    fn does_not_split_on_periods() {
        assert_eq!(
            texts("Stop. Look around. Then go.\n\nNext one."),
            vec!["Stop. Look around. Then go.", "Next one."]
        );
    }

    #[test]
    fn ignores_whitespace_only_lines_and_extra_blank_lines() {
        let content = "\n\n  First item.  \n   \n\t\n\n\nSecond item.\n\n   \n";
        assert_eq!(texts(content), vec!["First item.", "Second item."]);
    }

    #[test]
    fn handles_crlf_and_bom() {
        let content = "\u{feff}One.\r\n\r\nTwo.\r\n";
        assert_eq!(texts(content), vec!["One.", "Two."]);
    }

    #[test]
    fn joins_wrapped_lines_within_an_item() {
        assert_eq!(
            texts("If I had known,\n  I would have called you.\n\nDone."),
            vec!["If I had known, I would have called you.", "Done."]
        );
    }

    #[test]
    fn empty_content_has_no_items() {
        assert!(parse_lesson("").is_empty());
        assert!(parse_lesson("  \n\n \r\n").is_empty());
    }

    #[test]
    fn preserves_punctuation() {
        assert_eq!(
            texts("Would you mind closing the window?"),
            vec!["Would you mind closing the window?"]
        );
    }

    #[test]
    fn detects_long_items() {
        let thirty = vec!["word"; 30].join(" ");
        let thirty_one = vec!["word"; 31].join(" ");
        assert!(!is_too_long(&thirty));
        assert!(is_too_long(&thirty_one));
        assert_eq!(word_count(&parse_lesson(&thirty_one)[0].text), 31);
    }

    #[test]
    fn title_comes_from_the_file_name() {
        assert_eq!(title_from_path(Path::new("/tmp/lesson01.txt")), "lesson01");
        assert_eq!(title_from_path(Path::new("/tmp/ .txt")), "Untitled lesson");
    }
}
