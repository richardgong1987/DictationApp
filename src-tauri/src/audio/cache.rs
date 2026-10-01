//! Deterministic audio caching: one MP3 per dictation item, reused as long as
//! the text and voice settings that produced it are unchanged.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::DictationItem;
use crate::settings::Settings;
use crate::tts::{TtsProvider, TtsProviderKind, TtsRequest};

/// Bump when the key recipe changes so old audio is treated as stale.
const CACHE_KEY_VERSION: &str = "v1";

/// `SHA-256(version, text, voice, rate, pitch, output_format)` as lowercase
/// hex, followed by `provider, model` for providers other than Azure.
///
/// Fields are separated by a control character that cannot appear in any of
/// them, so different field boundaries can never produce the same input.
pub fn cache_key(request: &TtsRequest) -> String {
    let rate = request.rate.to_string();
    let pitch = request.pitch.to_string();
    let mut fields = vec![
        CACHE_KEY_VERSION,
        request.text.as_str(),
        request.voice.as_str(),
        rate.as_str(),
        pitch.as_str(),
        request.output_format.as_str(),
    ];
    match request.provider {
        // Azure keys keep the recipe from before other providers existed, so
        // audio generated back then is still recognized as current.
        TtsProviderKind::Azure => {}
        TtsProviderKind::ElevenLabs => fields.extend(["elevenlabs", request.model.as_str()]),
    }
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update(field.as_bytes());
        hasher.update([0x1f]);
    }
    hex::encode(hasher.finalize())
}

/// Audio state of an item relative to the current settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioStatus {
    /// File exists and was produced with the current text/voice settings.
    Ready,
    /// File exists but voice settings changed since it was generated.
    Stale,
    /// No usable file.
    Missing,
}

impl AudioStatus {
    fn evaluate(file_exists: bool, stored_key: Option<&str>, expected_key: &str) -> Self {
        match (file_exists, stored_key == Some(expected_key)) {
            (false, _) => Self::Missing,
            (true, true) => Self::Ready,
            (true, false) => Self::Stale,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioOutcome {
    Cached,
    Generated,
}

/// Where an item's up-to-date audio is, and the cache key it was made with.
pub struct CachedAudio {
    pub outcome: AudioOutcome,
    pub path: String,
    pub cache_key: String,
}

#[derive(Clone)]
pub struct AudioCache {
    files: LessonFiles,
}

impl AudioCache {
    pub fn new(files: LessonFiles) -> Self {
        Self { files }
    }

    pub fn status(&self, item: &DictationItem, settings: &Settings) -> AudioStatus {
        let file_exists = item
            .audio_path
            .as_deref()
            .is_some_and(|path| self.files.audio_exists(path));
        let expected_key = cache_key(&settings.tts_request(&item.text));
        AudioStatus::evaluate(file_exists, item.audio_cache_key.as_deref(), &expected_key)
    }

    /// Reuses the item's audio if it matches `settings`, otherwise synthesizes
    /// it with `provider`. `force` always synthesizes. Without a provider only
    /// cached audio can be returned.
    pub async fn ensure<P: TtsProvider>(
        &self,
        provider: Option<&P>,
        item: &DictationItem,
        settings: &Settings,
        force: bool,
    ) -> AppResult<CachedAudio> {
        let request = settings.tts_request(&item.text);
        let key = cache_key(&request);
        let path = item
            .audio_path
            .clone()
            .unwrap_or_else(|| LessonFiles::audio_path(&item.lesson_id, item.position));
        let status = AudioStatus::evaluate(
            self.files.audio_exists(&path),
            item.audio_cache_key.as_deref(),
            &key,
        );
        if status == AudioStatus::Ready && !force {
            return Ok(CachedAudio {
                outcome: AudioOutcome::Cached,
                path,
                cache_key: key,
            });
        }

        let provider = provider.ok_or(AppError::MissingSpeechCredentials(settings.tts_provider))?;
        let audio = provider.synthesize(&request).await?;
        self.files
            .write_audio(&path, &audio)
            .map_err(AppError::AudioNotSaved)?;
        Ok(CachedAudio {
            outcome: AudioOutcome::Generated,
            path,
            cache_key: key,
        })
    }

    pub fn read(&self, item: &DictationItem) -> AppResult<Vec<u8>> {
        let path = item
            .audio_path
            .as_deref()
            .filter(|path| self.files.audio_exists(path))
            .ok_or(AppError::AudioNotFound)?;
        Ok(self.files.read_audio(path)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::tts::TtsError;

    const TEXT: &str = "I should have told you earlier.";

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            provider: TtsProviderKind::Azure,
            text: text.into(),
            voice: "en-US-JennyNeural".into(),
            model: String::new(),
            rate: 0,
            pitch: 0,
            output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        }
    }

    fn item(audio_cache_key: Option<String>) -> DictationItem {
        DictationItem {
            id: 1,
            lesson_id: "x".into(),
            position: 1,
            text: TEXT.into(),
            audio_path: Some(LessonFiles::audio_path("x", 1)),
            audio_cache_key,
        }
    }

    #[derive(Default)]
    struct CountingProvider {
        calls: AtomicUsize,
    }

    impl CountingProvider {
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl TtsProvider for CountingProvider {
        async fn synthesize(&self, request: &TtsRequest) -> Result<Vec<u8>, TtsError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(format!("mp3:{}", request.text).into_bytes())
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
            TtsRequest {
                provider: TtsProviderKind::ElevenLabs,
                ..base.clone()
            },
        ];
        for variant in variants {
            assert_ne!(cache_key(&variant), key, "{variant:?}");
        }
    }

    #[test]
    fn azure_keys_are_unchanged_so_existing_audio_stays_current() {
        // Computed with the recipe used before ElevenLabs was supported.
        assert_eq!(
            cache_key(&request("Hello there.")),
            "972d3452bf9025ee15750491167c05526cc922e0dfb0e5681fb442d75dff878e"
        );
    }

    #[test]
    fn elevenlabs_keys_depend_on_the_model() {
        let elevenlabs = |model: &str| TtsRequest {
            provider: TtsProviderKind::ElevenLabs,
            model: model.into(),
            ..request("Hello there.")
        };
        assert_ne!(
            cache_key(&elevenlabs("eleven_multilingual_v2")),
            cache_key(&elevenlabs("eleven_flash_v2_5"))
        );
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

    #[test]
    fn status_reflects_file_and_key() {
        assert_eq!(
            AudioStatus::evaluate(true, Some("k"), "k"),
            AudioStatus::Ready
        );
        assert_eq!(
            AudioStatus::evaluate(true, Some("old"), "k"),
            AudioStatus::Stale
        );
        assert_eq!(
            AudioStatus::evaluate(false, Some("k"), "k"),
            AudioStatus::Missing
        );
        assert_eq!(
            AudioStatus::evaluate(false, None, "k"),
            AudioStatus::Missing
        );
    }

    #[tokio::test]
    async fn generates_once_then_reuses_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AudioCache::new(LessonFiles::new(dir.path().to_path_buf()));
        let provider = CountingProvider::default();
        let settings = Settings::default();

        let first = cache
            .ensure(Some(&provider), &item(None), &settings, false)
            .await
            .unwrap();
        assert_eq!(first.outcome, AudioOutcome::Generated);
        assert_eq!(
            std::fs::read(dir.path().join(&first.path)).unwrap(),
            format!("mp3:{TEXT}").into_bytes()
        );

        // With the stored key, the provider is not called again.
        let stored = item(Some(first.cache_key));
        let second = cache
            .ensure(Some(&provider), &stored, &settings, false)
            .await
            .unwrap();
        assert_eq!(second.outcome, AudioOutcome::Cached);
        assert_eq!(provider.calls(), 1);

        // Cached audio is usable even without credentials.
        let without_provider = cache
            .ensure(None::<&CountingProvider>, &stored, &settings, false)
            .await
            .unwrap();
        assert_eq!(without_provider.outcome, AudioOutcome::Cached);

        // Changed voice settings make the file stale and trigger regeneration.
        let faster = Settings {
            speaking_rate: 20,
            ..Settings::default()
        };
        assert_eq!(cache.status(&stored, &faster), AudioStatus::Stale);
        let regenerated = cache
            .ensure(Some(&provider), &stored, &faster, false)
            .await
            .unwrap();
        assert_eq!(regenerated.outcome, AudioOutcome::Generated);

        // Forced regeneration always calls the provider.
        let current = item(Some(regenerated.cache_key));
        cache
            .ensure(Some(&provider), &current, &faster, true)
            .await
            .unwrap();
        assert_eq!(provider.calls(), 3);
    }

    #[tokio::test]
    async fn missing_provider_is_an_error_when_audio_is_needed() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AudioCache::new(LessonFiles::new(dir.path().to_path_buf()));
        let error = cache
            .ensure(
                None::<&CountingProvider>,
                &item(None),
                &Settings::default(),
                false,
            )
            .await
            .err()
            .unwrap();
        assert!(matches!(
            error,
            AppError::MissingSpeechCredentials(TtsProviderKind::Azure)
        ));
    }
}
