//! Gemini text-to-speech over the Interactions REST API.
//!
//! Gemini returns raw PCM inside JSON, and its speech documentation offers no
//! MP3 output, so the audio is encoded here: every clip the app stores,
//! exports and plays is an MP3.

use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::StatusCode;
use rusty_mp3::{Mp3Encoder, Mp3EncoderConfig};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::tts::http::{fetch_body, ErrorReading, RetryAdvice};
use crate::tts::{CatalogVoice, TtsError, TtsProvider, TtsProviderKind, TtsRequest};

pub const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
/// The most the voice list returns per page.
const VOICE_PAGE_SIZE: &str = "1000";

/// Records in the cache key what [`SAMPLE_RATE`] and [`MP3_BITRATE_KBPS`] make.
pub const OUTPUT_FORMAT: &str = "mp3_24000_64";
const SAMPLE_RATE: u32 = 24_000;
/// Measured on speech at 24 kHz: level with LAME at this rate, and pauses stay
/// where they were, which the shadowing screen relies on.
const MP3_BITRATE_KBPS: u32 = 64;
const MONO: u16 = 1;

/// Nothing arrives until the whole clip is made, and timing out would send the
/// request again, so this is far longer than the app's usual timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub struct GeminiTts {
    client: reqwest::Client,
    api_key: String,
    api_base: String,
}

impl GeminiTts {
    pub fn new(client: reqwest::Client, api_key: String, api_base: String) -> Self {
        Self {
            client,
            api_key,
            api_base,
        }
    }

    /// Every voice this key can use: its custom voices, then Google's catalog.
    /// Accents live here, as separate voices, rather than in the request.
    pub async fn list_voices(&self) -> Result<Vec<CatalogVoice>, TtsError> {
        let url = format!("{}/voices", self.api_base);
        let mut voices = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let build = || {
                let mut query = vec![("page_size", VOICE_PAGE_SIZE)];
                if let Some(token) = &page_token {
                    query.push(("page_token", token.as_str()));
                }
                self.client
                    .get(&url)
                    .query(&query)
                    .header("x-goog-api-key", &self.api_key)
                    .header("User-Agent", "DictationApp")
            };
            let body = fetch_body(TtsProviderKind::Gemini, build, read_error).await?;
            let page: VoicePage = serde_json::from_slice(&body)
                .map_err(|_| TtsError::UnreadableResponse(TtsProviderKind::Gemini))?;
            voices.extend(
                page.voices
                    .into_iter()
                    .filter(|voice| !voice.id.is_empty())
                    .map(CatalogVoice::from),
            );
            match page.next_page_token.filter(|token| !token.is_empty()) {
                Some(token) => page_token = Some(token),
                None => return Ok(voices),
            }
        }
    }
}

/// One voice of Google's list. The documentation spells these fields in
/// snake_case, but Google's REST APIs also answer in camelCase, so both are read.
#[derive(Deserialize)]
struct GeminiVoice {
    /// What a request names: a speaker such as `Puck`, or `voice_...`.
    #[serde(default)]
    id: String,
    #[serde(default, alias = "displayName")]
    display_name: Option<String>,
    #[serde(default, alias = "languageCode")]
    language_code: Option<String>,
    #[serde(default)]
    accent: Option<String>,
    #[serde(default)]
    gender: Option<String>,
    #[serde(default)]
    pitch: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

impl From<GeminiVoice> for CatalogVoice {
    fn from(voice: GeminiVoice) -> Self {
        Self {
            id: voice.id,
            display_name: voice.display_name,
            language_code: voice.language_code,
            accent: voice.accent,
            gender: voice.gender,
            pitch: voice.pitch,
            description: voice.description,
            // Google keeps samples only for voices made with Voice design, and leaves them out of the list.
            preview_url: None,
        }
    }
}

#[derive(Deserialize)]
struct VoicePage {
    #[serde(default)]
    voices: Vec<GeminiVoice>,
    #[serde(default, alias = "nextPageToken")]
    next_page_token: Option<String>,
}

impl TtsProvider for GeminiTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        let url = format!("{}/interactions", self.api_base);
        let body = request_body(request).to_string();
        let build = || {
            self.client
                .post(&url)
                .timeout(REQUEST_TIMEOUT)
                .header("x-goog-api-key", &self.api_key)
                .header("Content-Type", "application/json")
                .header("User-Agent", "DictationApp")
                .body(body.clone())
        };
        let response = fetch_body(TtsProviderKind::Gemini, build, read_error).await?;
        encode_mp3(&pcm_from_response(&response)?)
    }
}

/// `store` is off because the API otherwise keeps each passage on Google's
/// servers for later turns, which one-off speech never needs.
fn request_body(request: &TtsRequest) -> Value {
    json!({
        "model": request.model,
        "input": [{
            "type": "user_input",
            "content": [{ "type": "text", "text": request.text }],
        }],
        "response_format": {
            "type": "audio",
            "mime_type": "audio/l16",
            "sample_rate": SAMPLE_RATE,
        },
        "generation_config": { "speech_config": [{ "voice": request.voice }] },
        "store": false,
    })
}

/// The PCM of the last audio block in the model's output, which is the one
/// Google's own SDKs return.
fn pcm_from_response(body: &[u8]) -> Result<Vec<u8>, TtsError> {
    let unreadable = || TtsError::UnreadableResponse(TtsProviderKind::Gemini);
    let response: Value = serde_json::from_slice(body).map_err(|_| unreadable())?;
    let audio_block = json_array(&response["steps"])
        .filter(|step| step["type"] == "model_output")
        .flat_map(|step| json_array(&step["content"]))
        .filter(|block| block["type"] == "audio")
        .last();
    let Some(audio_block) = audio_block else {
        return Err(TtsError::NoAudio {
            provider: TtsProviderKind::Gemini,
            status: response["status"].as_str().unwrap_or("unknown").to_string(),
        });
    };
    let pcm = audio_block["data"]
        .as_str()
        .and_then(|data| BASE64.decode(data).ok())
        .ok_or_else(unreadable)?;
    if pcm.is_empty() {
        return Err(TtsError::EmptyAudio(TtsProviderKind::Gemini));
    }
    Ok(pcm)
}

fn encode_mp3(pcm: &[u8]) -> Result<Vec<u8>, TtsError> {
    let mut encoder = Mp3Encoder::new(Mp3EncoderConfig {
        bitrate_kbps: MP3_BITRATE_KBPS,
        vbr_quality: None,
    });
    encoder
        .push_pcm_s16le(pcm, MONO, SAMPLE_RATE)
        .map_err(|error| TtsError::Mp3Encoding(error.to_string()))?;
    encoder.finish();
    let mut mp3 = Vec::new();
    while let Ok(packet) = encoder.next_packet() {
        mp3.extend_from_slice(&packet);
    }
    Ok(mp3)
}

/// Google explains errors in `{"error": {"message"}}`, which the Interactions
/// endpoint sometimes wraps in a one-element array, and only some carry
/// `details`. A bad API key arrives as 400, so only Google's own wording can
/// identify it.
fn read_error(status: StatusCode, body: &str) -> ErrorReading {
    let response: Value = serde_json::from_str(body).unwrap_or_default();
    let error = if response.is_array() {
        &response[0]["error"]
    } else {
        &response["error"]
    };
    if status == StatusCode::TOO_MANY_REQUESTS && is_daily_quota(error) {
        return ErrorReading {
            message: Some(
                "daily Gemini quota used up - it resets at midnight Pacific time".to_string(),
            ),
            retry: RetryAdvice::QuotaExhausted,
        };
    }
    ErrorReading {
        message: error["message"]
            .as_str()
            .map(str::to_string)
            .or_else(|| describe_status(status)),
        retry: retry_delay(error).map_or(RetryAdvice::ByStatus, RetryAdvice::After),
    }
}

fn describe_status(status: StatusCode) -> Option<String> {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            Some("not allowed - check the Gemini API key".to_string())
        }
        StatusCode::TOO_MANY_REQUESTS => {
            Some("too many requests - Gemini rate limit reached".to_string())
        }
        _ => None,
    }
}

/// A used-up daily quota stays used up for hours, so waiting out the retries
/// would only stall every remaining passage of a lesson. Interactions errors
/// have just a `code` and a `message` ("limit: 100 requests per day"); other
/// endpoints name the limit in `quotaId` or `quotaMetric`. So the whole error
/// is searched rather than one field.
fn is_daily_quota(error: &Value) -> bool {
    let text = error.to_string().to_lowercase();
    ["per day", "perday", "per_day"]
        .iter()
        .any(|marker| text.contains(marker))
}

/// Google names the wait in the body as `"37s"` or `"0.5s"`. On a free tier a
/// per-minute limit is an everyday event, so this matters more than `Retry-After`.
fn retry_delay(error: &Value) -> Option<Duration> {
    json_array(&error["details"]).find_map(|detail| {
        let seconds = detail["retryDelay"].as_str()?.strip_suffix('s')?;
        Duration::try_from_secs_f64(seconds.parse().ok()?).ok()
    })
}

fn json_array(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusty_mp3::{Error, Mp3Decoder};
    use std::sync::{Arc, Mutex};

    use crate::tts::http::test_server::{http_response, serve};

    fn request() -> TtsRequest {
        TtsRequest {
            provider: TtsProviderKind::Gemini,
            text: "Tom & Jerry \"said\"".into(),
            voice: "Kore".into(),
            model: "gemini-3.8-flash-tts".into(),
            output_format: OUTPUT_FORMAT.into(),
        }
    }

    /// One second of a tone, as 16-bit little-endian samples.
    fn tone_pcm() -> Vec<u8> {
        (0..SAMPLE_RATE)
            .map(|i| {
                let seconds = f64::from(i) / f64::from(SAMPLE_RATE);
                (8000.0 * (seconds * 440.0 * std::f64::consts::TAU).sin()) as i16
            })
            .flat_map(i16::to_le_bytes)
            .collect()
    }

    /// A client whose API is a local server giving these responses.
    fn gemini_server(responses: Vec<String>) -> (GeminiTts, Arc<Mutex<Vec<String>>>) {
        let (url, requests) = serve(responses);
        let gemini = GeminiTts {
            client: reqwest::Client::new(),
            api_key: "secret-key".into(),
            api_base: url.trim_end_matches('/').to_string(),
        };
        (gemini, requests)
    }

    fn response_with_audio(pcm: &[u8]) -> Vec<u8> {
        json!({
            "status": "completed",
            "steps": [
                { "type": "model_output", "content": [{ "type": "audio", "data": BASE64.encode(b"old") }] },
                { "type": "model_output", "content": [
                    { "type": "text", "text": "not audio" },
                    { "type": "audio", "data": BASE64.encode(pcm) },
                ] },
            ],
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn body_asks_for_raw_audio_in_the_chosen_voice_and_keeps_nothing_on_the_server() {
        let body = request_body(&request());
        assert_eq!(body["model"], "gemini-3.8-flash-tts");
        assert_eq!(
            body["input"][0]["content"][0]["text"],
            "Tom & Jerry \"said\""
        );
        assert_eq!(body["response_format"]["mime_type"], "audio/l16");
        assert_eq!(body["response_format"]["sample_rate"], SAMPLE_RATE);
        assert_eq!(
            body["generation_config"]["speech_config"][0]["voice"],
            "Kore"
        );
        assert_eq!(body["store"], false);
    }

    #[test]
    fn output_format_matches_what_is_encoded() {
        assert_eq!(
            OUTPUT_FORMAT,
            format!("mp3_{SAMPLE_RATE}_{MP3_BITRATE_KBPS}")
        );
    }

    #[test]
    fn reads_the_last_audio_block_of_the_model_output() {
        let pcm = pcm_from_response(&response_with_audio(b"newest")).unwrap();
        assert_eq!(pcm, b"newest");
    }

    #[test]
    fn a_response_without_audio_says_how_the_interaction_ended() {
        let blocked = json!({ "status": "failed", "steps": [] }).to_string();
        assert_eq!(
            pcm_from_response(blocked.as_bytes())
                .unwrap_err()
                .to_string(),
            "Gemini TTS returned no audio (status: failed)"
        );
    }

    #[test]
    fn a_response_that_is_not_the_expected_json_is_reported_as_unreadable() {
        for body in [
            "not json".to_string(),
            json!({ "steps": [{ "type": "model_output", "content": [
                { "type": "audio", "data": "%%% not base64" },
            ] }] })
            .to_string(),
        ] {
            assert!(matches!(
                pcm_from_response(body.as_bytes()),
                Err(TtsError::UnreadableResponse(TtsProviderKind::Gemini))
            ));
        }
    }

    #[test]
    fn empty_audio_is_an_error_rather_than_a_silent_clip() {
        assert!(matches!(
            pcm_from_response(&response_with_audio(b"")),
            Err(TtsError::EmptyAudio(TtsProviderKind::Gemini))
        ));
    }

    /// Seconds of audio in an MP3, after checking it is mono at the expected rate.
    fn decoded_seconds(mp3: &[u8]) -> f64 {
        let mut decoder = Mp3Decoder::new();
        decoder.push(mp3);
        decoder.flush();
        let mut samples = 0;
        loop {
            match decoder.next_frame() {
                Ok(frame) => {
                    assert_eq!(frame.sample_rate, SAMPLE_RATE);
                    assert_eq!(frame.channels, MONO);
                    samples += frame.samples.len();
                }
                Err(Error::Again | Error::Eof) => break,
                Err(error) => panic!("not a valid MP3: {error}"),
            }
        }
        samples as f64 / f64::from(SAMPLE_RATE)
    }

    #[test]
    fn pcm_becomes_an_mp3_of_the_same_length() {
        let seconds = decoded_seconds(&encode_mp3(&tone_pcm()).unwrap());
        assert!((seconds - 1.0).abs() < 0.1, "decoded {seconds} seconds");
    }

    #[tokio::test]
    async fn synthesize_waits_out_a_rate_limit_and_returns_an_mp3() {
        let rate_limited = json!({ "error": {
            "message": "Quota exceeded.",
            "details": [{ "retryDelay": "0.01s" }],
        } })
        .to_string();
        let audio = String::from_utf8(response_with_audio(&tone_pcm())).unwrap();
        let (gemini, requests) = gemini_server(vec![
            http_response("429 Too Many Requests", &rate_limited),
            http_response("200 OK", &audio),
        ]);

        let mp3 = gemini.synthesize(&request()).await.unwrap();

        assert!((decoded_seconds(&mp3) - 1.0).abs() < 0.1);
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with("POST /interactions "));
        assert!(requests[1]
            .to_lowercase()
            .contains("x-goog-api-key: secret-key"));
        assert!(requests[1].contains(r#""voice":"Kore""#));
    }

    #[tokio::test]
    async fn list_voices_follows_every_page_and_keeps_what_settings_shows() {
        let first = json!({
            "voices": [{
                "id": "Rosalind", "type": "prebuilt", "display_name": "Rosalind",
                "language_code": "en-GB", "accent": "British", "gender": "female",
                "pitch": "medium", "description": "Warm and clear",
            }],
            "next_page_token": "page-2",
        })
        .to_string();
        let second = json!({
            "voices": [
                { "id": "voice_abc", "displayName": "Mine", "languageCode": "fr-FR" },
                { "type": "prebuilt" },
            ],
        })
        .to_string();
        let (gemini, requests) = gemini_server(vec![
            http_response("200 OK", &first),
            http_response("200 OK", &second),
        ]);

        let voices = gemini.list_voices().await.unwrap();

        let ids: Vec<&str> = voices.iter().map(|voice| voice.id.as_str()).collect();
        assert_eq!(ids, ["Rosalind", "voice_abc"]);
        assert_eq!(voices[0].accent.as_deref(), Some("British"));
        assert_eq!(voices[0].gender.as_deref(), Some("female"));
        assert_eq!(voices[1].display_name.as_deref(), Some("Mine"));
        assert_eq!(voices[1].language_code.as_deref(), Some("fr-FR"));
        let requests = requests.lock().unwrap();
        assert!(requests[0].starts_with("GET /voices?page_size=1000 "));
        assert!(requests[0]
            .to_lowercase()
            .contains("x-goog-api-key: secret-key"));
        assert!(requests[1].starts_with("GET /voices?page_size=1000&page_token=page-2 "));
    }

    #[test]
    fn voices_reach_the_frontend_in_camel_case() {
        let voice: GeminiVoice =
            serde_json::from_value(json!({ "id": "Puck", "display_name": "Puck" })).unwrap();
        let sent = serde_json::to_value(CatalogVoice::from(voice)).unwrap();
        assert_eq!(sent["displayName"], "Puck");
        assert_eq!(sent["languageCode"], Value::Null);
    }

    #[test]
    fn invalid_key_shows_google_wording_from_the_wrapped_error() {
        // Captured from the endpoint: a 400 with the error inside an array.
        let body = r#"[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}]"#;
        let reading = read_error(StatusCode::BAD_REQUEST, body);
        assert_eq!(
            reading.message.as_deref(),
            Some("API key not valid. Please pass a valid API key.")
        );
        assert_eq!(reading.retry, RetryAdvice::ByStatus);
    }

    #[test]
    fn a_per_minute_limit_waits_as_long_as_google_asks() {
        let body = json!({ "error": {
            "code": 429,
            "message": "Quota exceeded.",
            "details": [
                { "@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
                    { "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" },
                ] },
                { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "37.5s" },
            ],
        } })
        .to_string();
        assert_eq!(
            read_error(StatusCode::TOO_MANY_REQUESTS, &body).retry,
            RetryAdvice::After(Duration::from_millis(37_500))
        );
    }

    #[test]
    fn a_used_up_daily_quota_is_not_retried() {
        let body = json!({ "error": {
            "code": 429,
            "message": "Quota exceeded.",
            "details": [
                { "violations": [{ "quotaId": "GenerateRequestsPerDayPerProjectPerModel" }] },
                { "retryDelay": "12s" },
            ],
        } })
        .to_string();
        let reading = read_error(StatusCode::TOO_MANY_REQUESTS, &body);
        assert_eq!(reading.retry, RetryAdvice::QuotaExhausted);
        assert!(reading.message.unwrap().contains("daily Gemini quota"));
    }

    #[test]
    fn a_daily_limit_named_only_in_the_message_is_found() {
        let body = json!({ "error": {
            "code": "rate_limit_exceeded",
            "message": "Rate limit exceeded for model gemini-3.8-flash-tts \
                (limit: 100 requests per day on Tier 1). Please retry in 17h27m55s.",
        } })
        .to_string();
        assert_eq!(
            read_error(StatusCode::TOO_MANY_REQUESTS, &body).retry,
            RetryAdvice::QuotaExhausted
        );
    }

    #[test]
    fn a_daily_limit_named_only_in_the_quota_metric_is_found() {
        let body = json!({ "error": {
            "message": "Quota exceeded.",
            "details": [{ "violations": [{
                "quotaMetric": "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
            }] }],
        } })
        .to_string();
        assert_eq!(
            read_error(StatusCode::TOO_MANY_REQUESTS, &body).retry,
            RetryAdvice::QuotaExhausted
        );
    }

    #[test]
    fn only_a_rate_limit_can_be_a_daily_quota() {
        let body = json!({ "error": { "message": "No more than 5 voices per day." } }).to_string();
        assert_eq!(
            read_error(StatusCode::BAD_REQUEST, &body).retry,
            RetryAdvice::ByStatus
        );
    }

    #[test]
    fn errors_without_a_google_body_fall_back_to_the_status() {
        let rate_limited = read_error(StatusCode::TOO_MANY_REQUESTS, "<html>");
        assert_eq!(
            rate_limited.message.as_deref(),
            Some("too many requests - Gemini rate limit reached")
        );
        assert_eq!(rate_limited.retry, RetryAdvice::ByStatus);
        assert_eq!(read_error(StatusCode::BAD_GATEWAY, "").message, None);
    }
}
