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
    /// Retrying cannot help, whatever the status suggests.
    Never,
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
    loop {
        match fetch_once(provider, build(), read_error).await {
            Ok(body) => return Ok(body),
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

    /// Rate limits (429) and server errors are retried, unless the provider
    /// knows better from the response.
    async fn from_error_response(
        provider: TtsProviderKind,
        response: Response,
        read_error: ReadError,
    ) -> Self {
        let status = response.status();
        let retry_after_header = response
            .headers()
            .get("Retry-After")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);
        let body = response.text().await.unwrap_or_default();
        let reading = read_error(status, &body);
        let message = reading.message.unwrap_or_else(|| match body.trim() {
            "" => status.canonical_reason().unwrap_or("error").to_string(),
            text => text.chars().take(MAX_ERROR_BODY_CHARS).collect(),
        });
        let is_retryable = status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error();
        let retry_after = match reading.retry {
            RetryAdvice::ByStatus => {
                is_retryable.then(|| retry_after_header.unwrap_or(DEFAULT_RETRY_DELAY))
            }
            RetryAdvice::After(delay) => Some(delay),
            RetryAdvice::Never => None,
        };
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
    async fn advice_never_to_retry_beats_a_retryable_status() {
        let (url, requests) = serve(vec![rate_limited()]);
        let read_error: ReadError = |_, _| ErrorReading {
            message: Some("daily quota".into()),
            retry: RetryAdvice::Never,
        };
        let error = fetch(&url, read_error).await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "Gemini TTS request failed (429): daily quota"
        );
        assert_eq!(requests.lock().unwrap().len(), 1);
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
