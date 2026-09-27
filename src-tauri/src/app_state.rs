//! Composition root: every repository and service is created here, once.

use std::path::PathBuf;

use crate::audio::cache::AudioCache;
use crate::audio::service::AudioService;
use crate::database::Database;
use crate::lesson::files::LessonFiles;
use crate::lesson::repository::LessonRepository;
use crate::lesson::service::LessonService;
use crate::practice::repository::AttemptRepository;
use crate::practice::service::PracticeService;
use crate::settings::repository::SettingsRepository;
use crate::settings::service::SettingsService;
use crate::settings::EnvCredentials;

/// Managed by Tauri; commands reach the services through it.
pub struct AppState {
    pub lessons: LessonService,
    pub audio: AudioService,
    pub practice: PracticeService,
    pub settings: SettingsService,
}

impl AppState {
    pub fn new(database: Database, data_dir: PathBuf, env_credentials: EnvCredentials) -> Self {
        let lesson_repository = LessonRepository::new(database.clone());
        let attempt_repository = AttemptRepository::new(database.clone());
        let settings = SettingsService::new(SettingsRepository::new(database), env_credentials);
        let files = LessonFiles::new(data_dir);
        let audio_cache = AudioCache::new(files.clone());

        Self {
            lessons: LessonService::new(
                lesson_repository.clone(),
                attempt_repository.clone(),
                settings.clone(),
                files.clone(),
                audio_cache.clone(),
            ),
            audio: AudioService::new(
                lesson_repository.clone(),
                settings.clone(),
                files,
                audio_cache,
            ),
            practice: PracticeService::new(lesson_repository, attempt_repository),
            settings,
        }
    }
}
