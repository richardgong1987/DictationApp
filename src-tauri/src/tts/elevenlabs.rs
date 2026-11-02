//! ElevenLabs text-to-speech over the REST API.

use std::collections::HashMap;

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::tts::http::{fetch_body, ErrorReading};
use crate::tts::{CatalogVoice, TtsError, TtsProvider, TtsProviderKind, TtsRequest};

const API_BASE: &str = "https://api.elevenlabs.io";
/// The most the voice list returns per page.
const VOICE_PAGE_SIZE: &str = "100";

pub struct ElevenLabsTts {
    client: reqwest::Client,
    api_key: String,
    api_base: String,
}

impl ElevenLabsTts {
    pub fn new(client: reqwest::Client, api_key: String) -> Self {
        Self {
            client,
            api_key,
            api_base: API_BASE.to_string(),
        }
    }

    /// The voices of this key's account: ElevenLabs' default voices and any
    /// added from its Voice Library. Library voices work through the API only
    /// once added, so these are exactly the voices a request can use.
    pub async fn list_voices(&self) -> Result<Vec<CatalogVoice>, TtsError> {
        let url = format!("{}/v2/voices", self.api_base);
        let mut voices = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let build = || {
                let mut query = vec![
                    ("page_size", VOICE_PAGE_SIZE),
                    ("include_total_count", "false"),
                ];
                if let Some(token) = &page_token {
                    query.push(("next_page_token", token.as_str()));
                }
                self.client
                    .get(&url)
                    .query(&query)
                    .header("xi-api-key", &self.api_key)
                    .header("User-Agent", "DictationApp")
            };
            let body = fetch_body(TtsProviderKind::ElevenLabs, build, read_error).await?;
            let page: VoicePage = serde_json::from_slice(&body)
                .map_err(|_| TtsError::UnreadableResponse(TtsProviderKind::ElevenLabs))?;
            voices.extend(
                page.voices
                    .into_iter()
                    .filter(|voice| is_valid_voice_id(&voice.voice_id))
                    .map(CatalogVoice::from),
            );
            match page
                .next_page_token
                .filter(|token| page.has_more && !token.is_empty())
            {
                Some(token) => page_token = Some(token),
                None => return Ok(voices),
            }
        }
    }
}

/// Downloads a voice's sample from the address its listing gave. The API key
/// is not sent: the sample is public, and the address need not be ElevenLabs'.
pub async fn download_preview(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, TtsError> {
    if !is_preview_url(url) {
        return Err(TtsError::UnreadableResponse(TtsProviderKind::ElevenLabs));
    }
    fetch_preview(client, url).await
}

async fn fetch_preview(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, TtsError> {
    let build = || client.get(url).header("User-Agent", "DictationApp");
    fetch_body(TtsProviderKind::ElevenLabs, build, read_error).await
}

/// Only an encrypted web address; nothing local, and no other scheme.
fn is_preview_url(url: &str) -> bool {
    url.strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
}

#[derive(Deserialize)]
struct VoicePage {
    #[serde(default)]
    voices: Vec<ElevenLabsVoice>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    next_page_token: Option<String>,
}

/// One voice of `GET /v2/voices`, with the fields Settings shows.
#[derive(Deserialize)]
struct ElevenLabsVoice {
    #[serde(default)]
    voice_id: String,
    #[serde(default)]
    name: Option<String>,
    /// Its owner's own words, when there are any.
    #[serde(default)]
    description: Option<String>,
    /// A recording of the voice that ElevenLabs keeps for listening to it.
    #[serde(default)]
    preview_url: Option<String>,
    /// Such as `accent`, `gender`, `age`, `description` and `use_case`.
    #[serde(default)]
    labels: HashMap<String, String>,
    #[serde(default)]
    verified_languages: Vec<VerifiedLanguage>,
}

#[derive(Deserialize)]
struct VerifiedLanguage {
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    accent: Option<String>,
}

impl From<ElevenLabsVoice> for CatalogVoice {
    fn from(voice: ElevenLabsVoice) -> Self {
        let label = |key: &str| {
            voice
                .labels
                .get(key)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
        };
        let first_verified = voice.verified_languages.first();
        let language = label("language")
            .map(str::to_string)
            .or_else(|| first_verified.and_then(|v| v.language.clone()));
        let accent = label("accent")
            .map(str::to_string)
            .or_else(|| first_verified.and_then(|v| v.accent.clone()));
        let description = voice
            .description
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .or_else(|| describe_labels(&[label("age"), label("description"), label("use_case")]));
        Self {
            id: voice.voice_id,
            display_name: voice.name,
            language_code: language,
            // Labels are typed by voice owners, as "American" or "american", "Female" or "female";
            // one spelling each keeps a filter from listing the same choice twice.
            accent: accent.map(|accent| title_case(&accent)),
            gender: label("gender").map(str::to_lowercase),
            pitch: None,
            description,
            preview_url: voice.preview_url.filter(|url| is_preview_url(url)),
        }
    }
}

/// "middle_aged", "warm", "narration" -> "Middle aged, warm, narration."
fn describe_labels(labels: &[Option<&str>]) -> Option<String> {
    let words: Vec<String> = labels
        .iter()
        .flatten()
        .map(|label| label.replace('_', " ").to_lowercase())
        .collect();
    let mut sentence = words.join(", ");
    let first = sentence.chars().next()?;
    sentence.replace_range(..first.len_utf8(), &first.to_uppercase().to_string());
    Some(sentence + ".")
}

/// "british" or "BRITISH" -> "British"; "new zealand" -> "New Zealand".
fn title_case(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            let mut letters = word.chars();
            letters.next().map_or_else(String::new, |first| {
                first
                    .to_uppercase()
                    .chain(letters.flat_map(char::to_lowercase))
                    .collect()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

impl TtsProvider for ElevenLabsTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        // The voice ID becomes part of the URL path, so anything unusual is refused.
        if !is_valid_voice_id(&request.voice) {
            return Err(TtsError::InvalidVoiceId(request.voice.clone()));
        }
        let url = format!(
            "{}/v1/text-to-speech/{}?output_format={}",
            self.api_base, request.voice, request.output_format
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
        fetch_body(TtsProviderKind::ElevenLabs, build, read_error).await
    }
}

fn read_error(status: StatusCode, body: &str) -> ErrorReading {
    ErrorReading::worded(describe_error(status, body))
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

    use crate::tts::http::test_server::{http_response, serve};

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

    #[tokio::test]
    async fn lists_every_page_of_the_account_voices_with_what_settings_shows() {
        // Shaped like the response schema in ElevenLabs' API reference.
        let first = json!({
            "voices": [{
                "voice_id": "Xb7hH8MSUJpSbSDYk0k2", "name": "Alice", "category": "premade",
                "labels": { "accent": "british", "gender": "Female", "age": "middle_aged",
                            "description": "confident", "use_case": "news" },
                "description": null,
                "verified_languages": [{ "language": "en", "model_id": "eleven_multilingual_v2",
                                         "accent": "british", "locale": "en-GB" }],
            }],
            "has_more": true, "total_count": 3, "next_page_token": "page-2",
        })
        .to_string();
        let second = json!({
            "voices": [
                { "voice_id": "cl0neV0ice1", "name": "My clone", "description": "  Calm reading voice. ",
                  "labels": { "accent": "New Zealand" },
                  "verified_languages": [{ "language": "en", "model_id": "eleven_multilingual_v2" }] },
                { "voice_id": "../v1/user", "name": "Not a voice ID" },
            ],
            "has_more": false, "total_count": 3, "next_page_token": null,
        })
        .to_string();
        let (url, requests) = serve(vec![
            http_response("200 OK", &first),
            http_response("200 OK", &second),
        ]);
        let elevenlabs = ElevenLabsTts {
            client: reqwest::Client::new(),
            api_key: "secret-key".into(),
            api_base: url.trim_end_matches('/').to_string(),
        };

        let voices = elevenlabs.list_voices().await.unwrap();

        let ids: Vec<&str> = voices.iter().map(|voice| voice.id.as_str()).collect();
        assert_eq!(ids, ["Xb7hH8MSUJpSbSDYk0k2", "cl0neV0ice1"]);
        assert_eq!(voices[0].language_code.as_deref(), Some("en"));
        assert_eq!(voices[0].accent.as_deref(), Some("British"));
        assert_eq!(voices[0].gender.as_deref(), Some("female"));
        assert_eq!(
            voices[0].description.as_deref(),
            Some("Middle aged, confident, news.")
        );
        assert_eq!(voices[1].accent.as_deref(), Some("New Zealand"));
        assert_eq!(
            voices[1].description.as_deref(),
            Some("Calm reading voice.")
        );
        let requests = requests.lock().unwrap();
        assert!(requests[0].starts_with("GET /v2/voices?page_size=100"));
        assert!(requests[0]
            .to_lowercase()
            .contains("xi-api-key: secret-key"));
        assert!(requests[1].contains("next_page_token=page-2"));
    }

    #[tokio::test]
    async fn a_sample_is_downloaded_without_the_api_key() {
        let (url, requests) = serve(vec![http_response("200 OK", "mp3 bytes")]);
        let sample = fetch_preview(&reqwest::Client::new(), &format!("{url}sample.mp3"))
            .await
            .unwrap();
        assert_eq!(sample, b"mp3 bytes");
        let request = requests.lock().unwrap()[0].to_lowercase();
        assert!(request.starts_with("get /sample.mp3 "));
        assert!(!request.contains("xi-api-key"));
    }

    #[test]
    fn only_https_addresses_count_as_samples() {
        assert!(is_preview_url(
            "https://storage.googleapis.com/voice/sample.mp3"
        ));
        assert!(!is_preview_url("http://example.com/sample.mp3"));
        assert!(!is_preview_url("file:///etc/passwd"));
        assert!(!is_preview_url("https://"));
        assert!(!is_preview_url("https:///local"));
    }

    #[test]
    fn a_voice_without_labels_has_no_accent_gender_or_description() {
        let voice: ElevenLabsVoice =
            serde_json::from_value(json!({ "voice_id": "abc123" })).unwrap();
        let listed = CatalogVoice::from(voice);
        assert_eq!(
            (listed.accent, listed.gender, listed.description),
            (None, None, None)
        );
    }
}
