mod cache;
mod commands;
mod compare;
mod database;
mod error;
mod lesson;
mod models;
mod settings;
mod tts;

use tauri::{Manager, Runtime};

use commands::AppState;
use database::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Local development: pick up AZURE_SPEECH_* from a `.env` in the working
    // directory. Real environment variables always win.
    let _ = dotenvy::dotenv();

    with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // Installed builds can also read a `.env` from the app data directory.
            let _ = dotenvy::from_path(data_dir.join(".env"));
            let db = Database::open(&data_dir.join("dictation.db"))?;
            app.manage(AppState::new(db, data_dir));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DictationApp");
}

/// Registers every frontend-callable command.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::list_lessons,
        commands::import_lesson,
        commands::get_lesson,
        commands::delete_lesson,
        commands::generate_lesson_audio,
        commands::generate_item_audio,
        commands::get_item_audio,
        commands::check_answer,
        commands::get_settings,
        commands::save_settings,
        commands::save_player_preferences,
    ])
}

#[cfg(test)]
mod ipc_tests;
