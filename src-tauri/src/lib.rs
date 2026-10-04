//! DictationApp backend.
//!
//! Code is grouped by feature (`lesson`, `audio`, `practice`, `settings`,
//! `transfer`).
//! Inside each feature, `mod.rs` holds its types and rules, `repository.rs`
//! its SQL and `service.rs` its workflows. `commands` exposes the services to
//! the frontend; `app_state` wires everything together.

mod app_state;
mod audio;
mod commands;
mod database;
mod error;
mod lesson;
mod practice;
mod settings;
mod transfer;
mod tts;

use tauri::{Manager, Runtime};

use app_state::AppState;
use database::Database;
use settings::EnvCredentials;

/// Environment variables that take precedence over credentials stored in Settings.
const ENV_AZURE_SPEECH_KEY: &str = "AZURE_SPEECH_KEY";
const ENV_AZURE_SPEECH_REGION: &str = "AZURE_SPEECH_REGION";
const ENV_ELEVENLABS_API_KEY: &str = "ELEVENLABS_API_KEY";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Local development: pick up TTS credentials from a `.env` in the working
    // directory. Real environment variables always win.
    let _ = dotenvy::dotenv();

    with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // Installed builds can also read a `.env` from the app data directory.
            let _ = dotenvy::from_path(data_dir.join(".env"));
            let database = Database::open(&data_dir.join("dictation.db"))?;
            app.manage(AppState::new(database, data_dir, read_env_credentials()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DictationApp");
}

fn read_env_credentials() -> EnvCredentials {
    EnvCredentials::new(
        std::env::var(ENV_AZURE_SPEECH_KEY).ok(),
        std::env::var(ENV_AZURE_SPEECH_REGION).ok(),
        std::env::var(ENV_ELEVENLABS_API_KEY).ok(),
    )
}

/// Registers every frontend-callable command.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::list_lessons,
        commands::import_lesson,
        commands::import_lesson_text,
        commands::get_lesson,
        commands::rename_lesson,
        commands::delete_lesson,
        commands::export_lessons,
        commands::import_lessons,
        commands::generate_lesson_audio,
        commands::generate_item_audio,
        commands::get_item_audio,
        commands::check_answer,
        commands::save_answer,
        commands::get_practice_progress,
        commands::clear_answers,
        commands::get_settings,
        commands::save_settings,
        commands::save_player_preferences,
    ])
}

#[cfg(test)]
mod ipc_tests;
