//! User settings: TTS provider and voice, player preferences and credentials.

pub mod repository;
pub mod service;

use serde::{Deserialize, Serialize};

use crate::tts::azure::AzureCredentials;
use crate::tts::gemini;
use crate::tts::{TtsProviderKind, TtsRequest};

/// Output formats. Fixed for the MVP, but still part of the cache key.
const AZURE_OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
const ELEVENLABS_OUTPUT_FORMAT: &str = "mp3_44100_128";

/// Speeds the player offers; any other stored value falls back to 1.0.
pub const PLAYBACK_SPEEDS: [f64; 9] = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

const DEFAULT_AZURE_VOICE: &str = "en-US-JennyNeural";
/// "George", one of the default voices every ElevenLabs account has.
const DEFAULT_ELEVENLABS_VOICE: &str = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_ELEVENLABS_MODEL: &str = "eleven_multilingual_v2";
const DEFAULT_GEMINI_VOICE: &str = "Kore";
/// The higher-quality Gemini model, for its handling of difficult pronunciation.
const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash-tts";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Which service generates new audio.
    pub tts_provider: TtsProviderKind,
    /// Azure neural voice name, e.g. `en-US-JennyNeural`.
    // Stored as `voice` before ElevenLabs was supported.
    #[serde(alias = "voice")]
    pub azure_voice: String,
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
    /// Gemini voice name, e.g. `Kore`.
    pub gemini_voice: String,
    /// Gemini model ID, e.g. `gemini-3.8-flash-tts`.
    pub gemini_model: String,
    /// Gemini API key stored in-app; `GEMINI_API_KEY` takes precedence.
    pub gemini_key: String,
    /// What Settings' voice list is narrowed to.
    pub gemini_voice_filter: GeminiVoiceFilter,
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
            azure_region: String::new(),
            azure_key: String::new(),
            elevenlabs_voice_id: DEFAULT_ELEVENLABS_VOICE.to_string(),
            elevenlabs_model: DEFAULT_ELEVENLABS_MODEL.to_string(),
            elevenlabs_key: String::new(),
            gemini_voice: DEFAULT_GEMINI_VOICE.to_string(),
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            gemini_key: String::new(),
            gemini_voice_filter: GeminiVoiceFilter::default(),
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
        self.gemini_voice = trimmed_or(&self.gemini_voice, DEFAULT_GEMINI_VOICE);
        self.gemini_model = trimmed_or(&self.gemini_model, DEFAULT_GEMINI_MODEL);
        self.azure_region = self.azure_region.trim().to_lowercase();
        self.azure_key = self.azure_key.trim().to_string();
        self.elevenlabs_key = self.elevenlabs_key.trim().to_string();
        self.gemini_key = self.gemini_key.trim().to_string();
        let is_offered_speed = PLAYBACK_SPEEDS
            .iter()
            .any(|speed| (speed - self.playback_speed).abs() < 1e-6);
        if !is_offered_speed {
            self.playback_speed = 1.0;
        }
        self
    }

    /// The voice section of a lesson export. Imports ignore it, but older
    /// versions of the app refuse a manifest naming a provider they do not
    /// know, so Gemini is recorded as Azure, which they all accept.
    pub fn voice(&self) -> VoiceSettings {
        let tts_provider = match self.tts_provider {
            TtsProviderKind::Gemini => TtsProviderKind::Azure,
            provider => provider,
        };
        VoiceSettings {
            tts_provider,
            azure_voice: self.azure_voice.clone(),
            elevenlabs_voice_id: self.elevenlabs_voice_id.clone(),
            elevenlabs_model: self.elevenlabs_model.clone(),
            speaking_rate: 0,
            pitch: 0,
        }
    }

    /// The TTS request for one item under the current provider and voice settings.
    pub fn tts_request(&self, text: &str) -> TtsRequest {
        let (voice, model, output_format) = match self.tts_provider {
            TtsProviderKind::Azure => (&self.azure_voice, "", AZURE_OUTPUT_FORMAT),
            TtsProviderKind::ElevenLabs => (
                &self.elevenlabs_voice_id,
                self.elevenlabs_model.as_str(),
                ELEVENLABS_OUTPUT_FORMAT,
            ),
            TtsProviderKind::Gemini => (
                &self.gemini_voice,
                self.gemini_model.as_str(),
                gemini::OUTPUT_FORMAT,
            ),
        };
        TtsRequest {
            provider: self.tts_provider,
            text: text.to_string(),
            voice: voice.clone(),
            model: model.to_string(),
            output_format: output_format.to_string(),
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

    /// `GEMINI_API_KEY` wins over the key stored in the app.
    pub fn gemini_key(&self, env: &EnvCredentials) -> Option<String> {
        env.gemini_key
            .clone()
            .or_else(|| non_empty(&self.gemini_key))
    }
}

/// Values from Google's voice list, or blank for any. The Settings screen
/// works out what they match, since only it holds the list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GeminiVoiceFilter {
    pub language: String,
    pub accent: String,
    pub gender: String,
}

/// The voice settings an export carries, for older versions of the app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettings {
    pub tts_provider: TtsProviderKind,
    pub azure_voice: String,
    pub elevenlabs_voice_id: String,
    pub elevenlabs_model: String,
    /// Always 0 now that speech is at normal speed and pitch; older versions
    /// of the app still expect these in an export.
    pub speaking_rate: i32,
    pub pitch: i32,
}

/// Credentials from environment variables, read once at startup. They take
/// precedence over credentials stored in Settings.
#[derive(Debug, Clone, Default)]
pub struct EnvCredentials {
    azure_key: Option<String>,
    azure_region: Option<String>,
    elevenlabs_key: Option<String>,
    gemini_key: Option<String>,
}

impl EnvCredentials {
    /// `read_var` gives the value of an environment variable. Blank values
    /// count as unset.
    pub fn new(read_var: impl Fn(&str) -> Option<String>) -> Self {
        let read = |name: &str| read_var(name).as_deref().and_then(non_empty);
        Self {
            azure_key: read("AZURE_SPEECH_KEY"),
            azure_region: read("AZURE_SPEECH_REGION"),
            elevenlabs_key: read("ELEVENLABS_API_KEY"),
            gemini_key: read("GEMINI_API_KEY"),
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
    pub gemini_key_from_env: bool,
    pub azure_configured: bool,
    pub elevenlabs_configured: bool,
    pub gemini_configured: bool,
    /// Whether the selected provider can generate audio.
    pub credentials_configured: bool,
}

impl SettingsDetail {
    pub fn new(settings: Settings, env: &EnvCredentials) -> Self {
        let azure_configured = settings.azure_credentials(env).is_some();
        let elevenlabs_configured = settings.elevenlabs_key(env).is_some();
        let gemini_configured = settings.gemini_key(env).is_some();
        Self {
            azure_key_from_env: env.azure_key.is_some(),
            azure_region_from_env: env.azure_region.is_some(),
            elevenlabs_key_from_env: env.elevenlabs_key.is_some(),
            gemini_key_from_env: env.gemini_key.is_some(),
            azure_configured,
            elevenlabs_configured,
            gemini_configured,
            credentials_configured: match settings.tts_provider {
                TtsProviderKind::Azure => azure_configured,
                TtsProviderKind::ElevenLabs => elevenlabs_configured,
                TtsProviderKind::Gemini => gemini_configured,
            },
            settings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(variables: &[(&str, &str)]) -> EnvCredentials {
        EnvCredentials::new(|name| {
            variables
                .iter()
                .find(|(variable, _)| *variable == name)
                .map(|(_, value)| value.to_string())
        })
    }

    #[test]
    fn env_takes_precedence_over_stored_values() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            azure_region: "westus".into(),
            elevenlabs_key: "stored-eleven".into(),
            gemini_key: "stored-gemini".into(),
            ..Settings::default()
        };
        let env = env(&[
            ("AZURE_SPEECH_KEY", "env-key"),
            ("ELEVENLABS_API_KEY", "env-eleven"),
            ("GEMINI_API_KEY", "env-gemini"),
        ]);
        let credentials = settings.azure_credentials(&env).unwrap();
        assert_eq!(credentials.key, "env-key");
        assert_eq!(credentials.region, "westus");
        assert_eq!(settings.elevenlabs_key(&env).as_deref(), Some("env-eleven"));
        assert_eq!(settings.gemini_key(&env).as_deref(), Some("env-gemini"));
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
        assert!(settings.gemini_key(&EnvCredentials::default()).is_none());
        let blank = env(&[
            ("AZURE_SPEECH_KEY", "   "),
            ("AZURE_SPEECH_REGION", "   "),
            ("ELEVENLABS_API_KEY", "   "),
            ("GEMINI_API_KEY", "   "),
        ]);
        assert!(settings.azure_credentials(&blank).is_none());
        assert!(settings.elevenlabs_key(&blank).is_none());
        assert!(settings.gemini_key(&blank).is_none());
    }

    #[test]
    fn detail_reports_where_credentials_come_from() {
        let settings = Settings {
            azure_key: "stored-key".into(),
            ..Settings::default()
        };
        let env = env(&[("AZURE_SPEECH_REGION", "eastus"), ("GEMINI_API_KEY", "k")]);
        let detail = SettingsDetail::new(settings, &env);
        assert!(!detail.azure_key_from_env);
        assert!(detail.azure_region_from_env);
        assert!(detail.azure_configured);
        assert!(!detail.elevenlabs_configured);
        assert!(detail.gemini_key_from_env);
        assert!(detail.gemini_configured);
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
            azure_region: " EastUS ".into(),
            playback_speed: 3.0,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.azure_voice, "en-US-JennyNeural");
        assert_eq!(settings.elevenlabs_voice_id, DEFAULT_ELEVENLABS_VOICE);
        assert_eq!(settings.azure_region, "eastus");
        assert_eq!(settings.playback_speed, 1.0);
    }

    #[test]
    fn elevenlabs_request_uses_its_voice_and_model() {
        let settings = Settings {
            tts_provider: TtsProviderKind::ElevenLabs,
            elevenlabs_voice_id: "abc123".into(),
            elevenlabs_model: "eleven_flash_v2_5".into(),
            ..Settings::default()
        };
        let request = settings.tts_request("Hello.");
        assert_eq!(request.provider, TtsProviderKind::ElevenLabs);
        assert_eq!(request.voice, "abc123");
        assert_eq!(request.model, "eleven_flash_v2_5");
    }

    #[test]
    fn gemini_request_uses_its_voice_model_and_the_mp3_it_makes() {
        let settings = Settings {
            tts_provider: TtsProviderKind::Gemini,
            gemini_voice: "Puck".into(),
            gemini_model: "gemini-3.8-flash-lite-tts".into(),
            ..Settings::default()
        };
        let request = settings.tts_request("Hello.");
        assert_eq!(request.provider, TtsProviderKind::Gemini);
        assert_eq!(request.voice, "Puck");
        assert_eq!(request.model, "gemini-3.8-flash-lite-tts");
        assert_eq!(request.output_format, gemini::OUTPUT_FORMAT);
    }

    #[test]
    fn blank_gemini_settings_fall_back_to_the_defaults() {
        let settings = Settings {
            gemini_voice: " ".into(),
            gemini_model: "".into(),
            gemini_key: "  key ".into(),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.gemini_voice, DEFAULT_GEMINI_VOICE);
        assert_eq!(settings.gemini_model, DEFAULT_GEMINI_MODEL);
        assert_eq!(settings.gemini_key, "key");
    }

    /// The providers the app knew before Gemini; anything else makes those
    /// versions call the whole export damaged.
    #[test]
    fn exports_made_with_gemini_name_a_provider_older_versions_accept() {
        let settings = Settings {
            tts_provider: TtsProviderKind::Gemini,
            ..Settings::default()
        };
        let exported = serde_json::to_value(settings.voice()).unwrap();
        assert_eq!(exported["ttsProvider"], "azure");

        let elevenlabs = Settings {
            tts_provider: TtsProviderKind::ElevenLabs,
            ..Settings::default()
        };
        assert_eq!(elevenlabs.voice().tts_provider, TtsProviderKind::ElevenLabs);
    }

    #[test]
    fn settings_saved_by_older_versions_still_load() {
        // Before ElevenLabs support, and with the speaking rate and pitch
        // that could be set back then.
        let settings: Settings =
            serde_json::from_str(r#"{"voice":"en-GB-SoniaNeural","speakingRate":10,"pitch":-5}"#)
                .unwrap();
        assert_eq!(settings.tts_provider, TtsProviderKind::Azure);
        assert_eq!(settings.azure_voice, "en-GB-SoniaNeural");
        assert_eq!(settings.elevenlabs_model, DEFAULT_ELEVENLABS_MODEL);
        assert_eq!(settings.gemini_voice, DEFAULT_GEMINI_VOICE);
        assert_eq!(settings.gemini_voice_filter, GeminiVoiceFilter::default());
        assert_eq!(settings.playback_speed, 1.0);
    }

    #[test]
    fn settings_saved_before_the_voice_filter_keep_everything_else() {
        let settings: Settings = serde_json::from_str(
            r#"{"ttsProvider":"gemini","geminiVoice":"en-gb-concierge-2","geminiKey":"key"}"#,
        )
        .unwrap();
        assert_eq!(settings.gemini_voice, "en-gb-concierge-2");
        assert_eq!(settings.gemini_key, "key");
        assert_eq!(settings.gemini_voice_filter, GeminiVoiceFilter::default());
    }
}
