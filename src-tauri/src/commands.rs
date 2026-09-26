//! Tauri commands exposed to the frontend.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::cache::{self, AudioOutcome, AudioStatus};
use crate::compare;
use crate::database::{now, Database, NewItem};
use crate::error::{AppError, AppResult};
use crate::lesson;
use crate::models::{
    AudioProgress, CheckResult, DictationItem, GenerationSummary, ItemStats, ItemView, Lesson,
    LessonDetail, LessonSummary,
};
use crate::settings::{Settings, SettingsView};
use crate::tts::AzureTts;

pub struct AppState {
    pub db: Database,
    pub data_dir: PathBuf,
    http: reqwest::Client,
    /// Lessons whose audio is currently being generated.
    generating: Mutex<HashSet<String>>,
}

impl AppState {
    pub fn new(db: Database, data_dir: PathBuf) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self {
            db,
            data_dir,
            http,
            generating: Mutex::new(HashSet::new()),
        }
    }

    fn lesson_dir(&self, lesson_id: &str) -> PathBuf {
        self.data_dir.join("lessons").join(lesson_id)
    }

    /// `None` when no credentials are configured; cached audio still works then.
    fn tts_provider(&self, settings: &Settings) -> AppResult<Option<AzureTts>> {
        match settings.resolve_credentials() {
            Some(creds) => Ok(Some(AzureTts::new(self.http.clone(), creds)?)),
            None => Ok(None),
        }
    }
}

/// Relative (to the data dir) path of an item's MP3, always with `/`.
fn audio_rel_path(lesson_id: &str, position: i64) -> String {
    format!(
        "lessons/{lesson_id}/audio/{}",
        lesson::audio_file_name(position.max(0) as usize)
    )
}

fn item_audio_status(data_dir: &Path, settings: &Settings, item: &DictationItem) -> AudioStatus {
    let expected = cache::cache_key(&settings.tts_request(&item.text));
    cache::audio_status(
        data_dir,
        item.audio_path.as_deref(),
        item.audio_cache_key.as_deref(),
        &expected,
    )
}

fn item_view(
    data_dir: &Path,
    settings: &Settings,
    item: &DictationItem,
    stats: ItemStats,
) -> ItemView {
    ItemView {
        id: item.id,
        position: item.position,
        text: item.text.clone(),
        word_count: lesson::word_count(&item.text),
        too_long: lesson::is_too_long(&item.text),
        audio_status: item_audio_status(data_dir, settings, item),
        stats,
    }
}

fn lesson_detail(state: &AppState, lesson_id: &str) -> AppResult<LessonDetail> {
    let lesson = state.db.get_lesson(lesson_id)?;
    let settings = state.db.load_settings()?;
    let mut stats = state.db.lesson_item_stats(lesson_id)?;
    let items = state
        .db
        .lesson_items(lesson_id)?
        .iter()
        .map(|item| {
            let s = stats.remove(&item.id).unwrap_or_default();
            item_view(&state.data_dir, &settings, item, s)
        })
        .collect();
    Ok(LessonDetail { lesson, items })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataItem<'a> {
    position: i64,
    text: &'a str,
    audio_file: Option<&'a str>,
    audio_cache_key: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metadata<'a> {
    #[serde(flatten)]
    lesson: &'a Lesson,
    items: Vec<MetadataItem<'a>>,
}

/// Writes `metadata.json` next to the lesson source. SQLite stays the source
/// of truth; this file makes the lesson folder self-describing.
fn write_metadata(state: &AppState, lesson_id: &str) -> AppResult<()> {
    let lesson = state.db.get_lesson(lesson_id)?;
    let items = state.db.lesson_items(lesson_id)?;
    let metadata = Metadata {
        lesson: &lesson,
        items: items
            .iter()
            .map(|i| MetadataItem {
                position: i.position,
                text: &i.text,
                audio_file: i.audio_path.as_deref().and_then(|p| p.rsplit('/').next()),
                audio_cache_key: i.audio_cache_key.as_deref(),
            })
            .collect(),
    };
    let dir = state.lesson_dir(lesson_id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        dir.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata)?,
    )?;
    Ok(())
}

/// Generates (or reuses) one item's audio and records the result.
async fn ensure_item_audio(
    state: &AppState,
    provider: Option<&AzureTts>,
    settings: &Settings,
    item: &DictationItem,
    force: bool,
) -> AppResult<AudioOutcome> {
    let rel = item
        .audio_path
        .clone()
        .unwrap_or_else(|| audio_rel_path(&item.lesson_id, item.position));
    let request = settings.tts_request(&item.text);
    let (outcome, key) = cache::ensure_audio(
        provider,
        &state.data_dir,
        &rel,
        item.audio_cache_key.as_deref(),
        &request,
        force,
    )
    .await?;
    if item.audio_cache_key.as_deref() != Some(key.as_str())
        || item.audio_path.as_deref() != Some(rel.as_str())
    {
        state.db.set_item_audio(item.id, &rel, &key)?;
    }
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Lessons

#[tauri::command]
pub fn list_lessons(state: State<'_, AppState>) -> AppResult<Vec<LessonSummary>> {
    let settings = state.db.load_settings()?;
    state
        .db
        .list_lessons()?
        .into_iter()
        .map(|lesson| {
            let items = state.db.lesson_items(&lesson.id)?;
            Ok(LessonSummary {
                item_count: items.len(),
                audio_ready_count: items
                    .iter()
                    .filter(|i| {
                        item_audio_status(&state.data_dir, &settings, i) == AudioStatus::Ready
                    })
                    .count(),
                long_item_count: items
                    .iter()
                    .filter(|i| lesson::is_too_long(&i.text))
                    .count(),
                lesson,
            })
        })
        .collect()
}

#[tauri::command]
pub fn import_lesson(state: State<'_, AppState>, path: String) -> AppResult<LessonDetail> {
    let source_path = PathBuf::from(&path);
    let bytes = std::fs::read(&source_path)?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::Invalid("The lesson file is not valid UTF-8 text.".into()))?;
    let parsed = lesson::parse_lesson(&content);
    if parsed.is_empty() {
        return Err(AppError::Invalid(
            "No dictation items found. Separate passages with blank lines.".into(),
        ));
    }

    let created_at = now();
    let lesson = Lesson {
        id: uuid::Uuid::new_v4().to_string(),
        title: lesson::title_from_path(&source_path),
        source_path: path,
        created_at: created_at.clone(),
        updated_at: created_at,
    };
    let dir = state.lesson_dir(&lesson.id);
    std::fs::create_dir_all(dir.join("audio"))?;
    std::fs::write(dir.join("source.txt"), &content)?;

    let paths: Vec<String> = parsed
        .iter()
        .map(|p| audio_rel_path(&lesson.id, p.position as i64))
        .collect();
    let new_items: Vec<NewItem<'_>> = parsed
        .iter()
        .zip(&paths)
        .map(|(p, audio_path)| NewItem {
            position: p.position as i64,
            text: &p.text,
            audio_path,
        })
        .collect();

    if let Err(e) = state.db.insert_lesson(&lesson, &new_items) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    write_metadata(&state, &lesson.id)?;
    lesson_detail(&state, &lesson.id)
}

#[tauri::command]
pub fn get_lesson(state: State<'_, AppState>, lesson_id: String) -> AppResult<LessonDetail> {
    lesson_detail(&state, &lesson_id)
}

#[tauri::command]
pub fn delete_lesson(state: State<'_, AppState>, lesson_id: String) -> AppResult<()> {
    state.db.delete_lesson(&lesson_id)?;
    match std::fs::remove_dir_all(state.lesson_dir(&lesson_id)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Audio

/// Removes the lesson from the in-progress set when generation ends.
struct GenerationGuard<'a> {
    state: &'a AppState,
    lesson_id: String,
}

impl Drop for GenerationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.state.generating.lock() {
            set.remove(&self.lesson_id);
        }
    }
}

/// Generates audio for every item that lacks up-to-date audio (all items when
/// `force`). Emits `audio-progress` after each item and keeps going when a
/// single item fails.
#[tauri::command]
pub async fn generate_lesson_audio<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    lesson_id: String,
    force: bool,
) -> AppResult<GenerationSummary> {
    let state: &AppState = &state;
    {
        let mut set = state.generating.lock().unwrap_or_else(|e| e.into_inner());
        if !set.insert(lesson_id.clone()) {
            return Err(AppError::Invalid(
                "Audio for this lesson is already being generated.".into(),
            ));
        }
    }
    let _guard = GenerationGuard {
        state,
        lesson_id: lesson_id.clone(),
    };

    let settings = state.db.load_settings()?;
    let items = state.db.lesson_items(&lesson_id)?;
    let needs_audio = force
        || items
            .iter()
            .any(|i| item_audio_status(&state.data_dir, &settings, i) != AudioStatus::Ready);
    let provider = state.tts_provider(&settings)?;
    if needs_audio && provider.is_none() {
        return Err(crate::tts::TtsError::MissingCredentials.into());
    }

    let mut summary = GenerationSummary::default();
    let total = items.len();
    for (index, item) in items.iter().enumerate() {
        let result = ensure_item_audio(state, provider.as_ref(), &settings, item, force).await;
        let error = match result {
            Ok(AudioOutcome::Generated) => {
                summary.generated += 1;
                None
            }
            Ok(AudioOutcome::Cached) => {
                summary.cached += 1;
                None
            }
            Err(e) => {
                summary.failed += 1;
                let message = format!("Item {}: {e}", item.position);
                summary.errors.push(message.clone());
                Some(message)
            }
        };
        let current = state.db.get_item(item.id)?;
        let _ = app.emit(
            "audio-progress",
            AudioProgress {
                lesson_id: lesson_id.clone(),
                item_id: item.id,
                done: index + 1,
                total,
                audio_status: item_audio_status(&state.data_dir, &settings, &current),
                error,
            },
        );
    }

    state.db.touch_lesson(&lesson_id)?;
    write_metadata(state, &lesson_id)?;
    Ok(summary)
}

/// Generates one item's audio if needed (always when `force`).
#[tauri::command]
pub async fn generate_item_audio(
    state: State<'_, AppState>,
    item_id: i64,
    force: bool,
) -> AppResult<ItemView> {
    let state: &AppState = &state;
    let settings = state.db.load_settings()?;
    let item = state.db.get_item(item_id)?;
    let provider = state.tts_provider(&settings)?;
    ensure_item_audio(state, provider.as_ref(), &settings, &item, force).await?;
    write_metadata(state, &item.lesson_id)?;
    let item = state.db.get_item(item_id)?;
    let stats = state
        .db
        .lesson_item_stats(&item.lesson_id)?
        .remove(&item.id)
        .unwrap_or_default();
    Ok(item_view(&state.data_dir, &settings, &item, stats))
}

/// Returns the raw MP3 bytes of an item. Playback itself happens in the WebView.
#[tauri::command]
pub fn get_item_audio(state: State<'_, AppState>, item_id: i64) -> AppResult<Response> {
    let item = state.db.get_item(item_id)?;
    let path = item
        .audio_path
        .map(|p| state.data_dir.join(p))
        .filter(|p| p.is_file())
        .ok_or_else(|| AppError::NotFound("Audio for this item".into()))?;
    Ok(Response::new(std::fs::read(path)?))
}

// ---------------------------------------------------------------------------
// Practice

#[tauri::command]
pub fn check_answer(
    state: State<'_, AppState>,
    item_id: i64,
    answer: String,
    replay_count: i64,
) -> AppResult<CheckResult> {
    let item = state.db.get_item(item_id)?;
    let answer = compare::normalize_whitespace(&answer);
    let comparison = compare::compare_answer(&item.text, &answer);
    state.db.insert_attempt(
        item.id,
        &answer,
        comparison.is_correct,
        comparison.accuracy,
        replay_count.max(0),
    )?;
    Ok(CheckResult {
        source_text: item.text,
        answer,
        comparison,
    })
}

// ---------------------------------------------------------------------------
// Settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<SettingsView> {
    Ok(SettingsView::new(state.db.load_settings()?))
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<SettingsView> {
    let settings = settings.sanitized();
    state.db.save_settings(&settings)?;
    Ok(SettingsView::new(settings))
}

/// Saves only the player preferences so the practice screen never overwrites
/// voice or credential settings.
#[tauri::command]
pub fn save_player_preferences(
    state: State<'_, AppState>,
    playback_speed: f64,
    loop_enabled: bool,
) -> AppResult<()> {
    let mut settings = state.db.load_settings()?;
    settings.playback_speed = playback_speed;
    settings.loop_enabled = loop_enabled;
    state.db.save_settings(&settings.sanitized())
}
