//! ElevenLabs text-to-speech over the REST API.

use reqwest::StatusCode;
use serde_json::{json, Value};

use crate::tts::http::fetch_audio;
use crate::tts::{TtsError, TtsProvider, TtsProviderKind, TtsRequest};

const ENDPOINT: &str = "https://api.elevenlabs.io/v1/text-to-speech";

pub struct ElevenLabsTts {
    client: reqwest::Client,
    api_key: String,
}

impl ElevenLabsTts {
    pub fn new(client: reqwest::Client, api_key: String) -> Self {
        Self { client, api_key }
    }
}

impl TtsProvider for ElevenLabsTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        // The voice ID becomes part of the URL path, so anything unusual is refused.
        if !is_valid_voice_id(&request.voice) {
            return Err(TtsError::InvalidVoiceId(request.voice.clone()));
        }
        let url = format!(
            "{ENDPOINT}/{}?output_format={}",
            request.voice, request.output_format
        );
        let body = request_body(request).to_string();
        let build = || {
            self.client
                .post(&url)
                .header("xi-api-key", &self.api_key)
                .header("Content-Type", "application/json")
                .header("Accept", "audio/mpeg")
                .header("User-Agent", "DictationApp")
                .body(body.clone())
        };
        fetch_audio(TtsProviderKind::ElevenLabs, build, describe_error).await
    }
}

/// `voice_settings` is left out, so the voice speaks with the settings saved
/// with it in ElevenLabs.
fn request_body(request: &TtsRequest) -> Value {
    json!({ "text": request.text, "model_id": request.model })
}

/// ElevenLabs voice IDs are letters and digits, e.g. `JBFqnCBsd6RMkjVDRZzb`.
fn is_valid_voice_id(voice_id: &str) -> bool {
    !voice_id.is_empty() && voice_id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// ElevenLabs explains most errors in `{"detail": {"message": ...}}`. A used-up
/// quota can arrive as 401 too, so its own message beats "check the key".
fn describe_error(status: StatusCode, body: &str) -> Option<String> {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|json| json["detail"]["message"].as_str().map(str::to_string));
    message.or_else(|| match status {
        StatusCode::UNAUTHORIZED => Some("unauthorized - check the ElevenLabs API key".to_string()),
        StatusCode::TOO_MANY_REQUESTS => {
            Some("too many requests - ElevenLabs rate limit reached".to_string())
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_carries_text_and_model_and_leaves_speed_to_the_voice() {
        let body = request_body(&TtsRequest {
            provider: TtsProviderKind::ElevenLabs,
            text: "Tom & Jerry \"said\"".into(),
            voice: "JBFqnCBsd6RMkjVDRZzb".into(),
            model: "eleven_multilingual_v2".into(),
            output_format: "mp3_44100_128".into(),
        });
        assert_eq!(body["text"], "Tom & Jerry \"said\"");
        assert_eq!(body["model_id"], "eleven_multilingual_v2");
        assert!(body.get("voice_settings").is_none());
    }

    #[test]
    fn rejects_voice_ids_that_could_change_the_url() {
        assert!(is_valid_voice_id("JBFqnCBsd6RMkjVDRZzb"));
        assert!(!is_valid_voice_id("../../v1/user"));
        assert!(!is_valid_voice_id("George Brown"));
        assert!(!is_valid_voice_id(""));
    }

    #[test]
    fn error_message_prefers_what_elevenlabs_says() {
        let quota = r#"{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota."}}"#;
        assert_eq!(
            describe_error(StatusCode::UNAUTHORIZED, quota).as_deref(),
            Some("This request exceeds your quota.")
        );
        assert_eq!(
            describe_error(StatusCode::UNAUTHORIZED, "").as_deref(),
            Some("unauthorized - check the ElevenLabs API key")
        );
        assert_eq!(describe_error(StatusCode::BAD_REQUEST, "oops"), None);
    }
}
