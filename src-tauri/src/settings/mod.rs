//! User settings: TTS voice, player preferences and Azure credentials.

pub mod repository;
pub mod service;

use serde::{Deserialize, Serialize};

use crate::tts::azure::AzureCredentials;
use crate::tts::TtsRequest;

/// Azure output format. Fixed for the MVP, but still part of the cache key.
pub const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

/// Speeds the player offers; any other stored value falls back to 1.0.
pub const PLAYBACK_SPEEDS: [f64; 6] = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25];

const DEFAULT_VOICE: &str = "en-US-JennyNeural";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Azure neural voice name, e.g. `en-US-JennyNeural`.
    pub voice: String,
    /// TTS speaking rate adjustment in percent, -50..=100 (0 = normal).
    pub speaking_rate: i32,
    /// TTS pitch adjustment in percent, -50..=50 (0 = normal).
    pub pitch: i32,
    /// Azure region stored in-app; `AZURE_SPEECH_REGION` takes precedence.
    pub azure_region: String,
    /// Azure key stored in-app; `AZURE_SPEECH_KEY` takes precedence.
    pub azure_key: String,
    /// Last used player speed, one of [`PLAYBACK_SPEEDS`].
    pub playback_speed: f64,
    /// Last used loop state.
    pub loop_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            voice: DEFAULT_VOICE.to_string(),
            speaking_rate: 0,
            pitch: 0,
            azure_region: String::new(),
            azure_key: String::new(),
            playback_speed: 1.0,
            loop_enabled: false,
        }
    }
}

impl Settings {
    /// Clamps values into supported ranges and trims text fields.
    pub fn sanitized(mut self) -> Self {
        self.voice = self.voice.trim().to_string();
        if self.voice.is_empty() {
            self.voice = DEFAULT_VOICE.to_string();
        }
        self.speaking_rate = self.speaking_rate.clamp(-50, 100);
        self.pitch = self.pitch.clamp(-50, 50);
        self.azure_region = self.azure_region.trim().to_lowercase();
        self.azure_key = self.azure_key.trim().to_string();
        let is_offered_speed = PLAYBACK_SPEEDS
            .iter()
            .any(|speed| (speed - self.playback_speed).abs() < 1e-6);
        if !is_offered_speed {
            self.playback_speed = 1.0;
        }
        self
    }

    /// The TTS request for one item under the current voice settings.
    pub fn tts_request(&self, text: &str) -> TtsRequest {
        TtsRequest {
            text: text.to_string(),
            voice: self.voice.clone(),
            rate: self.speaking_rate,
            pitch: self.pitch,
            output_format: OUTPUT_FORMAT.to_string(),
        }
    }

    /// Environment variables win over values stored in the app.
    pub fn credentials(&self, env: &EnvCredentials) -> Option<AzureCredentials> {
        let key = env.key.clone().or_else(|| non_empty(&self.azure_key))?;
        let region = env
            .region
            .clone()
            .or_else(|| non_empty(&self.azure_region))?;
        Some(AzureCredentials { key, region })
    }
}

/// Credentials from `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`, read once at startup.
#[derive(Debug, Clone, Default)]
pub struct EnvCredentials {
    key: Option<String>,
    region: Option<String>,
}

impl EnvCredentials {
    /// Blank values count as unset.
    pub fn new(key: Option<String>, region: Option<String>) -> Self {
        Self {
            key: key.as_deref().and_then(non_empty),
            region: region.as_deref().and_then(non_empty),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The stored settings plus where the credentials come from, for the settings screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDetail {
    pub settings: Settings,
    pub key_from_env: bool,
    pub region_from_env: bool,
    pub credentials_configured: bool,
}

impl SettingsDetail {
    pub fn new(settings: Settings, env: &EnvCredentials) -> Self {
        Self {
            key_from_env: env.key.is_some(),
            region_from_env: env.region.is_some(),
            credentials_configured: settings.credentials(env).is_some(),
            settings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_takes_precedence_over_stored_values() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            azure_region: "westus".into(),
            ..Settings::default()
        };
        let env = EnvCredentials::new(Some("env-key".into()), None);
        let credentials = settings.credentials(&env).unwrap();
        assert_eq!(credentials.key, "env-key");
        assert_eq!(credentials.region, "westus");
    }

    #[test]
    fn missing_credentials_resolve_to_none() {
        let settings = Settings::default();
        assert!(settings.credentials(&EnvCredentials::default()).is_none());
        let blank = EnvCredentials::new(Some("   ".into()), Some("   ".into()));
        assert!(settings.credentials(&blank).is_none());
    }

    #[test]
    fn detail_reports_where_credentials_come_from() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            ..Settings::default()
        };
        let detail =
            SettingsDetail::new(settings, &EnvCredentials::new(None, Some("eastus".into())));
        assert!(!detail.key_from_env);
        assert!(detail.region_from_env);
        assert!(detail.credentials_configured);
    }

    #[test]
    fn sanitize_clamps_values() {
        let settings = Settings {
            voice: "  ".into(),
            speaking_rate: 500,
            pitch: -500,
            azure_region: " EastUS ".into(),
            playback_speed: 3.0,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.voice, "en-US-JennyNeural");
        assert_eq!(settings.speaking_rate, 100);
        assert_eq!(settings.pitch, -50);
        assert_eq!(settings.azure_region, "eastus");
        assert_eq!(settings.playback_speed, 1.0);
    }

    #[test]
    fn missing_fields_use_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"voice":"en-GB-SoniaNeural"}"#).unwrap();
        assert_eq!(settings.voice, "en-GB-SoniaNeural");
        assert_eq!(settings.playback_speed, 1.0);
    }
}
