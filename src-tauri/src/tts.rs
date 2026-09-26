//! Text-to-speech providers. Azure-specific code stays in this module.

use std::future::Future;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TtsRequest {
    pub text: String,
    pub voice: String,
    /// Speaking rate adjustment in percent.
    pub rate: i32,
    /// Pitch adjustment in percent.
    pub pitch: i32,
    pub output_format: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TtsError {
    #[error("Azure Speech credentials are not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or enter them in Settings.")]
    MissingCredentials,
    #[error("Invalid Azure region \"{0}\" (expected something like \"eastus\")")]
    InvalidRegion(String),
    #[error("Network error while calling Azure TTS: {0}")]
    Network(String),
    #[error("Azure TTS request failed ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("Azure TTS returned empty audio")]
    EmptyAudio,
}

/// A provider turns one text item into encoded audio bytes.
pub trait TtsProvider {
    fn synthesize(
        &self,
        request: &TtsRequest,
    ) -> impl Future<Output = Result<Vec<u8>, TtsError>> + Send;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AzureCredentials {
    pub key: String,
    pub region: String,
}

pub struct AzureTts {
    client: reqwest::Client,
    credentials: AzureCredentials,
}

const MAX_ATTEMPTS: u32 = 4;

impl AzureTts {
    pub fn new(client: reqwest::Client, credentials: AzureCredentials) -> Result<Self, TtsError> {
        let region = &credentials.region;
        if region.is_empty()
            || !region
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return Err(TtsError::InvalidRegion(region.clone()));
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

    async fn request_once(
        &self,
        request: &TtsRequest,
    ) -> Result<Vec<u8>, (TtsError, Option<Duration>)> {
        let response = self
            .client
            .post(self.endpoint())
            .header("Ocp-Apim-Subscription-Key", &self.credentials.key)
            .header("Content-Type", "application/ssml+xml")
            .header("X-Microsoft-OutputFormat", &request.output_format)
            .header("User-Agent", "DictationApp")
            .body(build_ssml(request))
            .send()
            .await
            .map_err(|e| {
                (
                    TtsError::Network(e.to_string()),
                    Some(Duration::from_secs(1)),
                )
            })?;

        let status = response.status();
        if !status.is_success() {
            let retry_after = response
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .map(Duration::from_secs);
            let body = response.text().await.unwrap_or_default();
            let message = match (status.as_u16(), body.trim()) {
                (401, _) => "unauthorized - check the Azure Speech key and region".to_string(),
                (429, _) => "too many requests - Azure rate limit reached".to_string(),
                (_, "") => status.canonical_reason().unwrap_or("error").to_string(),
                (_, b) => b.chars().take(300).collect(),
            };
            let retryable = status.as_u16() == 429 || status.is_server_error();
            let err = TtsError::Api {
                status: status.as_u16(),
                message,
            };
            let delay = retryable.then(|| retry_after.unwrap_or(Duration::from_secs(2)));
            return Err((err, delay));
        }

        let bytes = response.bytes().await.map_err(|e| {
            (
                TtsError::Network(e.to_string()),
                Some(Duration::from_secs(1)),
            )
        })?;
        if bytes.is_empty() {
            return Err((TtsError::EmptyAudio, None));
        }
        Ok(bytes.to_vec())
    }
}

impl TtsProvider for AzureTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        let mut attempt = 1;
        loop {
            match self.request_once(request).await {
                Ok(bytes) => return Ok(bytes),
                Err((_, Some(delay))) if attempt < MAX_ATTEMPTS => {
                    // Back off a little more on each retry, capped to keep the UI responsive.
                    let delay = (delay * attempt).min(Duration::from_secs(20));
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
                Err((err, _)) => return Err(err),
            }
        }
    }
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
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

pub fn build_ssml(request: &TtsRequest) -> String {
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"{lang}\"><voice name=\"{voice}\"><prosody rate=\"{rate:+}%\" pitch=\"{pitch:+}%\">{text}</prosody></voice></speak>",
        lang = escape_xml(&voice_locale(&request.voice)),
        voice = escape_xml(&request.voice),
        rate = request.rate,
        pitch = request.pitch,
        text = escape_xml(&request.text),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            text: text.into(),
            voice: "en-GB-SoniaNeural".into(),
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
        let creds = |region: &str| AzureCredentials {
            key: "k".into(),
            region: region.into(),
        };
        assert!(AzureTts::new(client.clone(), creds("eastus")).is_ok());
        assert!(AzureTts::new(client.clone(), creds("evil.com/x")).is_err());
        assert!(AzureTts::new(client, creds("")).is_err());
    }
}
