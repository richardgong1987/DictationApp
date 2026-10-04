//! User settings: TTS provider and voice, player preferences and credentials.

pub mod repository;
pub mod service;

use serde::{Deserialize, Serialize};

use crate::tts::azure::AzureCredentials;
use crate::tts::{TtsProviderKind, TtsRequest};

/// Output formats. Fixed for the MVP, but still part of the cache key.
const AZURE_OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
const ELEVENLABS_OUTPUT_FORMAT: &str = "mp3_44100_128";

/// Speeds the player offers; any other stored value falls back to 1.0.
pub const PLAYBACK_SPEEDS: [f64; 6] = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25];

const DEFAULT_AZURE_VOICE: &str = "en-US-JennyNeural";
/// "George", one of the default voices every ElevenLabs account has.
const DEFAULT_ELEVENLABS_VOICE: &str = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_ELEVENLABS_MODEL: &str = "eleven_multilingual_v2";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Which service generates new audio.
    pub tts_provider: TtsProviderKind,
    /// Azure neural voice name, e.g. `en-US-JennyNeural`.
    // Stored as `voice` before ElevenLabs was supported.
    #[serde(alias = "voice")]
    pub azure_voice: String,
    /// TTS speaking rate adjustment in percent (0 = normal), within
    /// [`TtsProviderKind::speaking_rate_range`] of the selected provider.
    pub speaking_rate: i32,
    /// TTS pitch adjustment in percent, -50..=50 (0 = normal). Azure only.
    pub pitch: i32,
    /// Azure region stored in-app; `AZURE_SPEECH_REGION` takes precedence.
    pub azure_region: String,
    /// Azure key stored in-app; `AZURE_SPEECH_KEY` takes precedence.
    pub azure_key: String,
    /// ElevenLabs voice ID, e.g. `JBFqnCBsd6RMkjVDRZzb`.
    pub elevenlabs_voice_id: String,
    /// ElevenLabs model ID, e.g. `eleven_multilingual_v2`.
    pub elevenlabs_model: String,
    /// ElevenLabs API key stored in-app; `ELEVENLABS_API_KEY` takes precedence.
    pub elevenlabs_key: String,
    /// Last used player speed, one of [`PLAYBACK_SPEEDS`].
    pub playback_speed: f64,
    /// Last used loop state.
    pub loop_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            tts_provider: TtsProviderKind::default(),
            azure_voice: DEFAULT_AZURE_VOICE.to_string(),
            speaking_rate: 0,
            pitch: 0,
            azure_region: String::new(),
            azure_key: String::new(),
            elevenlabs_voice_id: DEFAULT_ELEVENLABS_VOICE.to_string(),
            elevenlabs_model: DEFAULT_ELEVENLABS_MODEL.to_string(),
            elevenlabs_key: String::new(),
            playback_speed: 1.0,
            loop_enabled: false,
        }
    }
}

impl Settings {
    /// Clamps values into supported ranges and trims text fields.
    pub fn sanitized(mut self) -> Self {
        self.azure_voice = trimmed_or(&self.azure_voice, DEFAULT_AZURE_VOICE);
        self.elevenlabs_voice_id = trimmed_or(&self.elevenlabs_voice_id, DEFAULT_ELEVENLABS_VOICE);
        self.elevenlabs_model = trimmed_or(&self.elevenlabs_model, DEFAULT_ELEVENLABS_MODEL);
        let rate_range = self.tts_provider.speaking_rate_range();
        self.speaking_rate = self
            .speaking_rate
            .clamp(*rate_range.start(), *rate_range.end());
        self.pitch = self.pitch.clamp(-50, 50);
        self.azure_region = self.azure_region.trim().to_lowercase();
        self.azure_key = self.azure_key.trim().to_string();
        self.elevenlabs_key = self.elevenlabs_key.trim().to_string();
        let is_offered_speed = PLAYBACK_SPEEDS
            .iter()
            .any(|speed| (speed - self.playback_speed).abs() < 1e-6);
        if !is_offered_speed {
            self.playback_speed = 1.0;
        }
        self
    }

    pub fn voice(&self) -> VoiceSettings {
        VoiceSettings {
            tts_provider: self.tts_provider,
            azure_voice: self.azure_voice.clone(),
            elevenlabs_voice_id: self.elevenlabs_voice_id.clone(),
            elevenlabs_model: self.elevenlabs_model.clone(),
            speaking_rate: self.speaking_rate,
            pitch: self.pitch,
        }
    }

    /// The TTS request for one item under the current provider and voice settings.
    pub fn tts_request(&self, text: &str) -> TtsRequest {
        match self.tts_provider {
            TtsProviderKind::Azure => TtsRequest {
                provider: TtsProviderKind::Azure,
                text: text.to_string(),
                voice: self.azure_voice.clone(),
                model: String::new(),
                rate: self.speaking_rate,
                pitch: self.pitch,
                output_format: AZURE_OUTPUT_FORMAT.to_string(),
            },
            TtsProviderKind::ElevenLabs => TtsRequest {
                provider: TtsProviderKind::ElevenLabs,
                text: text.to_string(),
                voice: self.elevenlabs_voice_id.clone(),
                model: self.elevenlabs_model.clone(),
                rate: self.speaking_rate,
                pitch: 0,
                output_format: ELEVENLABS_OUTPUT_FORMAT.to_string(),
            },
        }
    }

    /// Environment variables win over values stored in the app.
    pub fn azure_credentials(&self, env: &EnvCredentials) -> Option<AzureCredentials> {
        let key = env
            .azure_key
            .clone()
            .or_else(|| non_empty(&self.azure_key))?;
        let region = env
            .azure_region
            .clone()
            .or_else(|| non_empty(&self.azure_region))?;
        Some(AzureCredentials { key, region })
    }

    /// `ELEVENLABS_API_KEY` wins over the key stored in the app.
    pub fn elevenlabs_key(&self, env: &EnvCredentials) -> Option<String> {
        env.elevenlabs_key
            .clone()
            .or_else(|| non_empty(&self.elevenlabs_key))
    }
}

/// The settings that decide how generated audio sounds, and so its cache key.
/// Field names match [`Settings`], so the frontend can apply them to it as they are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettings {
    pub tts_provider: TtsProviderKind,
    pub azure_voice: String,
    pub elevenlabs_voice_id: String,
    pub elevenlabs_model: String,
    pub speaking_rate: i32,
    pub pitch: i32,
}

/// Credentials from `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` and
/// `ELEVENLABS_API_KEY`, read once at startup.
#[derive(Debug, Clone, Default)]
pub struct EnvCredentials {
    azure_key: Option<String>,
    azure_region: Option<String>,
    elevenlabs_key: Option<String>,
}

impl EnvCredentials {
    /// Blank values count as unset.
    pub fn new(
        azure_key: Option<String>,
        azure_region: Option<String>,
        elevenlabs_key: Option<String>,
    ) -> Self {
        Self {
            azure_key: azure_key.as_deref().and_then(non_empty),
            azure_region: azure_region.as_deref().and_then(non_empty),
            elevenlabs_key: elevenlabs_key.as_deref().and_then(non_empty),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn trimmed_or(value: &str, default: &str) -> String {
    non_empty(value).unwrap_or_else(|| default.to_string())
}

/// The stored settings plus where the credentials come from, for the settings screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDetail {
    pub settings: Settings,
    pub azure_key_from_env: bool,
    pub azure_region_from_env: bool,
    pub elevenlabs_key_from_env: bool,
    pub azure_configured: bool,
    pub elevenlabs_configured: bool,
    /// Whether the selected provider can generate audio.
    pub credentials_configured: bool,
}

impl SettingsDetail {
    pub fn new(settings: Settings, env: &EnvCredentials) -> Self {
        let azure_configured = settings.azure_credentials(env).is_some();
        let elevenlabs_configured = settings.elevenlabs_key(env).is_some();
        Self {
            azure_key_from_env: env.azure_key.is_some(),
            azure_region_from_env: env.azure_region.is_some(),
            elevenlabs_key_from_env: env.elevenlabs_key.is_some(),
            azure_configured,
            elevenlabs_configured,
            credentials_configured: match settings.tts_provider {
                TtsProviderKind::Azure => azure_configured,
                TtsProviderKind::ElevenLabs => elevenlabs_configured,
            },
            settings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(
        azure_key: Option<&str>,
        azure_region: Option<&str>,
        elevenlabs_key: Option<&str>,
    ) -> EnvCredentials {
        EnvCredentials::new(
            azure_key.map(Into::into),
            azure_region.map(Into::into),
            elevenlabs_key.map(Into::into),
        )
    }

    #[test]
    fn env_takes_precedence_over_stored_values() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            azure_region: "westus".into(),
            elevenlabs_key: "stored-eleven".into(),
            ..Settings::default()
        };
        let env = env(Some("env-key"), None, Some("env-eleven"));
        let credentials = settings.azure_credentials(&env).unwrap();
        assert_eq!(credentials.key, "env-key");
        assert_eq!(credentials.region, "westus");
        assert_eq!(settings.elevenlabs_key(&env).as_deref(), Some("env-eleven"));
    }

    #[test]
    fn missing_credentials_resolve_to_none() {
        let settings = Settings::default();
        assert!(settings
            .azure_credentials(&EnvCredentials::default())
            .is_none());
        assert!(settings
            .elevenlabs_key(&EnvCredentials::default())
            .is_none());
        let blank = env(Some("   "), Some("   "), Some("   "));
        assert!(settings.azure_credentials(&blank).is_none());
        assert!(settings.elevenlabs_key(&blank).is_none());
    }

    #[test]
    fn detail_reports_where_credentials_come_from() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            ..Settings::default()
        };
        let detail = SettingsDetail::new(settings, &env(None, Some("eastus"), None));
        assert!(!detail.azure_key_from_env);
        assert!(detail.azure_region_from_env);
        assert!(detail.azure_configured);
        assert!(!detail.elevenlabs_configured);
        assert!(detail.credentials_configured);
    }

    #[test]
    fn credentials_configured_follows_the_selected_provider() {
        let settings = Settings {
            tts_provider: TtsProviderKind::ElevenLabs,
            azure_key: "stored-key".into(),
            azure_region: "eastus".into(),
            ..Settings::default()
        };
        let detail = SettingsDetail::new(settings, &EnvCredentials::default());
        assert!(detail.azure_configured);
        assert!(!detail.credentials_configured);
    }

    #[test]
    fn sanitize_clamps_values() {
        let settings = Settings {
            azure_voice: "  ".into(),
            elevenlabs_voice_id: " ".into(),
            speaking_rate: 500,
            pitch: -500,
            azure_region: " EastUS ".into(),
            playback_speed: 3.0,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.azure_voice, "en-US-JennyNeural");
        assert_eq!(settings.elevenlabs_voice_id, DEFAULT_ELEVENLABS_VOICE);
        assert_eq!(settings.speaking_rate, 100);
        assert_eq!(settings.pitch, -50);
        assert_eq!(settings.azure_region, "eastus");
        assert_eq!(settings.playback_speed, 1.0);
    }

    #[test]
    fn elevenlabs_speaking_rate_is_clamped_to_its_speed_range() {
        let settings = |speaking_rate| {
            Settings {
                tts_provider: TtsProviderKind::ElevenLabs,
                speaking_rate,
                ..Settings::default()
            }
            .sanitized()
        };
        assert_eq!(settings(50).speaking_rate, 20);
        assert_eq!(settings(-50).speaking_rate, -30);
    }

    #[test]
    fn elevenlabs_request_uses_its_voice_and_model_and_ignores_pitch() {
        let settings = Settings {
            tts_provider: TtsProviderKind::ElevenLabs,
            elevenlabs_voice_id: "abc123".into(),
            elevenlabs_model: "eleven_flash_v2_5".into(),
            speaking_rate: 10,
            pitch: 20,
            ..Settings::default()
        };
        let request = settings.tts_request("Hello.");
        assert_eq!(request.provider, TtsProviderKind::ElevenLabs);
        assert_eq!(request.voice, "abc123");
        assert_eq!(request.model, "eleven_flash_v2_5");
        assert_eq!(request.rate, 10);
        assert_eq!(request.pitch, 0);
    }

    #[test]
    fn settings_saved_before_elevenlabs_support_still_load() {
        let settings: Settings = serde_json::from_str(r#"{"voice":"en-GB-SoniaNeural"}"#).unwrap();
        assert_eq!(settings.tts_provider, TtsProviderKind::Azure);
        assert_eq!(settings.azure_voice, "en-GB-SoniaNeural");
        assert_eq!(settings.elevenlabs_model, DEFAULT_ELEVENLABS_MODEL);
        assert_eq!(settings.playback_speed, 1.0);
    }
}
