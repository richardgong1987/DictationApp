# Development and implementation

[Back to README](../README.md) · [User guide](USER_GUIDE.md) · [Original V1 specification](V1-SPECIFICATION.md)

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

For provider account and voice configuration, see the [TTS setup guide](TTS_SETUP.md).

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
pnpm test                      # shadowing: player modes, sentences and phrases, repeat pause, cleanup
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
- **Cache key**: `SHA-256("v1", text, voice, "0", "0", output_format)`, fields separated by `0x1F`;
  ElevenLabs keys append `"elevenlabs", model`. The two `"0"` fields are where speaking rate and
  pitch used to go (`TtsRequest` no longer has either), so keys are identical to the ones older
  versions compute for default settings. Azure keys keep the original recipe, because older
  app versions still compare keys to decide whether imported audio is current. Audio is stored
  as `lessons/<lesson-id>/audio/NNN.mp3`, and the key is saved with the item (`audio_cache_key`, also
  in `metadata.json`) as a record of the settings that produced the clip. It is not compared with
  the current settings: an item is ready when its MP3 exists, whatever made it, so changing the
  provider or voice settings only affects audio generated afterwards. Only Regenerate / Regenerate
  all replace an existing clip, using the current settings; there is one file per item, so
  regenerating overwrites it.
- **Azure**: REST endpoint `https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`, output
  `audio-24khz-48kbitrate-mono-mp3`. The SSML has no `<prosody>` element, so the voice speaks at its
  normal rate and pitch.
- **ElevenLabs**: REST endpoint `https://api.elevenlabs.io/v1/text-to-speech/<voice-id>`, output
  `mp3_44100_128`, model `eleven_multilingual_v2` by default. Requests send no `voice_settings`, so
  the voice speaks with the settings saved with it in the ElevenLabs account.
- **Speed**: the player's speed (0.6×–2×) is the only speed control; it changes local playback
  and never calls the provider.
- Both providers retry with backoff on network errors, 429 and 5xx (`tts/http.rs`). Lesson generation
  runs one item at a time to stay within free-tier rate limits.
- **Answer comparison** is implemented in Rust (`practice/comparison.rs`): case and surrounding punctuation are
  ignored, curly apostrophes are normalized, and every word counts. The diff is an LCS over words;
  missing and extra words between two matches are paired as "changed". Accuracy is
  `correct words / max(source words, answer words)`.
- **Settings** (TTS provider, each provider's voice, ElevenLabs model, player speed/loop, optional
  credentials) are stored as JSON in the SQLite `settings` table. The Azure voice used to be stored as
  `voice`; that name is still read. A speaking rate or pitch saved by an older version is ignored on
  load; clips made with it are kept until regenerated.
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
  audio is used as it is, whatever voice made it; import never changes this device's settings.
  Lesson ids in the manifest must be UUIDs, since they name folders.
- **Exports on iOS** go to the app's Documents folder, which `src-tauri/Info.ios.plist`
  (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`) shows in the Files app. The dialog
  plugin's iOS save dialog only exports an empty placeholder and returns a location outside the
  sandbox that needs security-scoped access to write to. The frontend knows it runs on iOS from
  `import.meta.env.TAURI_ENV_PLATFORM`, which the Tauri CLI sets when it builds the frontend (`envPrefix`
  in `vite.config.ts`).
- **Imports on iOS**: the dialog plugin's iOS open dialog copies the chosen file into the app's sandbox
  and returns a percent-encoded `file://` URL rather than a path, so the import commands accept both
  (`picked_file_path` in `commands.rs`).

### Lesson archive contract and playback caveats

The current archive format is `dictation-app-lessons`, version `1`, implemented in
`transfer/archive.rs`. `manifest.json` uses camelCase fields: `format`, `version`, `voice`, and
`lessons`; each lesson has `id`, `title`, `createdAt`, `sourceText`, and `items`; each item has
`position`, `text`, and nullable `audioCacheKey`. Audio entries are
`audio/<lesson-id>/<position padded to three digits>.mp3`. A null key means that no audio for that
item was exported. API credentials, region, source paths, answers, attempts and player preferences
are absent. This is not a database backup.

Export copies every existing audio file, whatever settings made it. `voice` holds the exporting
device's provider, voices and model, plus `speakingRate: 0` and `pitch: 0`; it is still written,
with those two fields, because older app versions refuse a manifest without them, but the app no
longer reads it. An item's `audioCacheKey` records the settings
that produced its clip (a hash, not recoverable voice metadata); its presence marks that the
archive carries that clip. Import only matches IDs, and fills audio only where local audio is
absent and position/text match; it never replaces an existing clip, and imported clips are used
as they are.

Import is incremental across lessons/audio files rather than one transaction for the whole pack.
An error can leave some content successfully imported; reimport fills the remaining gaps. The
reader checks the format/header, rejects newer format versions and non-UUID lesson IDs, and reads
named audio entries without extracting the ZIP as a directory.

`src/audio/itemAudio.ts` synthesizes a missing item before returning its bytes, and fails if that
synthesis fails. A ready item is returned as it is, whatever settings made it, and requires no
credentials. `useCurrentItemAudio` loads and starts the active dictation item on entry/item change,
so opening practice on a missing item can itself trigger synthesis. Duration probes skip missing
items, avoiding synthesis just to display a length.

See the [user transfer instructions](USER_GUIDE.md#transfer-lessons-and-audio) for the UI workflow.

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
│   ├── cache.rs        cache key, Ready/Missing, reuse-or-synthesize
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
    │   ├── useShadowingPlayer.ts     creates it, renders its state, stops it on leaving
    │   ├── passageSegments.ts        cuts a passage into sentences or phrases at the audio's pauses
    │   └── usePassageTimings.ts      decodes each passage's audio to find those pauses
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

Practising by sentence or phrase needs no extra TTS requests and no timestamps from the provider.
`usePassageTimings` decodes each passage's cached MP3 with Web Audio and `findPauses` lists its
silences. `segmentPassage` splits the text at sentence ends (and, for phrases, at commas, semicolons,
colons and dashes) and matches each boundary to a pause near where its share of the letters puts
it. A pause must last as long as saying about 2.5 letters at that passage's measured speaking rate,
so the closures inside words like "act" never count, at any speed. Boundaries without a pause are
dropped, so a clip never starts or stops inside a word. The player then plays a passage as a list of
clips (one clip when practised whole) and stops each one with a timer that it checks against the
audio's position.

---