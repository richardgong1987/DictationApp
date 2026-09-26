//! Deterministic audio caching: one MP3 per dictation item, reused as long as
//! the text and voice settings that produced it are unchanged.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::tts::{TtsError, TtsProvider, TtsRequest};

/// Bump when the key recipe changes so old audio is treated as stale.
const CACHE_KEY_VERSION: &str = "v1";

/// `SHA-256(version, text, voice, rate, pitch, output_format)` as lowercase hex.
///
/// Fields are separated by a control character that cannot appear in any of
/// them, so different field boundaries can never produce the same input.
pub fn cache_key(request: &TtsRequest) -> String {
    let rate = request.rate.to_string();
    let pitch = request.pitch.to_string();
    let fields = [
        CACHE_KEY_VERSION,
        request.text.as_str(),
        request.voice.as_str(),
        rate.as_str(),
        pitch.as_str(),
        request.output_format.as_str(),
    ];
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update(field.as_bytes());
        hasher.update([0x1f]);
    }
    hex::encode(hasher.finalize())
}

/// Audio state of an item relative to the current settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioStatus {
    /// File exists and was produced with the current text/voice settings.
    Ready,
    /// File exists but voice settings changed since it was generated.
    Stale,
    /// No usable file.
    Missing,
}

pub fn audio_status(
    data_dir: &Path,
    audio_path: Option<&str>,
    stored_key: Option<&str>,
    expected_key: &str,
) -> AudioStatus {
    match audio_path {
        Some(rel) if data_dir.join(rel).is_file() => {
            if stored_key == Some(expected_key) {
                AudioStatus::Ready
            } else {
                AudioStatus::Stale
            }
        }
        _ => AudioStatus::Missing,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioOutcome {
    Cached,
    Generated,
}

/// Returns the cached audio if it matches `request`, otherwise synthesizes it
/// with `provider` and writes it to `data_dir/relative_path`.
///
/// `force` always regenerates. Writes go through a temporary file so a failed
/// or interrupted download never leaves a truncated MP3 behind.
pub async fn ensure_audio<P: TtsProvider>(
    provider: Option<&P>,
    data_dir: &Path,
    relative_path: &str,
    stored_key: Option<&str>,
    request: &TtsRequest,
    force: bool,
) -> Result<(AudioOutcome, String), CacheError> {
    let key = cache_key(request);
    let status = audio_status(data_dir, Some(relative_path), stored_key, &key);
    if status == AudioStatus::Ready && !force {
        return Ok((AudioOutcome::Cached, key));
    }

    let provider = provider.ok_or(TtsError::MissingCredentials)?;
    let bytes = provider.synthesize(request).await?;

    let target: PathBuf = data_dir.join(relative_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = target.with_extension("mp3.part");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &target)?;
    Ok((AudioOutcome::Generated, key))
}

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error(transparent)]
    Tts(#[from] TtsError),
    #[error("Could not save audio: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            text: text.into(),
            voice: "en-US-JennyNeural".into(),
            rate: 0,
            pitch: 0,
            output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        }
    }

    #[test]
    fn cache_key_is_deterministic_and_sensitive_to_every_field() {
        let base = request("Hello there.");
        let key = cache_key(&base);
        assert_eq!(key, cache_key(&base.clone()));
        assert_eq!(key.len(), 64);

        let variants = [
            TtsRequest {
                text: "Hello there!".into(),
                ..base.clone()
            },
            TtsRequest {
                voice: "en-GB-SoniaNeural".into(),
                ..base.clone()
            },
            TtsRequest {
                rate: 10,
                ..base.clone()
            },
            TtsRequest {
                pitch: -5,
                ..base.clone()
            },
            TtsRequest {
                output_format: "riff-24khz-16bit-mono-pcm".into(),
                ..base.clone()
            },
        ];
        for v in variants {
            assert_ne!(cache_key(&v), key, "{v:?}");
        }
    }

    #[test]
    fn cache_key_field_boundaries_are_unambiguous() {
        let a = TtsRequest {
            text: "ab".into(),
            voice: "c".into(),
            ..request("")
        };
        let b = TtsRequest {
            text: "a".into(),
            voice: "bc".into(),
            ..request("")
        };
        assert_ne!(cache_key(&a), cache_key(&b));
    }

    struct CountingProvider(AtomicUsize);

    impl TtsProvider for CountingProvider {
        async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(format!("mp3:{}", request.text).into_bytes())
        }
    }

    #[tokio::test]
    async fn generates_once_then_reuses_cache() {
        let dir = tempfile::tempdir().unwrap();
        let provider = CountingProvider(AtomicUsize::new(0));
        let req = request("I should have told you earlier.");
        let rel = "lessons/x/audio/001.mp3";

        let (outcome, key) = ensure_audio(Some(&provider), dir.path(), rel, None, &req, false)
            .await
            .unwrap();
        assert_eq!(outcome, AudioOutcome::Generated);
        assert_eq!(
            std::fs::read(dir.path().join(rel)).unwrap(),
            b"mp3:I should have told you earlier."
        );

        // Second call with the stored key must not hit the provider.
        let (outcome, _) = ensure_audio(Some(&provider), dir.path(), rel, Some(&key), &req, false)
            .await
            .unwrap();
        assert_eq!(outcome, AudioOutcome::Cached);
        assert_eq!(provider.0.load(Ordering::SeqCst), 1);

        // Cached audio is usable even without credentials.
        let none: Option<&CountingProvider> = None;
        let (outcome, _) = ensure_audio(none, dir.path(), rel, Some(&key), &req, false)
            .await
            .unwrap();
        assert_eq!(outcome, AudioOutcome::Cached);

        // Changed voice settings make the file stale and trigger regeneration.
        let other = TtsRequest {
            rate: 20,
            ..req.clone()
        };
        let (outcome, _) =
            ensure_audio(Some(&provider), dir.path(), rel, Some(&key), &other, false)
                .await
                .unwrap();
        assert_eq!(outcome, AudioOutcome::Generated);

        // Forced regeneration always calls the provider.
        ensure_audio(
            Some(&provider),
            dir.path(),
            rel,
            Some(&cache_key(&other)),
            &other,
            true,
        )
        .await
        .unwrap();
        assert_eq!(provider.0.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn missing_provider_is_an_error_when_audio_is_needed() {
        let dir = tempfile::tempdir().unwrap();
        let none: Option<&CountingProvider> = None;
        let err = ensure_audio(none, dir.path(), "a/001.mp3", None, &request("x"), false)
            .await
            .unwrap_err();
        assert!(matches!(err, CacheError::Tts(TtsError::MissingCredentials)));
    }

    #[test]
    fn status_reflects_file_and_key() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("001.mp3"), b"x").unwrap();
        assert_eq!(
            audio_status(dir.path(), Some("001.mp3"), Some("k"), "k"),
            AudioStatus::Ready
        );
        assert_eq!(
            audio_status(dir.path(), Some("001.mp3"), Some("old"), "k"),
            AudioStatus::Stale
        );
        assert_eq!(
            audio_status(dir.path(), Some("002.mp3"), Some("k"), "k"),
            AudioStatus::Missing
        );
        assert_eq!(
            audio_status(dir.path(), None, None, "k"),
            AudioStatus::Missing
        );
    }
}
