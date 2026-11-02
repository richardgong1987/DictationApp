//! The HTTP exchange every provider shares: rate limits, server errors and
//! network failures are retried with a growing backoff.

use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};

use crate::tts::{TtsError, TtsProviderKind};

/// Attempts per request, including the first one.
const MAX_ATTEMPTS: u32 = 4;
/// Longest single backoff, so a struggling service cannot freeze generation.
const MAX_RETRY_DELAY: Duration = Duration::from_secs(20);
/// The longest all of a request's retries can wait, which is as long as a
/// per-minute limit lasts. A rate limit that goes beyond it is a used-up quota.
const MAX_TOTAL_RETRY_DELAY: Duration =
    Duration::from_secs(MAX_RETRY_DELAY.as_secs() * (MAX_ATTEMPTS as u64 - 1));
const NETWORK_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Used when a 429/5xx response carries no `Retry-After` header.
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(2);
/// Error bodies shown as they are get cut to this many characters.
const MAX_ERROR_BODY_CHARS: usize = 300;

/// What a provider makes of one of its error responses.
#[derive(Debug, PartialEq, Eq)]
pub struct ErrorReading {
    /// Its own wording. `None` shows the response body, or the status reason
    /// when the body is empty.
    pub message: Option<String>,
    pub retry: RetryAdvice,
}

impl ErrorReading {
    /// For providers whose errors say nothing about retrying.
    pub fn worded(message: Option<String>) -> Self {
        Self {
            message,
            retry: RetryAdvice::ByStatus,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum RetryAdvice {
    /// Retry a 429 or 5xx, honoring `Retry-After`.
    ByStatus,
    /// The wait named in the response body. Still limited by the backoff.
    After(Duration),
    /// The quota is used up, so neither this request nor the next can succeed.
    QuotaExhausted,
}

pub type ReadError = fn(StatusCode, &str) -> ErrorReading;

/// Sends the request `build` makes until it succeeds or retrying cannot help,
/// and returns the response body.
pub async fn fetch_body(
    provider: TtsProviderKind,
    build: impl Fn() -> RequestBuilder,
    read_error: ReadError,
) -> Result<Vec<u8>, TtsError> {
    let mut attempt = 1;
    let mut waited = Duration::ZERO;
    loop {
        match fetch_once(provider, build(), read_error).await {
            Ok(body) => return Ok(body),
            Err(FailedAttempt {
                retry_after: Some(delay),
                ..
            }) if attempt < MAX_ATTEMPTS => {
                // Back off a little more on each retry.
                let backoff = (delay * attempt).min(MAX_RETRY_DELAY);
                tokio::time::sleep(backoff).await;
                waited += backoff;
                attempt += 1;
            }
            Err(failed) => return Err(failed.final_error(waited)),
        }
    }
}

async fn fetch_once(
    provider: TtsProviderKind,
    request: RequestBuilder,
    read_error: ReadError,
) -> Result<Vec<u8>, FailedAttempt> {
    let response = request
        .send()
        .await
        .map_err(|error| FailedAttempt::network(provider, error))?;
    if !response.status().is_success() {
        return Err(FailedAttempt::from_error_response(provider, response, read_error).await);
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| FailedAttempt::network(provider, error))?;
    if body.is_empty() {
        return Err(FailedAttempt {
            error: TtsError::EmptyAudio(provider),
            retry_after: None,
        });
    }
    Ok(body.to_vec())
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

    /// A rate limit still there after the longest wait is no per-minute limit.
    /// This finds a used-up quota however the provider words its error.
    fn final_error(self, waited: Duration) -> TtsError {
        match self.error {
            TtsError::Api {
                provider,
                status: 429,
                message,
            } if waited >= MAX_TOTAL_RETRY_DELAY => TtsError::QuotaExhausted { provider, message },
            error => error,
        }
    }

    /// Rate limits (429) and server errors are retried, unless the provider
    /// knows better from the response.
    async fn from_error_response(
        provider: TtsProviderKind,
        response: Response,
        read_error: ReadError,
    ) -> Self {
        let status = response.status();
        let retry_after_header = retry_after_header(&response);
        let body = response.text().await.unwrap_or_default();
        let reading = read_error(status, &body);
        let message = reading.message.unwrap_or_else(|| match body.trim() {
            "" => status.canonical_reason().unwrap_or("error").to_string(),
            text => text.chars().take(MAX_ERROR_BODY_CHARS).collect(),
        });
        let is_rate_limited = status == StatusCode::TOO_MANY_REQUESTS;
        let is_retryable = is_rate_limited || status.is_server_error();
        let retry_after = match reading.retry {
            RetryAdvice::ByStatus => {
                is_retryable.then(|| retry_after_header.unwrap_or(DEFAULT_RETRY_DELAY))
            }
            RetryAdvice::After(delay) => Some(delay),
            RetryAdvice::QuotaExhausted => None,
        };
        let outlasts_retries =
            is_rate_limited && retry_after.is_some_and(|wait| wait > MAX_TOTAL_RETRY_DELAY);
        if reading.retry == RetryAdvice::QuotaExhausted || outlasts_retries {
            return Self {
                error: TtsError::QuotaExhausted { provider, message },
                retry_after: None,
            };
        }
        Self {
            error: TtsError::Api {
                provider,
                status: status.as_u16(),
                message,
            },
            retry_after,
        }
    }
}

fn retry_after_header(response: &Response) -> Option<Duration> {
    response
        .headers()
        .get("Retry-After")?
        .to_str()
        .ok()?
        .parse()
        .ok()
        .map(Duration::from_secs)
}

/// A local server that plays the provider's part over a real connection.
#[cfg(test)]
pub mod test_server {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    pub fn http_response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Answers one connection per response, in order, and records the requests.
    pub fn serve(responses: Vec<String>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                recorded.lock().unwrap().push(request);
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (url, requests)
    }

    /// Reads until the headers and the body they announce have arrived.
    fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let read = stream.read(&mut chunk).unwrap();
            bytes.extend_from_slice(&chunk[..read]);
            let text = String::from_utf8_lossy(&bytes).to_string();
            let Some((headers, body)) = text.split_once("\r\n\r\n") else {
                continue;
            };
            let body_length = headers
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length: ")?
                        .parse()
                        .ok()
                })
                .unwrap_or(0);
            if read == 0 || body.len() >= body_length {
                return text;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_server::{http_response, serve};
    use super::*;

    fn rate_limited() -> String {
        http_response("429 Too Many Requests", "slow")
    }

    async fn fetch(url: &str, read_error: ReadError) -> Result<Vec<u8>, TtsError> {
        let client = reqwest::Client::new();
        let build = || client.post(url);
        fetch_body(TtsProviderKind::Gemini, build, read_error).await
    }

    #[tokio::test]
    async fn a_wait_named_in_the_body_is_honored_and_the_request_sent_again() {
        let (url, requests) = serve(vec![rate_limited(), http_response("200 OK", "audio")]);
        let read_error: ReadError = |_, _| ErrorReading {
            message: None,
            retry: RetryAdvice::After(Duration::from_millis(5)),
        };
        assert_eq!(fetch(&url, read_error).await.unwrap(), b"audio");
        assert_eq!(requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_used_up_quota_is_not_retried_despite_a_retryable_status() {
        let (url, requests) = serve(vec![rate_limited()]);
        let read_error: ReadError = |_, _| ErrorReading {
            message: Some("daily quota".into()),
            retry: RetryAdvice::QuotaExhausted,
        };
        let error = fetch(&url, read_error).await.unwrap_err();
        assert!(matches!(error, TtsError::QuotaExhausted { .. }));
        assert_eq!(
            error.to_string(),
            "Gemini TTS request failed (429): daily quota"
        );
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_wait_longer_than_the_retries_can_cover_is_a_used_up_quota() {
        let hours_away =
            "HTTP/1.1 429 Too Many Requests\r\nretry-after: 12600\r\ncontent-length: 0\r\n\r\n";
        let (url, requests) = serve(vec![hours_away.to_string()]);
        let error = fetch(&url, |_, _| ErrorReading::worded(None))
            .await
            .unwrap_err();
        assert!(matches!(error, TtsError::QuotaExhausted { .. }));
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    fn failed_with(status: u16) -> FailedAttempt {
        FailedAttempt {
            error: TtsError::Api {
                provider: TtsProviderKind::Gemini,
                status,
                message: "refused".into(),
            },
            retry_after: None,
        }
    }

    #[test]
    fn a_rate_limit_that_outlasts_every_retry_is_a_used_up_quota() {
        let error = failed_with(429).final_error(MAX_TOTAL_RETRY_DELAY);
        assert!(matches!(error, TtsError::QuotaExhausted { .. }));
    }

    #[test]
    fn a_short_wait_proves_nothing_about_the_quota() {
        let error = failed_with(429).final_error(Duration::from_secs(12));
        assert!(matches!(error, TtsError::Api { .. }));
    }

    #[test]
    fn a_server_error_is_never_a_used_up_quota() {
        let error = failed_with(503).final_error(MAX_TOTAL_RETRY_DELAY);
        assert!(matches!(error, TtsError::Api { .. }));
    }

    #[tokio::test]
    async fn unworded_errors_show_the_response_body() {
        let (url, _) = serve(vec![http_response("400 Bad Request", "oops")]);
        let error = fetch(&url, |_, _| ErrorReading::worded(None))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "Gemini TTS request failed (400): oops");
    }
}
