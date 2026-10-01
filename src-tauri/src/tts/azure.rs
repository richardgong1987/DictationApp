//! Azure Speech text-to-speech over the REST API.

use reqwest::StatusCode;

use crate::tts::http::fetch_audio;
use crate::tts::{TtsError, TtsProvider, TtsProviderKind, TtsRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AzureCredentials {
    pub key: String,
    pub region: String,
}

pub struct AzureTts {
    client: reqwest::Client,
    credentials: AzureCredentials,
}

impl AzureTts {
    pub fn new(client: reqwest::Client, credentials: AzureCredentials) -> Result<Self, TtsError> {
        // The region becomes part of the host name, so anything unusual is refused.
        if !is_valid_region(&credentials.region) {
            return Err(TtsError::InvalidRegion(credentials.region));
        }
        Ok(Self {
            client,
            credentials,
        })
    }

    fn endpoint(&self) -> String {
        format!(
            "https://{}.tts.speech.microsoft.com/cognitiveservices/v1",
            self.credentials.region
        )
    }
}

impl TtsProvider for AzureTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        let endpoint = self.endpoint();
        let ssml = build_ssml(request);
        let build = || {
            self.client
                .post(&endpoint)
                .header("Ocp-Apim-Subscription-Key", &self.credentials.key)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", &request.output_format)
                .header("User-Agent", "DictationApp")
                .body(ssml.clone())
        };
        fetch_audio(TtsProviderKind::Azure, build, describe_error).await
    }
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
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"{lang}\"><voice name=\"{voice}\"><prosody rate=\"{rate:+}%\" pitch=\"{pitch:+}%\">{text}</prosody></voice></speak>",
        lang = escape_xml(&voice_locale(&request.voice)),
        voice = escape_xml(&request.voice),
        rate = request.rate,
        pitch = request.pitch,
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

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            provider: TtsProviderKind::Azure,
            text: text.into(),
            voice: "en-GB-SoniaNeural".into(),
            model: String::new(),
            rate: -10,
            pitch: 0,
            output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        }
    }

    #[test]
    fn ssml_escapes_text_and_sets_voice() {
        let ssml = build_ssml(&request("Tom & Jerry <said> \"it's\""));
        assert!(ssml.contains("xml:lang=\"en-GB\""));
        assert!(ssml.contains("<voice name=\"en-GB-SoniaNeural\">"));
        assert!(ssml.contains("rate=\"-10%\" pitch=\"+0%\""));
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
}
