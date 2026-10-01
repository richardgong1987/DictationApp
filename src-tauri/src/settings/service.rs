use crate::error::AppResult;
use crate::settings::repository::SettingsRepository;
use crate::settings::{EnvCredentials, Settings, SettingsDetail};
use crate::tts::azure::AzureCredentials;

#[derive(Clone)]
pub struct SettingsService {
    repository: SettingsRepository,
    env: EnvCredentials,
}

impl SettingsService {
    pub fn new(repository: SettingsRepository, env: EnvCredentials) -> Self {
        Self { repository, env }
    }

    pub fn load(&self) -> AppResult<Settings> {
        self.repository.load()
    }

    pub fn detail(&self) -> AppResult<SettingsDetail> {
        Ok(SettingsDetail::new(self.load()?, &self.env))
    }

    pub fn save(&self, settings: Settings) -> AppResult<SettingsDetail> {
        let settings = settings.sanitized();
        self.repository.save(&settings)?;
        Ok(SettingsDetail::new(settings, &self.env))
    }

    /// Saves only the player preferences so the practice screen never
    /// overwrites voice or credential settings.
    pub fn save_player_preferences(
        &self,
        playback_speed: f64,
        loop_enabled: bool,
    ) -> AppResult<()> {
        let settings = Settings {
            playback_speed,
            loop_enabled,
            ..self.load()?
        };
        self.repository.save(&settings.sanitized())
    }

    /// `None` when neither the environment nor the stored settings provide both values.
    pub fn azure_credentials(&self, settings: &Settings) -> Option<AzureCredentials> {
        settings.azure_credentials(&self.env)
    }

    /// `None` when neither the environment nor the stored settings provide a key.
    pub fn elevenlabs_key(&self, settings: &Settings) -> Option<String> {
        settings.elevenlabs_key(&self.env)
    }
}
