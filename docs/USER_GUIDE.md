# DictationApp User Guide

[README](../README.md) · [Download](https://github.com/richardgong1987/DictationApp/releases/latest) · [Build from source](DEVELOPMENT.md)

Turn a text lesson into two kinds of practice: **Dictation** for listening and typing,
and **Shadowing** for listening and speaking. Both use the same per-passage MP3s.

## The idea behind the practice

The author built DictationApp around a simple belief: learn as a child does with their mother—she
says a sentence, and the child follows by saying it back. Being able to keep up with a sentence is,
in the author's words, “half the battle.” If speech passes before a learner can catch its words
and rhythm, it is hard to retain anything useful from it.

AI-generated speech makes it easy to turn the material you need into a spoken model. Cached audio
can then repeat as many times as you need, without anyone becoming tired or impatient. Use that
freedom to focus on the sentences you cannot yet follow or say, and practice through your bottlenecks.

Start with a short passage. Listen, repeat aloud, and use a slower speed or a repeat pause when
needed. Keep practicing until you can follow the whole sentence; then move to the next passage.
Use dictation to identify missed words and article playback to connect the passages into fluent
reading. This personal learning philosophy is the reason the project puts listening and
repeating one passage at a time at the center of the experience.

## Find your way around

| Screen | What you can do |
|---|---|
| **Lessons** | See the selected TTS provider and each lesson's item/audio counts. Paste text, import a `.txt`, rename/delete lessons, or enter either practice mode directly. Scroll to **Your other devices** for ZIP transfer. |
| **Lesson detail** | Click a lesson title in the library. Read passages, inspect word counts and audio badges, generate audio, and see attempt counts/best accuracy. Click the heading to rename; click a passage's **▶** to start dictation at that item. |
| **Dictation** | Listen, type, reveal/check, and review word differences. All items appear as cards; the active card has an accent border and highlighted number. Untouched inactive cards keep their answer boxes collapsed. |
| **Shadowing** | Use the article player at the top or a passage's own player. Show/hide all text, choose playback speed, and leave time to repeat a looping passage aloud. |
| **Settings** | Choose the TTS provider and its credentials, voice and synthesis settings. Click **Save** and wait for **Saved.**; **Back** returns to the screen you came from. |

The layout uses the available window width, wraps controls on smaller screens, and follows the
system's light/dark appearance. Original text and typed answers use distinct green backgrounds.
Their position, labels and controls identify them in either theme.

## Practice a language other than English

English is the default voice and the focus of the examples, but lesson text is not restricted to
English. French, Spanish, Japanese, German and many other provider-supported languages can use the
same basic method: listen to a sentence and repeat it until you can keep up.

Paste or import UTF-8 text in your target language, with blank lines between passages. In Settings,
choose an Azure voice for that language or an ElevenLabs multilingual model and suitable voice.
Save, then generate the audio. See the [voice examples and setup steps](TTS_SETUP.md#practice-in-other-languages).
There is no lesson-language dropdown and changing the voice does not translate text or localize the
English interface. Voice settings apply across the app, so changing them can make other lessons'
audio outdated.

Playback, passage looping, repeat pauses and article playback work as usual. Dictation accepts the
text, but its word counts, long-passage warning and word-level diff use whitespace-separated tokens.
Japanese and other languages without word spaces therefore do not receive meaningful per-word
segmentation. Use shadowing for listening/speaking practice and interpret dictation scores with that
limitation in mind.

## Add a lesson

Choose **Paste text**, enter your text and an optional title, then **Create lesson**. A blank title
is derived from the text's opening words. Alternatively, **Import .txt lesson** reads a UTF-8 file
and uses its filename as the title. [Example lesson](../examples/lesson01.txt).

Separate passages with a blank line:

```text
I should have told you earlier.

The meeting has been moved to Friday afternoon.

If I had known about the problem, I would have called you.
```

Each block becomes one item and one MP3. A whitespace-only line also separates blocks. Ordinary
line breaks inside a block are joined with spaces; periods do not split passages. Empty blocks are
ignored, and a lesson with no passages is rejected. More than 30 words is a recommendation warning,
not an import limit.

Creating a lesson opens its detail screen and starts generating audio if credentials are configured.
You can add text without credentials and prepare the audio later. Editing the original `.txt` after
import does not update the stored lesson. The app supports renaming, but has no passage text editor.

## Configure and prepare audio

For account creation, getting keys/Voice IDs, a first audio test, and provider troubleshooting,
follow the [Azure Speech and ElevenLabs setup guide](TTS_SETUP.md).

If you imported a ZIP whose audio matches your voice settings, you can replay it without API keys.
For new audio, open **Settings → Text-to-speech → Provider** and configure one provider:

| Provider | Required settings | Speech controls |
|---|---|---|
| **Microsoft Azure Speech** | Speech resource **Key**, matching **Region**, **Voice name** (default `en-US-JennyNeural`) | Speaking rate −50% to +100%; pitch −50% to +50% |
| **ElevenLabs** | **API key**, **Voice ID** (default George: `JBFqnCBsd6RMkjVDRZzb`), **Model** (default `eleven_multilingual_v2`) | Speaking rate −30% to +20%; no pitch control |

Voice/model suggestions are editable inputs, not an exhaustive list or a guarantee of availability
in your provider account. Enter a voice/model supported by that account. Switching providers clamps
the speaking rate to the new provider's supported range. Click **Save** before leaving Settings.

Keys entered in Settings are stored unencrypted in local app data. Environment variables override
the corresponding credential fields; overridden inputs are disabled. See
[credential setup](DEVELOPMENT.md#run) if you launch the app with environment variables.

### Audio badges and generation controls

| Label or control | Meaning |
|---|---|
| **Audio ready** | A local MP3 exists and matches the current text and synthesis settings. |
| **Voice changed** | A local MP3 exists, but its settings no longer match. It is excluded from the ready count. |
| **No audio** | No audio file is available for this passage. |
| **Generating…** | This passage's audio is being generated. |
| **Generate missing audio** | Reuses ready clips and generates missing or outdated clips. |
| **Regenerate** on a passage | Forces fresh synthesis for that passage, even if it is ready. |
| **Regenerate all** | After confirmation, forces fresh synthesis for every passage. |

Generation shows progress and then counts of generated, cached and failed clips. If some fail,
fix the credentials, connection or quota problem and run **Generate missing audio** again; ready
clips are reused. Clips are generated sequentially.

**Player Speed** changes local playback without provider requests. **Speaking rate**, voice,
provider, ElevenLabs model, and Azure pitch affect synthesis/cache matching. There is one stored
MP3 per item; regenerating replaces that item's clip rather than keeping several voice versions.

Opening Dictation loads and starts the active item's audio. Playing a missing or outdated clip
can trigger synthesis. If updating an outdated clip fails, the player falls back to its existing
MP3; a missing clip has no fallback. For predictable offline practice, prepare all clips with the
settings you intend to keep before disconnecting.

## Practice dictation

1. Open **Dictation** from a lesson card or detail page. It resumes at the last answered item,
   or the next item if that answer was checked. The lesson detail's **▶** starts at a chosen item.
2. Listen to the active item. Click another card's **Play** or replay button to activate it and
   start its audio. Its answer box appears; original text stays hidden until checked.
3. Type what you hear. Use play/pause, replay, previous/next, the active card's seek bar, **Loop**,
   and playback speed as needed. Speed and loop are shared across dictation cards and saved for
   later visits; only the active card shows current playback progress.
4. Click **Show original text** or press **Enter** to check and reveal. The answer becomes read-only.
5. Review the original, accuracy and word chips. Click **Hide original text** to edit again, or
   press **Enter** again to move forward. On the final item, Enter leaves you there.

Untouched inactive cards stay compact. Cards with an answer or revealed result keep their answer
area visible. The screen scrolls the active card into view.

### Understand the score

Case, repeated whitespace and surrounding punctuation are ignored; curly apostrophes are normalized.
Articles, prepositions, word endings and other meaningful words count. Internal apostrophes and
hyphens remain meaningful: this is word comparison, not semantic grading.

| Feedback | Meaning |
|---|---|
| Correct | A matching word in the aligned sequence. |
| Incorrect/changed | An expected word paired with a different typed word. |
| Missing | An expected word was omitted. |
| Extra | A typed word has no corresponding expected word. |

Accuracy is `matching words / max(source word count, answer word count)`. For example,
“I should told you early.” against “I should have told you earlier.” has four matching words out
of six: approximately 67%. Extra words also lower accuracy.

The header shows the number of checked items and their average accuracy. Per-item best accuracy
and attempt counts are available on lesson detail. Revealing an unchanged, already checked answer
does not record another attempt. Replay counts describe this visit's playback actions, not a
lifetime count of every automatic loop.

### Saved answers and starting again

Typing saves a draft after a 0.5-second pause; pending drafts are also saved when leaving the
practice screen. Checked answers reopen with the original/result visible. Clearing an individual
answer's text removes its saved answer. **Clear answers** asks for confirmation, clears all saved
answers in that lesson and returns to the first item, while retaining attempt history and statistics.

### Keyboard shortcuts

| Action | Outside a text field | In the answer box |
|---|---|---|
| Play/pause | Space | Ctrl/⌘ + Space |
| Replay from the start | R | Ctrl/⌘ + R |
| Previous/next item | ← / → | Ctrl/⌘ + ← / → |
| Toggle loop | L | Ctrl/⌘ + L |
| Faster/slower | ↑ / ↓ | Ctrl/⌘ + ↑ / ↓ |
| Check/reveal, then next item | Enter | Enter |
| Line break | — | Shift + Enter |
| Leave the answer box | — | Esc |

Shortcuts control the active item. A focused button keeps its own Enter/Space behavior. These are
Dictation shortcuts; Shadowing uses its visible player controls.

## Practice shadowing

Text starts visible. Click a passage's **Play** to practice it alone, or its replay icon to restart.
Enable **Loop passage** and choose **Time to repeat aloud**:

| Option | Between repetitions |
|---|---|
| **No pause** | The passage repeats immediately. |
| **3 seconds** | Three seconds to speak. |
| **5 seconds** | Five seconds to speak. |
| **Match passage length** | Time based on the clip's duration at the selected playback speed. |

During the pause, **Your turn** replaces the timeline with a countdown. The passage's play/pause
control also pauses/resumes this turn. Use the seek bar while audio is available, or replay to
start over. **Speed** offers 0.60×, 0.75×, 0.90×, 1.00×, 1.10× and 1.25×, as in Dictation.

For fluent continuous reading, choose **Play article**. It plays passages in order, scrolls to the
current passage, and offers **Pause/Resume**, **Restart**, and **Loop article**. The deliberate
repeat-aloud pause applies only to passage looping; article playback does not insert it.

Starting a passage switches away from article playback and vice versa. They share one player and
cannot overlap. **Hide text / Show text** applies to all passages. A failed passage or article shows
**Retry**. Leaving the screen stops playback and repeat timers.

Shadowing does not record your voice, transcribe speech, score pronunciation, or change dictation
answers/statistics. Its speed, pause and loop choices last for the current visit.

## Transfer lessons and audio

### Export on the source device

1. Prepare the desired audio first if you want every passage available offline.
2. On **Lessons**, scroll to **Your other devices → Export all lessons**. This exports the entire
   library; there is no single-lesson selection.
3. On desktop, choose the ZIP destination. On iOS it goes to the app's Documents folder. On iPhone,
   open **Files → On My iPhone → DictationApp** to find it.
4. Send the file to the other device, for example via AirDrop or a file-sharing service.

The default filename is `DictationApp lessons YYYY-MM-DD.zip` (the date is based on UTC). On iOS,
exports use that fixed location/name for the day rather than asking for a destination; keep a
separate copy or rename an export if you want multiple snapshots from the same day.

### Import on the destination device

1. Choose **Your other devices → Import lessons** and select the ZIP directly, without unzipping it.
2. Read the result: new lessons, audio files added, and existing lessons kept. **Nothing new to import**
   means the archive supplied no missing lessons or audio.
3. If **Different voice settings** appears, decide whether to **Switch** or **Keep current settings**.
   Switching applies the source device's synthesis settings across this app, retaining your local
   credentials and player preferences. Other local clips may become outdated as a result.
4. Check the ready counts before practicing offline. Ready imported audio needs no API key to play.

Import itself does not call a TTS provider. Lessons match by ID, not title or text. Existing titles,
text, audio, answers and statistics are retained. Missing audio is filled only when the passage
position and text match. Reimporting the same ZIP adds only what is still missing, including after
an interrupted import. Separately importing the same `.txt` creates another lesson with a new ID,
so matching titles do not prevent duplicates. Renames and deletions do not synchronize between devices.

### What travels in the ZIP

| Included | Not included |
|---|---|
| Lesson IDs, titles, original creation dates and source text | Saved answers, attempts, replay history and practice statistics |
| Passage positions/text and existing MP3s with cache keys | API keys, Azure region, environment variables and original file paths |
| Source device's provider, both providers' voice choices, ElevenLabs model, speaking rate and pitch | Dictation playback speed and loop preference |

The export includes existing clips regardless of whether they match the source device's current
settings; passages with no audio remain text-only. The manifest carries the source device's current
voice settings, not a separate voice description for each clip. A library with mixed or older voices
may therefore still contain outdated clips after **Switch**. Ready counts are the check to use;
regeneration uses the destination device's provider credentials and quota.

This transfer is a portable lesson/audio pack, not a complete backup of your practice progress.
It accepts DictationApp lesson ZIPs, not arbitrary audio recordings, generic ZIPs or standalone
MP3/WAV files. You can extract a copy of the ZIP to access its per-passage MP3s in other tools,
but there is no combined whole-article audio export.

## Troubleshooting and local data

| Situation | What to check |
|---|---|
| Text-to-speech is not configured | Configure the selected provider if new audio is needed. A matching imported/cached MP3 can still play. |
| Audio count is lower than the passage count | Inspect **No audio** and **Voice changed** in lesson detail. Generate missing audio or align the voice settings. |
| No sound or playback failure | Check system volume/output, then **Retry**. For missing/outdated audio, also check credentials, internet and provider quota. |
| ZIP import is rejected | Select an intact DictationApp export ZIP, not its extracted directory or another kind of archive. If it was made by a newer export format, update the receiving app. |
| Import stopped halfway | Resolve the reported error and import the same ZIP again. Already added lessons/audio are kept. |
| Export contains fewer MP3s than passages | Only files already on the source device are exported. Generate missing audio there and export again. |
| Imported audio still triggers synthesis | Check the selected provider/voice/model/rate/pitch and whether the source pack contained mixed voices. Switching settings may not make every clip ready. |

Lessons, MP3s, answers, settings and statistics live in this device's app data folder, with SQLite
holding the records. There are no app accounts or automatic cloud synchronization. Synthesis sends
passage text to the selected provider and uses its quota; replaying ready audio is local.

**Rename** changes the app's title only. **Delete**, after confirmation, removes the lesson, its
local audio, saved answers and practice history. It leaves the original imported `.txt` and any
previously exported ZIP untouched.
