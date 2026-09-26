//! Application settings and Azure credential resolution.

use serde::{Deserialize, Serialize};

use crate::tts::{AzureCredentials, TtsRequest};

pub const ENV_SPEECH_KEY: &str = "AZURE_SPEECH_KEY";
pub const ENV_SPEECH_REGION: &str = "AZURE_SPEECH_REGION";

/// Azure output format. Fixed for the MVP, but still part of the cache key.
pub const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

pub const PLAYBACK_SPEEDS: [f64; 6] = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Azure neural voice name, e.g. `en-US-JennyNeural`.
    pub voice: String,
    /// TTS speaking rate adjustment in percent (0 = normal).
    pub speaking_rate: i32,
    /// TTS pitch adjustment in percent (0 = normal).
    pub pitch: i32,
    /// Azure region stored in-app; `AZURE_SPEECH_REGION` takes precedence.
    pub azure_region: String,
    /// Azure key stored in-app; `AZURE_SPEECH_KEY` takes precedence.
    pub azure_key: String,
    /// Last used player speed.
    pub playback_speed: f64,
    /// Last used loop state.
    pub loop_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            voice: "en-US-JennyNeural".to_string(),
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
            self.voice = Settings::default().voice;
        }
        self.speaking_rate = self.speaking_rate.clamp(-50, 100);
        self.pitch = self.pitch.clamp(-50, 50);
        self.azure_region = self.azure_region.trim().to_lowercase();
        self.azure_key = self.azure_key.trim().to_string();
        if !PLAYBACK_SPEEDS
            .iter()
            .any(|s| (s - self.playback_speed).abs() < 1e-6)
        {
            self.playback_speed = 1.0;
        }
        self
    }

    /// Builds the TTS request for one item using the current voice settings.
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
    pub fn resolve_credentials(&self) -> Option<AzureCredentials> {
        resolve_credentials_with(self, |name| std::env::var(name).ok())
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn resolve_credentials_with(
    settings: &Settings,
    env: impl Fn(&str) -> Option<String>,
) -> Option<AzureCredentials> {
    let key =
        non_empty(env(ENV_SPEECH_KEY)).or_else(|| non_empty(Some(settings.azure_key.clone())))?;
    let region = non_empty(env(ENV_SPEECH_REGION))
        .or_else(|| non_empty(Some(settings.azure_region.clone())))?;
    Some(AzureCredentials { key, region })
}

/// What the settings screen needs to know besides the stored values.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub key_from_env: bool,
    pub region_from_env: bool,
    pub credentials_configured: bool,
}

impl SettingsView {
    pub fn new(settings: Settings) -> Self {
        let from_env = |name: &str| non_empty(std::env::var(name).ok()).is_some();
        Self {
            key_from_env: from_env(ENV_SPEECH_KEY),
            region_from_env: from_env(ENV_SPEECH_REGION),
            credentials_configured: settings.resolve_credentials().is_some(),
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
        let creds = resolve_credentials_with(&settings, |name| match name {
            ENV_SPEECH_KEY => Some("env-key".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(creds.key, "env-key");
        assert_eq!(creds.region, "westus");
    }

    #[test]
    fn missing_credentials_resolve_to_none() {
        let settings = Settings::default();
        assert!(resolve_credentials_with(&settings, |_| None).is_none());
        assert!(resolve_credentials_with(&settings, |_| Some("   ".into())).is_none());
    }

    #[test]
    fn sanitize_clamps_values() {
        let s = Settings {
            voice: "  ".into(),
            speaking_rate: 500,
            pitch: -500,
            azure_region: " EastUS ".into(),
            playback_speed: 3.0,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.voice, "en-US-JennyNeural");
        assert_eq!(s.speaking_rate, 100);
        assert_eq!(s.pitch, -50);
        assert_eq!(s.azure_region, "eastus");
        assert_eq!(s.playback_speed, 1.0);
    }

    #[test]
    fn missing_fields_use_defaults() {
        let s: Settings = serde_json::from_str(r#"{"voice":"en-GB-SoniaNeural"}"#).unwrap();
        assert_eq!(s.voice, "en-GB-SoniaNeural");
        assert_eq!(s.playback_speed, 1.0);
    }
}
