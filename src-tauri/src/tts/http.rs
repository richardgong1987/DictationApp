//! The HTTP exchange every provider shares: rate limits, server errors and
//! network failures are retried with a growing backoff.

use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};

use crate::tts::{TtsError, TtsProviderKind};

/// Attempts per request, including the first one.
const MAX_ATTEMPTS: u32 = 4;
/// Longest single backoff, so a struggling service cannot freeze generation.
const MAX_RETRY_DELAY: Duration = Duration::from_secs(20);
const NETWORK_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Used when a 429/5xx response carries no `Retry-After` header.
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(2);
/// Error bodies shown as they are get cut to this many characters.
const MAX_ERROR_BODY_CHARS: usize = 300;

/// A provider's own wording for an error response. `None` shows the
/// response body, or the status reason when the body is empty.
pub type DescribeError = fn(StatusCode, &str) -> Option<String>;

/// Sends the request `build` makes until it returns audio or retrying cannot help.
pub async fn fetch_audio(
    provider: TtsProviderKind,
    build: impl Fn() -> RequestBuilder,
    describe_error: DescribeError,
) -> Result<Vec<u8>, TtsError> {
    let mut attempt = 1;
    loop {
        match fetch_once(provider, build(), describe_error).await {
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

async fn fetch_once(
    provider: TtsProviderKind,
    request: RequestBuilder,
    describe_error: DescribeError,
) -> Result<Vec<u8>, FailedAttempt> {
    let response = request
        .send()
        .await
        .map_err(|error| FailedAttempt::network(provider, error))?;
    if !response.status().is_success() {
        return Err(FailedAttempt::from_error_response(provider, response, describe_error).await);
    }
    let audio = response
        .bytes()
        .await
        .map_err(|error| FailedAttempt::network(provider, error))?;
    if audio.is_empty() {
        return Err(FailedAttempt {
            error: TtsError::EmptyAudio(provider),
            retry_after: None,
        });
    }
    Ok(audio.to_vec())
}

/// One failed HTTP attempt. `retry_after` is `None` when retrying cannot help.
struct FailedAttempt {
    error: TtsError,
    retry_after: Option<Duration>,
}

impl FailedAttempt {
    fn network(provider: TtsProviderKind, error: reqwest::Error) -> Self {
        Self {
            error: TtsError::Network {
                provider,
                message: error.to_string(),
            },
            retry_after: Some(NETWORK_RETRY_DELAY),
        }
    }

    /// Rate limits (429) and server errors are retried, honoring `Retry-After`.
    async fn from_error_response(
        provider: TtsProviderKind,
        response: Response,
        describe_error: DescribeError,
    ) -> Self {
        let status = response.status();
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);
        let body = response.text().await.unwrap_or_default();
        let message = describe_error(status, &body).unwrap_or_else(|| match body.trim() {
            "" => status.canonical_reason().unwrap_or("error").to_string(),
            text => text.chars().take(MAX_ERROR_BODY_CHARS).collect(),
        });
        let is_retryable = status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error();
        Self {
            error: TtsError::Api {
                provider,
                status: status.as_u16(),
                message,
            },
            retry_after: is_retryable.then(|| retry_after.unwrap_or(DEFAULT_RETRY_DELAY)),
        }
    }
}
