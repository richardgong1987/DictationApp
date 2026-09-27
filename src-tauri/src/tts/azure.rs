//! Azure Speech text-to-speech over the REST API, with retries on rate limits
//! and server errors.

use std::time::Duration;

use crate::tts::{TtsError, TtsProvider, TtsRequest};

/// Attempts per request, including the first one.
const MAX_ATTEMPTS: u32 = 4;
/// Longest single backoff, so a struggling service cannot freeze generation.
const MAX_RETRY_DELAY: Duration = Duration::from_secs(20);
const NETWORK_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Used when a 429/5xx response carries no `Retry-After` header.
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(2);

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

    async fn request_once(&self, request: &TtsRequest) -> Result<Vec<u8>, FailedAttempt> {
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
            .map_err(FailedAttempt::network)?;

        if !response.status().is_success() {
            return Err(FailedAttempt::from_error_response(response).await);
        }
        let audio = response.bytes().await.map_err(FailedAttempt::network)?;
        if audio.is_empty() {
            return Err(FailedAttempt {
                error: TtsError::EmptyAudio,
                retry_after: None,
            });
        }
        Ok(audio.to_vec())
    }
}

impl TtsProvider for AzureTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
        let mut attempt = 1;
        loop {
            match self.request_once(request).await {
                Ok(audio) => return Ok(audio),
                Err(FailedAttempt {
                    retry_after: Some(delay),
                    ..
                }) if attempt < MAX_ATTEMPTS => {
                    // Back off a little more on each retry.
                    tokio::time::sleep((delay * attempt).min(MAX_RETRY_DELAY)).await;
                    attempt += 1;
                }
                Err(failed) => return Err(failed.error),
            }
        }
    }
}

/// One failed HTTP attempt. `retry_after` is `None` when retrying cannot help.
struct FailedAttempt {
    error: TtsError,
    retry_after: Option<Duration>,
}

impl FailedAttempt {
    fn network(error: reqwest::Error) -> Self {
        Self {
            error: TtsError::Network(error.to_string()),
            retry_after: Some(NETWORK_RETRY_DELAY),
        }
    }

    /// Rate limits (429) and server errors are retried, honoring `Retry-After`.
    async fn from_error_response(response: reqwest::Response) -> Self {
        let status = response.status();
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);
        let body = response.text().await.unwrap_or_default();
        let message = match (status.as_u16(), body.trim()) {
            (401, _) => "unauthorized - check the Azure Speech key and region".to_string(),
            (429, _) => "too many requests - Azure rate limit reached".to_string(),
            (_, "") => status.canonical_reason().unwrap_or("error").to_string(),
            (_, text) => text.chars().take(300).collect(),
        };
        let is_retryable = status.as_u16() == 429 || status.is_server_error();
        Self {
            error: TtsError::Api {
                status: status.as_u16(),
                message,
            },
            retry_after: is_retryable.then(|| retry_after.unwrap_or(DEFAULT_RETRY_DELAY)),
        }
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
        let credentials = |region: &str| AzureCredentials {
            key: "k".into(),
            region: region.into(),
        };
        assert!(AzureTts::new(client.clone(), credentials("eastus")).is_ok());
        assert!(AzureTts::new(client.clone(), credentials("evil.com/x")).is_err());
        assert!(AzureTts::new(client, credentials("")).is_err());
    }
}
