# Development and implementation

[Back to README](../README.md) · [Original V1 specification](V1-SPECIFICATION.md)

These instructions are for building from source. Installer users can follow the [README](../README.md#quick-start).

## Build from source

### Prerequisites

- [Rust](https://rustup.rs/) (stable, 1.77+)
- Node.js 20+ (22.18+ to run `pnpm test`, which uses Node's built-in TypeScript support) and
  pnpm 10 (`corepack enable pnpm`)
- Tauri system dependencies for your OS — see <https://v2.tauri.app/start/prerequisites/>
  (on Debian/Ubuntu: `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`)
- A Microsoft Azure Speech resource (key + region), or an ElevenLabs API key

### Run

```bash
pnpm install
cp .env.example .env        # then put your Azure key/region or ElevenLabs key in .env
pnpm tauri dev
```

Pick the text-to-speech provider (Azure Speech or ElevenLabs) in the app's **Settings** screen.
Credentials are resolved in this order:

1. `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` and `ELEVENLABS_API_KEY` environment variables
   (a `.env` file in the working directory or in the app data directory is loaded at startup);
2. keys entered in the app's **Settings** screen (stored unencrypted in the local app data folder).

### Build an installer

```bash
pnpm tauri build
```

On a Mac, `./package.sh` builds just the universal `.dmg` (Apple Silicon and Intel);
`./package.sh --native` builds one for the current Mac only, which is faster.

`./package.sh --ios` builds a signed `.ipa` for iPhone and iPad, and `./package.sh --ios-simulator`
an unsigned app for the iOS Simulator. Both need Xcode's iOS platform
(`xcodebuild -downloadPlatform iOS`) and `brew install cocoapods xcodegen`. `--ios` signs for the
team of your Apple Development certificate; if you have certificates from several teams, set
`APPLE_DEVELOPMENT_TEAM` to one (Xcode → Settings → Accounts). The Xcode project lives in
`src-tauri/gen/apple`; the first iOS build generates it.

`./install-ios.sh` builds the `.ipa`, installs it on the iPhone connected to this Mac and opens it.
The first time, turn on Developer Mode on the iPhone (Settings → Privacy & Security), and after the
install trust your certificate (Settings → General → VPN & Device Management). With a free Apple
account the app stops opening after 7 days; run the script again to sign it anew.

### Publish a release

Push a version tag, or publish a release with such a tag on GitHub:

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` then builds the macOS, Windows and Linux installers, attaches them to
the release for that tag and publishes it once every build has succeeded. The version comes from the
tag, which must look like `v1.2.3`. A new release gets the download instructions in
`.github/release-notes.md` as its description.

### Tests and checks

```bash
cargo test --manifest-path src-tauri/Cargo.toml     # parsing, cache keys, TTS requests, answer comparison, database, export/import, IPC commands
pnpm build                     # TypeScript type check + frontend build
pnpm test                      # shadowing player: modes, repeat pause, switching, cleanup
```

## Implementation Notes

Decisions made while implementing V1, where the specification left room:

- **Wrapped lines**: lines inside one passage (no blank line between them) are joined with a single space.
- **Audio delivery**: Rust returns an item's MP3 bytes over IPC (`get_item_audio`); the frontend plays them
  through a `Blob` URL with a regular `HTMLAudioElement`. No asset-protocol scope is needed, and all
  playback state (pause, seek, loop, speed) stays in the WebView. The CSP in `tauri.conf.json` must
  keep `connect-src ipc: http://ipc.localhost`: without it Tauri falls back to its postMessage IPC,
  which hands the MP3 over as an array of numbers instead of an `ArrayBuffer`, and installed builds
  play no audio (dev builds apply no CSP, so they still work).
- **Cache key**: `SHA-256("v1", text, voice, rate, pitch, output_format)`, fields separated by `0x1F`;
  ElevenLabs keys append `"elevenlabs", model`. Azure keys deliberately keep the original recipe so
  audio generated before ElevenLabs support stays current. Audio is stored as
  `lessons/<lesson-id>/audio/NNN.mp3` and the key is saved with the item. If the provider or voice
  settings change, the item shows "Voice changed" and is regenerated on the next generation or
  practice. There is one file per item, so switching providers back and forth means regenerating.
- **Azure**: REST endpoint `https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`, output
  `audio-24khz-48kbitrate-mono-mp3`.
- **ElevenLabs**: REST endpoint `https://api.elevenlabs.io/v1/text-to-speech/<voice-id>`, output
  `mp3_44100_128`, model `eleven_multilingual_v2` by default. The speaking rate maps to
  `voice_settings.speed` (0.7–1.2, so −30% to +20%); pitch is not supported and ignored. At normal
  speed `voice_settings` is left out so the voice keeps its own settings.
- Both providers retry with backoff on network errors, 429 and 5xx (`tts/http.rs`). Lesson generation
  runs one item at a time to stay within free-tier rate limits.
- **Answer comparison** is implemented in Rust (`practice/comparison.rs`): case and surrounding punctuation are
  ignored, curly apostrophes are normalized, and every word counts. The diff is an LCS over words;
  missing and extra words between two matches are paired as "changed". Accuracy is
  `correct words / max(source words, answer words)`.
- **Settings** (TTS provider, each provider's voice, TTS rate/pitch, player speed/loop, optional
  credentials) are stored as JSON in the SQLite `settings` table. The Azure voice used to be stored as
  `voice`; that name is still read.
- `metadata.json` in each lesson folder is written for readability; SQLite (`dictation.db` in the app
  data directory) is the source of truth.
- **Saved answers**: the latest answer to each item is kept in the `answers` table (schema v2), exactly
  as typed, with a status: `draft` (typed or edited since its last check) or `checked`. Typing saves a
  draft once it pauses for half a second; "Show original text" saves it as checked, in the same
  transaction as the attempt. Clearing the text deletes the saved answer, and "Clear answers" in the
  practice header deletes all of a lesson's answers (attempts are kept). The result of a checked answer
  is recomputed when the lesson is opened rather than stored. `attempts` stays the full history of
  checks behind the statistics.
- **Resuming**: opening practice without choosing an item continues with the item answered last, or the
  next one if that answer is already checked (`practice::resume_item_id`).
- **Schema upgrades** run at startup, in order, recorded in `PRAGMA user_version` (`database.rs`).
- **Credentials** from `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` / `ELEVENLABS_API_KEY` are read once
  at startup and passed to the settings service; no business code reads environment variables.
- **Moving lessons between devices** (`transfer/`): **Export all lessons** writes one `.zip` holding
  `manifest.json` (format, version, the exporting device's voice settings, every lesson with its text
  and items) and `audio/<lesson-id>/NNN.mp3` for each item that has audio, with the cache key it was
  made with. Entries are stored uncompressed. Import recognizes lessons by id and only adds: a lesson
  already present keeps everything and only gets audio for items that have none, matched by position
  *and* text. Importing a file twice therefore adds nothing, and importing it again completes an import
  that failed halfway. Imported lessons keep their creation time and have no `source_path`. Imported
  audio whose cache key does not fit this device's settings is counted (`audioWithOtherVoice`), and the
  library offers to apply the exporting device's `VoiceSettings`, whose field names match `Settings`.
  Lesson ids in the manifest must be UUIDs, since they name folders.
- **Exports on iOS** go to the app's Documents folder, which `src-tauri/Info.ios.plist`
  (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`) shows in the Files app. The dialog
  plugin's iOS save dialog only exports an empty placeholder and returns a location outside the
  sandbox that needs security-scoped access to write to. The frontend knows it runs on iOS from
  `import.meta.env.TAURI_ENV_PLATFORM`, which the Tauri CLI sets when it builds the frontend (`envPrefix`
  in `vite.config.ts`).

### Code layout

The backend is grouped by feature. Inside a feature, `mod.rs` holds its types and rules,
`repository.rs` its SQL, and `service.rs` its workflows. Commands stay thin: they unpack arguments
and call one service.

```text
src-tauri/src/
├── lib.rs            startup: .env, database, AppState, command registration
├── app_state.rs      composition root: builds every repository and service once
├── commands.rs       the IPC surface (mirrored by src/api/client.ts)
├── database.rs       SQLite connection and schema
├── error.rs          AppError; each variant's text is what the user sees
├── lesson/           Lesson, DictationItem, response shapes
│   ├── parser.rs       blank-line splitting (the lesson text format)
│   ├── files.rs        lessons/<id>/{source.txt, metadata.json, audio/NNN.mp3}
│   ├── repository.rs   lessons + dictation_items tables
│   └── service.rs      add (from a file, pasted text or another device), list, detail, delete
├── audio/            generation summary/progress types
│   ├── cache.rs        cache key, Ready/Stale/Missing, reuse-or-synthesize
│   └── service.rs      lesson/item generation, one run per lesson at a time
├── practice/         ItemStats, CheckResult
│   ├── comparison.rs   normalization + LCS word diff
│   ├── repository.rs   attempts table + per-item stats
│   └── service.rs      check an answer and record the attempt
├── settings/         Settings, VoiceSettings, sanitizing, credential precedence
│   ├── repository.rs   settings stored as one JSON row
│   └── service.rs      load/save, player preferences, credentials
├── transfer/         ExportSummary, ImportSummary
│   ├── archive.rs      the export file: manifest.json and audio/<lesson-id>/NNN.mp3 in a zip
│   └── service.rs      export every lesson; import only what this device lacks
└── tts/              TtsProvider trait, TtsRequest, provider choice (TtsProviderKind, TtsClient)
    ├── azure.rs        Azure REST client, SSML
    ├── elevenlabs.rs   ElevenLabs REST client
    └── http.rs         request retries with backoff, shared by both
```

The frontend keeps a screen's helpers next to the screen; only code shared by several screens
lives outside `screens/`.

```text
src/
├── App.tsx           route → screen
├── navigation.ts     Route type
├── api/              typed command wrappers, response types, constants shared with Rust
├── audio/            item MP3s as Blob URLs and clip lengths, shared by dictation and shadowing
├── components/       ErrorBanner, LoadingPage, EyeIcons
├── format.ts         time/speed/percent formatting
└── screens/
    ├── library/      LibraryScreen, LessonTransfer (export and import between devices)
    ├── SettingsScreen.tsx
    ├── lesson/       LessonScreen, item row, audio generation hook and status
    ├── shadowing/
    │   ├── ShadowingScreen.tsx       loads the lesson
    │   ├── ShadowingSession.tsx      article player on top, one row per passage
    │   ├── ArticlePlayer.tsx         play the whole article, restart, loop
    │   ├── PassageRow.tsx            one passage: its player, "Your turn" countdown, text
    │   ├── shadowingPlayer.ts        the one player: article and passage modes, repeat pause
    │   └── useShadowingPlayer.ts     creates it, renders its state, stops it on leaving
    └── practice/     dictation
        ├── PracticeScreen.tsx        loads the lesson and player preferences
        ├── PracticeSession.tsx       all items as cards; wires player, answers and shortcuts
        ├── PracticeItemCard.tsx      one item: player row, original text, answer, feedback
        ├── PlayerPanel.tsx           audio controls of one card
        ├── AnswerResult.tsx          score and word chips (DiffView.tsx) of a checked answer
        ├── useAudioPlayer.ts         the one HTMLAudioElement: play, seek, loop, speed
        ├── useCurrentItemAudio.ts    loads the current item's audio into the player
        ├── usePracticeProgress.ts    each item's answer: saved as typed, checked, revealed, hidden
        └── usePracticeShortcuts.ts   key → command table
```

The practice screen shows every item as a card, but there is one audio player: the current card
(blue border) is the one loaded in it and the one the keyboard shortcuts act on. "Show original
text" checks the answer before revealing it; hiding it again makes the answer editable, and showing
it again re-checks only if the answer changed. Answers are kept between sessions, and "Dictation"
continues where you stopped; the ▶ on an item in the lesson screen starts from that item instead.

The shadowing screen uses the same items and cached audio but keeps nothing: no answers, no
statistics, and its speed and pause choices last for the visit only. One `ShadowingPlayer` owns its
single audio element and the "Your turn" timer, so the article and a looping passage never overlap,
and leaving the screen stops both.

---