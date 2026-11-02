//! Azure Speech text-to-speech over the REST API.

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::Value;

use crate::tts::http::{fetch_body, ErrorReading};
use crate::tts::{CatalogVoice, TtsError, TtsProvider, TtsProviderKind, TtsRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AzureCredentials {
    pub key: String,
    pub region: String,
}

pub struct AzureTts {
    client: reqwest::Client,
    key: String,
    /// The region's text-to-speech host, such as `https://eastus.tts.speech.microsoft.com`.
    host: String,
}

impl AzureTts {
    pub fn new(client: reqwest::Client, credentials: AzureCredentials) -> Result<Self, TtsError> {
        // The region becomes part of the host name, so anything unusual is refused.
        if !is_valid_region(&credentials.region) {
            return Err(TtsError::InvalidRegion(credentials.region));
        }
        Ok(Self {
            client,
            key: credentials.key,
            host: format!("https://{}.tts.speech.microsoft.com", credentials.region),
        })
    }

    /// Every voice the region offers. Locales such as `en-GB` are Azure's
    /// accents; it has no finer accent than that.
    pub async fn list_voices(&self) -> Result<Vec<CatalogVoice>, TtsError> {
        let url = format!("{}/cognitiveservices/voices/list", self.host);
        let build = || {
            self.client
                .get(&url)
                .header("Ocp-Apim-Subscription-Key", &self.key)
                .header("User-Agent", "DictationApp")
        };
        let body = fetch_body(TtsProviderKind::Azure, build, read_error).await?;
        let voices: Vec<AzureVoice> = serde_json::from_slice(&body)
            .map_err(|_| TtsError::UnreadableResponse(TtsProviderKind::Azure))?;
        Ok(voices
            .into_iter()
            .filter(|voice| !voice.short_name.is_empty())
            .map(CatalogVoice::from)
            .collect())
    }
}

impl TtsProvider for AzureTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        let endpoint = format!("{}/cognitiveservices/v1", self.host);
        let ssml = build_ssml(request);
        let build = || {
            self.client
                .post(&endpoint)
                .header("Ocp-Apim-Subscription-Key", &self.key)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", &request.output_format)
                .header("User-Agent", "DictationApp")
                .body(ssml.clone())
        };
        fetch_body(TtsProviderKind::Azure, build, read_error).await
    }
}

/// One voice of `voices/list`, with the fields Microsoft documents.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AzureVoice {
    /// What SSML names, such as `en-GB-SoniaNeural`.
    #[serde(default)]
    short_name: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    locale: Option<String>,
    #[serde(default)]
    gender: Option<String>,
    /// "GA" or "Preview".
    #[serde(default)]
    status: Option<String>,
    /// Documented as a string, such as "152".
    #[serde(default)]
    words_per_minute: Option<Value>,
    /// The other languages a multilingual voice speaks.
    #[serde(default)]
    secondary_locale_list: Vec<String>,
}

impl From<AzureVoice> for CatalogVoice {
    fn from(voice: AzureVoice) -> Self {
        let description = describe_voice(&voice);
        Self {
            id: voice.short_name,
            display_name: voice.display_name,
            language_code: voice.locale,
            accent: None,
            gender: voice.gender,
            pitch: None,
            description,
        }
    }
}

/// What helps a learner choose: how fast the voice speaks, and what else it can do.
fn describe_voice(voice: &AzureVoice) -> Option<String> {
    let pace = voice
        .words_per_minute
        .as_ref()
        .and_then(|value| match value {
            Value::String(words) => Some(words.clone()),
            Value::Number(words) => Some(words.to_string()),
            _ => None,
        });
    let others = voice.secondary_locale_list.len();
    let parts = [
        pace.map(|words| format!("About {words} words a minute.")),
        (others > 0).then(|| format!("Also speaks {others} other languages.")),
        (voice.status.as_deref() == Some("Preview")).then(|| "Preview voice.".to_string()),
    ];
    let description = parts.into_iter().flatten().collect::<Vec<_>>().join(" ");
    (!description.is_empty()).then_some(description)
}

fn read_error(status: StatusCode, body: &str) -> ErrorReading {
    ErrorReading::worded(describe_error(status, body))
}

fn describe_error(status: StatusCode, _body: &str) -> Option<String> {
    match status {
        StatusCode::UNAUTHORIZED => {
            Some("unauthorized - check the Azure Speech key and region".to_string())
        }
        StatusCode::TOO_MANY_REQUESTS => {
            Some("too many requests - Azure rate limit reached".to_string())
        }
        _ => None,
    }
}

/// Azure regions are lowercase letters and digits, e.g. `eastus` or `westus2`.
fn is_valid_region(region: &str) -> bool {
    !region.is_empty()
        && region
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn build_ssml(request: &TtsRequest) -> String {
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"{lang}\"><voice name=\"{voice}\">{text}</voice></speak>",
        lang = escape_xml(&voice_locale(&request.voice)),
        voice = escape_xml(&request.voice),
        text = escape_xml(&request.text),
    )
}

/// `en-US-JennyNeural` -> `en-US`.
fn voice_locale(voice: &str) -> String {
    let parts: Vec<&str> = voice.split('-').collect();
    if parts.len() >= 2 {
        format!("{}-{}", parts[0], parts[1])
    } else {
        "en-US".to_string()
    }
}

fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::tts::http::test_server::{http_response, serve};

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            provider: TtsProviderKind::Azure,
            text: text.into(),
            voice: "en-GB-SoniaNeural".into(),
            model: String::new(),
            output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        }
    }

    #[test]
    fn ssml_escapes_text_and_sets_voice() {
        let ssml = build_ssml(&request("Tom & Jerry <said> \"it's\""));
        assert!(ssml.contains("xml:lang=\"en-GB\""));
        assert!(ssml.contains("<voice name=\"en-GB-SoniaNeural\">"));
        assert!(ssml.contains("Tom &amp; Jerry &lt;said&gt; &quot;it&apos;s&quot;"));
    }

    #[test]
    fn rejects_suspicious_regions() {
        let client = reqwest::Client::new();
        let credentials = |region: &str| AzureCredentials {
            key: "k".into(),
            region: region.into(),
        };
        assert!(AzureTts::new(client.clone(), credentials("eastus")).is_ok());
        assert!(AzureTts::new(client.clone(), credentials("evil.com/x")).is_err());
        assert!(AzureTts::new(client, credentials("")).is_err());
    }

    #[tokio::test]
    async fn lists_the_region_voices_with_what_settings_shows() {
        // Shaped like the sample response in Microsoft's REST reference.
        let list = json!([
            {
                "Name": "Microsoft Server Speech Text to Speech Voice (en-GB, SoniaNeural)",
                "DisplayName": "Sonia", "LocalName": "Sonia", "ShortName": "en-GB-SoniaNeural",
                "Gender": "Female", "Locale": "en-GB", "LocaleName": "English (United Kingdom)",
                "StyleList": ["cheerful", "sad"], "SampleRateHertz": "48000", "VoiceType": "Neural",
                "Status": "GA", "WordsPerMinute": "147",
            },
            {
                "DisplayName": "Jenny Multilingual", "ShortName": "en-US-JennyMultilingualNeural",
                "Gender": "Female", "Locale": "en-US", "SecondaryLocaleList": ["de-DE", "en-GB", "fr-FR"],
                "Status": "Preview", "WordsPerMinute": 190,
            },
            { "DisplayName": "Nameless" },
        ])
        .to_string();
        let (url, requests) = serve(vec![http_response("200 OK", &list)]);
        let azure = AzureTts {
            client: reqwest::Client::new(),
            key: "secret-key".into(),
            host: url.trim_end_matches('/').to_string(),
        };

        let voices = azure.list_voices().await.unwrap();

        assert_eq!(voices.len(), 2);
        assert_eq!(voices[0].id, "en-GB-SoniaNeural");
        assert_eq!(voices[0].display_name.as_deref(), Some("Sonia"));
        assert_eq!(voices[0].language_code.as_deref(), Some("en-GB"));
        assert_eq!(voices[0].gender.as_deref(), Some("Female"));
        assert_eq!(
            voices[0].description.as_deref(),
            Some("About 147 words a minute.")
        );
        assert_eq!(
            voices[1].description.as_deref(),
            Some("About 190 words a minute. Also speaks 3 other languages. Preview voice.")
        );
        let request = &requests.lock().unwrap()[0];
        assert!(request.starts_with("GET /cognitiveservices/voices/list "));
        assert!(request
            .to_lowercase()
            .contains("ocp-apim-subscription-key: secret-key"));
    }

    #[test]
    fn a_voice_with_nothing_to_tell_has_no_description() {
        let voice: AzureVoice =
            serde_json::from_value(json!({ "ShortName": "xx-XX-OneNeural" })).unwrap();
        assert_eq!(CatalogVoice::from(voice).description, None);
    }
}
