//! The IPC surface the frontend calls (mirrored by `src/api/client.ts`).
//! Commands only unpack arguments and delegate to a service.

use std::path::Path;

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::app_state::AppState;
use crate::audio::{AudioGenerationProgress, AudioGenerationSummary, GENERATION_PROGRESS_EVENT};
use crate::error::AppResult;
use crate::lesson::{ItemDetail, LessonDetail, LessonSummary};
use crate::practice::CheckResult;
use crate::settings::{Settings, SettingsDetail};

// ---------------------------------------------------------------------------
// Lessons

#[tauri::command]
pub fn list_lessons(state: State<'_, AppState>) -> AppResult<Vec<LessonSummary>> {
    state.lessons.list()
}

#[tauri::command]
pub fn import_lesson(state: State<'_, AppState>, path: String) -> AppResult<LessonDetail> {
    state.lessons.import(Path::new(&path))
}

#[tauri::command]
pub fn get_lesson(state: State<'_, AppState>, lesson_id: String) -> AppResult<LessonDetail> {
    state.lessons.detail(&lesson_id)
}

#[tauri::command]
pub fn delete_lesson(state: State<'_, AppState>, lesson_id: String) -> AppResult<()> {
    state.lessons.delete(&lesson_id)
}

// ---------------------------------------------------------------------------
// Audio

#[tauri::command]
pub async fn generate_lesson_audio<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    lesson_id: String,
    force: bool,
) -> AppResult<AudioGenerationSummary> {
    let emit_progress = |progress: AudioGenerationProgress| {
        // Progress is informational; a closed window must not stop generation.
        let _ = app.emit(GENERATION_PROGRESS_EVENT, progress);
    };
    state
        .audio
        .generate_lesson(&lesson_id, force, emit_progress)
        .await
}

#[tauri::command]
pub async fn generate_item_audio(
    state: State<'_, AppState>,
    item_id: i64,
    force: bool,
) -> AppResult<ItemDetail> {
    state.audio.generate_item(item_id, force).await?;
    state.lessons.item_detail(item_id)
}

/// Responds with raw MP3 bytes rather than JSON.
#[tauri::command]
pub fn get_item_audio(state: State<'_, AppState>, item_id: i64) -> AppResult<Response> {
    Ok(Response::new(state.audio.read_item_audio(item_id)?))
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
    state.practice.check_answer(item_id, &answer, replay_count)
}

// ---------------------------------------------------------------------------
// Settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<SettingsDetail> {
    state.settings.detail()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<SettingsDetail> {
    state.settings.save(settings)
}

#[tauri::command]
pub fn save_player_preferences(
    state: State<'_, AppState>,
    playback_speed: f64,
    loop_enabled: bool,
) -> AppResult<()> {
    state
        .settings
        .save_player_preferences(playback_speed, loop_enabled)
}
