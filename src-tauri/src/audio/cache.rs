//! One MP3 per dictation item, kept until the learner regenerates it. Changing
//! the provider or voice settings only affects audio generated afterwards, so
//! audio made with an earlier voice stays the item's audio.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::lesson::files::LessonFiles;
use crate::lesson::DictationItem;
use crate::settings::Settings;
use crate::tts::{TtsProvider, TtsProviderKind, TtsRequest};

/// Bump when the key recipe changes, so keys made with different recipes never match.
const CACHE_KEY_VERSION: &str = "v1";

/// Speaking rate and pitch, in percent. They used to be settings, and older
/// versions of the app still hash them, so they stay in the recipe as 0.
const NORMAL_RATE: &str = "0";
const NORMAL_PITCH: &str = "0";

/// `SHA-256(version, text, voice, rate, pitch, output_format)` as lowercase
/// hex, followed by `provider, model` for providers other than Azure. Stored
/// with an item's audio as a record of the settings that made it.
///
/// Fields are separated by a control character that cannot appear in any of
/// them, so different field boundaries can never produce the same input.
pub fn cache_key(request: &TtsRequest) -> String {
    let mut fields = vec![
        CACHE_KEY_VERSION,
        request.text.as_str(),
        request.voice.as_str(),
        NORMAL_RATE,
        NORMAL_PITCH,
        request.output_format.as_str(),
    ];
    match request.provider {
        // Azure keys keep the recipe from before other providers existed.
        // Older versions of the app compare keys to decide whether imported
        // audio is current, so audio exported from here still is to them.
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

/// Whether an item has audio to play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioStatus {
    /// A file exists, whatever voice settings made it.
    Ready,
    /// No usable file.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioOutcome {
    /// The item already had audio, which is kept.
    Cached,
    /// New audio was written to `path`; `cache_key` records the settings that made it.
    Generated { path: String, cache_key: String },
}

#[derive(Clone)]
pub struct AudioCache {
    files: LessonFiles,
}

impl AudioCache {
    pub fn new(files: LessonFiles) -> Self {
        Self { files }
    }

    pub fn status(&self, item: &DictationItem) -> AudioStatus {
        if self.has_file(item) {
            AudioStatus::Ready
        } else {
            AudioStatus::Missing
        }
    }

    /// Whether the item has an audio file, whatever voice made it.
    pub fn has_file(&self, item: &DictationItem) -> bool {
        item.audio_path
            .as_deref()
            .is_some_and(|path| self.files.audio_exists(path))
    }

    /// Keeps the item's audio if it has any, otherwise synthesizes it with
    /// `provider` and the current `settings`. `force` always synthesizes,
    /// replacing the existing file. Without a provider only existing audio
    /// can be kept.
    pub async fn ensure<P: TtsProvider>(
        &self,
        provider: Option<&P>,
        item: &DictationItem,
        settings: &Settings,
        force: bool,
    ) -> AppResult<AudioOutcome> {
        if self.has_file(item) && !force {
            return Ok(AudioOutcome::Cached);
        }

        let provider = provider.ok_or(AppError::MissingSpeechCredentials(settings.tts_provider))?;
        let request = settings.tts_request(&item.text);
        let audio = provider.synthesize(&request).await?;
        let path = item
            .audio_path
            .clone()
            .unwrap_or_else(|| LessonFiles::audio_path(&item.lesson_id, item.position));
        self.files
            .write_audio(&path, &audio)
            .map_err(AppError::AudioNotSaved)?;
        Ok(AudioOutcome::Generated {
            path,
            cache_key: cache_key(&request),
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
            output_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        }
    }

    /// An item whose audio file has not been written yet.
    fn item() -> DictationItem {
        DictationItem {
            id: 1,
            lesson_id: "x".into(),
            position: 1,
            text: TEXT.into(),
            audio_path: Some(LessonFiles::audio_path("x", 1)),
            audio_cache_key: None,
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
    fn azure_keys_are_unchanged_for_older_app_versions() {
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

    #[tokio::test]
    async fn audio_is_kept_whatever_the_settings_until_it_is_regenerated() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AudioCache::new(LessonFiles::new(dir.path().to_path_buf()));
        let provider = CountingProvider::default();
        let azure = Settings::default();
        let elevenlabs = Settings {
            tts_provider: TtsProviderKind::ElevenLabs,
            ..Settings::default()
        };
        let item = item();
        assert_eq!(cache.status(&item), AudioStatus::Missing);

        let first = cache
            .ensure(Some(&provider), &item, &azure, false)
            .await
            .unwrap();
        let AudioOutcome::Generated { path, .. } = first else {
            panic!("expected new audio, got {first:?}");
        };
        assert_eq!(
            std::fs::read(dir.path().join(&path)).unwrap(),
            format!("mp3:{TEXT}").into_bytes()
        );
        assert_eq!(cache.status(&item), AudioStatus::Ready);

        // Switching providers keeps the audio, even without credentials.
        for settings in [&azure, &elevenlabs] {
            let kept = cache
                .ensure(Some(&provider), &item, settings, false)
                .await
                .unwrap();
            assert_eq!(kept, AudioOutcome::Cached);
        }
        let without_provider = cache
            .ensure(None::<&CountingProvider>, &item, &elevenlabs, false)
            .await
            .unwrap();
        assert_eq!(without_provider, AudioOutcome::Cached);
        assert_eq!(provider.calls(), 1);

        // Regenerating replaces it, made with the current settings.
        let regenerated = cache
            .ensure(Some(&provider), &item, &elevenlabs, true)
            .await
            .unwrap();
        assert_eq!(
            regenerated,
            AudioOutcome::Generated {
                path,
                cache_key: cache_key(&elevenlabs.tts_request(TEXT)),
            }
        );
        assert_eq!(provider.calls(), 2);
    }

    #[tokio::test]
    async fn missing_provider_is_an_error_when_audio_is_needed() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AudioCache::new(LessonFiles::new(dir.path().to_path_buf()));
        let error = cache
            .ensure(
                None::<&CountingProvider>,
                &item(),
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
