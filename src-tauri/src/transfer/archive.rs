//! The lesson export file, a zip archive:
//!
//! ```text
//! manifest.json                format, version, voice settings, every lesson and its items
//! audio/<lesson-id>/001.mp3    one file per item that has audio
//! ```
//!
//! Entries are stored uncompressed, since MP3s are compressed already.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::settings::VoiceSettings;

/// Identifies the file as a lesson export, whatever it is called.
const FORMAT: &str = "dictation-app-lessons";
/// Bump when older versions of the app would misread the new layout.
const VERSION: u32 = 1;
const MANIFEST_ENTRY: &str = "manifest.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    format: String,
    version: u32,
    /// The exporting device's voice settings.
    pub voice: VoiceSettings,
    pub lessons: Vec<ExportedLesson>,
}

impl Manifest {
    pub fn new(voice: VoiceSettings) -> Self {
        Self {
            format: FORMAT.to_string(),
            version: VERSION,
            voice,
            lessons: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedLesson {
    pub id: String,
    pub title: String,
    pub created_at: String,
    /// The lesson's text, as imported or pasted.
    pub source_text: String,
    pub items: Vec<ExportedItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedItem {
    pub position: i64,
    pub text: String,
    /// Cache key of the item's audio; `None` when the archive holds no audio for it.
    pub audio_cache_key: Option<String>,
}

/// Writes an archive to a temporary file next to its destination, which only
/// [`finish`](Self::finish) moves into place: a failed export leaves no
/// half-written archive behind.
pub struct ArchiveWriter {
    zip: ZipWriter<File>,
    partial: PathBuf,
    target: PathBuf,
}

impl ArchiveWriter {
    pub fn create(path: &Path) -> AppResult<Self> {
        let mut partial = OsString::from(path);
        partial.push(".part");
        let partial = PathBuf::from(partial);
        Ok(Self {
            zip: ZipWriter::new(File::create(&partial)?),
            partial,
            target: path.to_path_buf(),
        })
    }

    pub fn add_audio(&mut self, lesson_id: &str, position: i64, audio: &[u8]) -> AppResult<()> {
        self.add_entry(&audio_entry(lesson_id, position), audio)
    }

    pub fn finish(mut self, manifest: &Manifest) -> AppResult<()> {
        self.add_entry(MANIFEST_ENTRY, &serde_json::to_vec_pretty(manifest)?)?;
        self.zip.finish().map_err(io::Error::from)?;
        std::fs::rename(&self.partial, &self.target)?;
        Ok(())
    }

    pub fn discard(self) {
        drop(self.zip);
        // Best effort: the error that made the export fail is the one worth reporting.
        let _ = std::fs::remove_file(&self.partial);
    }

    fn add_entry(&mut self, name: &str, bytes: &[u8]) -> AppResult<()> {
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        self.zip
            .start_file(name, options)
            .map_err(io::Error::from)?;
        self.zip.write_all(bytes)?;
        Ok(())
    }
}

pub struct ArchiveReader {
    zip: ZipArchive<File>,
}

impl ArchiveReader {
    /// Opens an archive and reads its manifest.
    pub fn open(path: &Path) -> AppResult<(Self, Manifest)> {
        let mut zip =
            ZipArchive::new(File::open(path)?).map_err(|_| AppError::InvalidLessonExport)?;
        let manifest = read_manifest(&mut zip)?;
        Ok((Self { zip }, manifest))
    }

    pub fn read_audio(&mut self, lesson_id: &str, position: i64) -> AppResult<Vec<u8>> {
        let mut entry = self
            .zip
            .by_name(&audio_entry(lesson_id, position))
            .map_err(|_| AppError::InvalidLessonExport)?;
        let mut audio = Vec::new();
        entry
            .read_to_end(&mut audio)
            .map_err(|_| AppError::InvalidLessonExport)?;
        Ok(audio)
    }
}

/// The part of the manifest every version keeps, read first so that a newer
/// layout is reported as newer rather than as damaged.
#[derive(Deserialize)]
struct ManifestHeader {
    format: String,
    version: u32,
}

fn read_manifest(zip: &mut ZipArchive<File>) -> AppResult<Manifest> {
    let mut bytes = Vec::new();
    zip.by_name(MANIFEST_ENTRY)
        .map_err(|_| AppError::InvalidLessonExport)?
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::InvalidLessonExport)?;

    let header: ManifestHeader =
        serde_json::from_slice(&bytes).map_err(|_| AppError::InvalidLessonExport)?;
    if header.format != FORMAT {
        return Err(AppError::InvalidLessonExport);
    }
    if header.version > VERSION {
        return Err(AppError::LessonExportTooNew);
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| AppError::InvalidLessonExport)?;
    // Lesson ids name folders on this device; anything but a UUID could point outside them.
    if manifest
        .lessons
        .iter()
        .any(|lesson| Uuid::parse_str(&lesson.id).is_err())
    {
        return Err(AppError::InvalidLessonExport);
    }
    Ok(manifest)
}

fn audio_entry(lesson_id: &str, position: i64) -> String {
    format!("audio/{lesson_id}/{position:03}.mp3")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    const LESSON_ID: &str = "0b6f5c0e-3d1a-4a8e-9a57-2f1c2b7d9e10";

    fn manifest_with_lesson(id: &str) -> Manifest {
        let mut manifest = Manifest::new(Settings::default().voice());
        manifest.lessons.push(ExportedLesson {
            id: id.into(),
            title: "Unit 1".into(),
            created_at: "2026-10-01T08:00:00Z".into(),
            source_text: "One.\n\nTwo.\n".into(),
            items: vec![
                ExportedItem {
                    position: 1,
                    text: "One.".into(),
                    audio_cache_key: Some("key-1".into()),
                },
                ExportedItem {
                    position: 2,
                    text: "Two.".into(),
                    audio_cache_key: None,
                },
            ],
        });
        manifest
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn open_error(path: &Path) -> AppError {
        ArchiveReader::open(path).err().unwrap()
    }

    #[test]
    fn written_archive_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lessons.zip");

        let mut writer = ArchiveWriter::create(&path).unwrap();
        writer.add_audio(LESSON_ID, 1, b"mp3 one").unwrap();
        writer.finish(&manifest_with_lesson(LESSON_ID)).unwrap();

        assert!(!dir.path().join("lessons.zip.part").exists());
        let (mut reader, manifest) = ArchiveReader::open(&path).unwrap();
        assert_eq!(manifest.voice, Settings::default().voice());
        assert_eq!(manifest.lessons[0].title, "Unit 1");
        assert_eq!(manifest.lessons[0].items[1].audio_cache_key, None);
        assert_eq!(reader.read_audio(LESSON_ID, 1).unwrap(), b"mp3 one");
        assert!(matches!(
            reader.read_audio(LESSON_ID, 2),
            Err(AppError::InvalidLessonExport)
        ));
    }

    #[test]
    fn a_discarded_export_leaves_no_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lessons.zip");

        let mut writer = ArchiveWriter::create(&path).unwrap();
        writer.add_audio(LESSON_ID, 1, b"mp3 one").unwrap();
        writer.discard();

        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn files_that_are_not_lesson_exports_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let not_a_zip = dir.path().join("notes.zip");
        std::fs::write(&not_a_zip, "just text").unwrap();
        let other_zip = dir.path().join("photos.zip");
        write_zip(&other_zip, &[("photo.jpg", b"jpeg")]);
        let other_format = dir.path().join("other.zip");
        write_zip(
            &other_format,
            &[(
                MANIFEST_ENTRY,
                br#"{"format":"something-else","version":1}"#,
            )],
        );

        for path in [not_a_zip, other_zip, other_format] {
            assert!(
                matches!(open_error(&path), AppError::InvalidLessonExport),
                "{path:?}"
            );
        }
    }

    #[test]
    fn a_newer_version_asks_for_an_update() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.zip");
        let manifest = format!(
            r#"{{"format":"{FORMAT}","version":{},"lessons":"changed"}}"#,
            VERSION + 1
        );
        write_zip(&path, &[(MANIFEST_ENTRY, manifest.as_bytes())]);

        assert!(matches!(open_error(&path), AppError::LessonExportTooNew));
    }

    #[test]
    fn lesson_ids_that_are_not_uuids_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lessons.zip");
        let writer = ArchiveWriter::create(&path).unwrap();
        writer
            .finish(&manifest_with_lesson("../../escape"))
            .unwrap();

        assert!(matches!(open_error(&path), AppError::InvalidLessonExport));
    }
}
