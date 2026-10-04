# Set Up Text-to-Speech: Azure Speech and ElevenLabs

[README](../README.md) · [User guide](USER_GUIDE.md) · [Development](DEVELOPMENT.md)

This guide takes you from a provider account to your first working audio clip in DictationApp.
You only need **one** provider. The app uses your own credentials and provider allowance; it does
not supply a shared key or subscription. Desktop installer users do not need to install an SDK,
Python, Node.js or Rust to configure speech.

If you already imported a DictationApp ZIP with audio matching your current voice settings, you
can play those clips without a provider key. Follow this guide when you need to generate new audio.

## Choose a setup path

| | Microsoft Azure Speech | ElevenLabs |
|---|---|---|
| Account preparation | Azure account/subscription and a Speech resource | ElevenLabs account and API access |
| Fields in DictationApp | Region, Key, Voice name | API key, Voice ID, Model |
| App's default voice | `en-US-JennyNeural` | George: `JBFqnCBsd6RMkjVDRZzb` |
| App's default model | No model field | `eleven_multilingual_v2` |
| Synthesis controls | Speaking rate and pitch | Speaking rate |

Try one provider with a short sentence first. You can change providers later, but that can mark
existing audio as outdated and cause fresh synthesis.

## Microsoft Azure Speech

### 1. Create a Speech resource

1. Sign in to the [Azure portal](https://portal.azure.com/). If needed, create an Azure account
   and subscription using the [Azure account page](https://azure.microsoft.com/free/).
2. Open [Create a Speech resource](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices)
   or search the portal for **Speech**. Microsoft's current documentation also uses the name
   **Speech in Foundry Tools**.
3. Select your subscription and a resource group, enter a resource name, choose a supported region,
   and review the available pricing tier. Choose the free tier if it is offered and suits your needs;
   otherwise review the paid tier before creating the resource.
4. Complete creation and open the resource. In its **Keys and Endpoint** page, copy one resource
   key and note its region identifier. You can also check the region in the resource overview.

Use a key from this **Speech resource**, not your Microsoft account password, Azure subscription ID,
or an unrelated Azure OpenAI resource. The key and region must belong to the same resource.
See Microsoft's [Speech quickstart](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech?pivots=programming-language-rest)
and [REST authentication reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech).

### 2. Fill in DictationApp Settings

Open **Lessons → Settings → Text-to-speech → Provider → Microsoft Azure Speech**.

| App field | What to enter | Example |
|---|---|---|
| **Region** | Your Speech resource's region identifier, with no spaces or URL | `eastus` if the resource is in East US; `japaneast` if it is in Japan East |
| **Key** | One of the resource keys you copied | Your private resource key |
| **Voice name** | A supported voice's exact name | `en-US-JennyNeural` |
| **Speaking rate** | Leave at normal for the first test | `0%` |
| **Pitch** | Leave at normal for the first test | `0%` |

Do not copy the example region unless it matches your resource. Enter `japaneast`, for example,
rather than `Japan East` or an endpoint URL. DictationApp builds the regional endpoint itself;
there is no endpoint input. Its current Azure client uses the public Azure cloud's
`https://<region>.tts.speech.microsoft.com` endpoint, without a custom endpoint or sovereign-cloud selector.

Click **Save** and wait for **Saved.** Then click **Back**.

### 3. Pick an English voice

These are examples already suggested by the app:

| Accent | Voice names |
|---|---|
| American English | `en-US-JennyNeural`, `en-US-GuyNeural`, `en-US-AriaNeural`, `en-US-DavisNeural` |
| British English | `en-GB-SoniaNeural`, `en-GB-RyanNeural` |
| Australian English | `en-AU-NatashaNeural`, `en-AU-WilliamNeural` |

The voice input is editable. For another voice, copy its exact identifier from Microsoft's
[language and voice support list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts).
Use the [Voice Gallery](https://speech.microsoft.com/portal/voicegallery) to listen to samples.
Check regional availability and speech-control support before trying a different voice type.

### 4. Generate your first clip

Follow [the one-sentence test below](#test-your-configuration-with-one-sentence). You do not need
to generate an MP3 manually in the Azure portal and import it: DictationApp synthesizes and caches it.

## ElevenLabs

### 1. Get an API key

1. Sign in or create an account at [ElevenLabs](https://elevenlabs.io/).
2. Open the dashboard's [Developers → API Keys](https://elevenlabs.io/app/developers/api-keys).
3. Create a key, give it a recognizable name such as `DictationApp`, and copy the secret key into
   the app. If you restrict the key, allow **Text to Speech** requests. Check any key-specific
   credit limit and IP restrictions as well as your account's allowance.

Your API key is different from your account password and your Voice ID. Official instructions:
[API quickstart](https://elevenlabs.io/docs/eleven-api/quickstart) and
[API authentication](https://elevenlabs.io/docs/api-reference/authentication).

### 2. Get a Voice ID

For a first test, you can use the app's default George voice ID: `JBFqnCBsd6RMkjVDRZzb`.
To choose your own voice:

1. Browse the [Voice Library](https://elevenlabs.io/app/voice-library) and choose a voice available
   to your account. Add it to your voices if the service requires that step.
2. In **My Voices**, open the voice's **More actions** menu (three dots).
3. Choose **Copy voice ID** and paste that identifier into DictationApp.

Use the ID, not a display name such as `George`, and not the voice's webpage URL. The app accepts
letters and digits for this field. See ElevenLabs' official
[Voice ID instructions](https://help.elevenlabs.io/hc/en-us/articles/14599760033937-How-do-I-find-the-voice-ID-of-my-voices-via-the-website-and-API).

### 3. Fill in DictationApp Settings

Open **Lessons → Settings → Text-to-speech → Provider → ElevenLabs**.

| App field | What to enter | First-test value |
|---|---|---|
| **API key** | Your private key from the API Keys page | Your own key |
| **Voice ID** | The identifier copied from your voices | `JBFqnCBsd6RMkjVDRZzb` for George |
| **Model** | An exact text-to-speech model ID supported by your account | `eleven_multilingual_v2` |
| **Speaking rate** | Leave at normal for the first test | `0%` |

Click **Save**, wait for **Saved.**, then **Back**. ElevenLabs needs no Azure region or key.
The app has no voice-cloning workflow; select a voice already available in your ElevenLabs account.

### 4. Choose a model

The app defaults to `eleven_multilingual_v2`. It also suggests `eleven_flash_v2_5` and `eleven_v4`.
The field is editable: suggestions do not validate access, compatibility, pricing or availability.
Use the exact ID from the provider, not a marketing label such as `Multilingual v2`.

Start with the default before changing models. Check ElevenLabs'
[model guide](https://elevenlabs.io/docs/eleven-api/choosing-the-right-model) for current options.
A model change affects cache matching and can cause regeneration. If a model rejects a speech
setting, retry a short test at normal speaking rate with a compatible model.

## Test your configuration with one sentence

1. On **Lessons**, choose **Paste text**.
2. Enter a title such as `Voice setup test` and this single passage:

   ```text
   I can listen to this sentence and say it back.
   ```

3. Click **Create lesson**. If credentials are configured, audio generation starts automatically.
4. Wait for **Audio ready** and `audio 1/1 ready`. If generation did not start, click
   **Generate missing audio**.
5. Open **Shadowing** and click **Play** to hear the sentence. Try replaying it and **Loop passage**.

**Credentials are configured** or **API key is configured** means required credential fields are
present; it is not a successful provider authentication test. **Saved.** confirms a local settings
save. Successful synthesis and playback are the practical check that your configuration works.

If you change providers or voices while testing, use **Generate missing audio** on this test lesson.
It updates an outdated clip. **Regenerate** forces a fresh request even if a clip is already ready.

## Quota, cost and repeated practice

Generating new audio uses your selected provider's allowance. Replaying a ready, unchanged cached
MP3—including loops and slower/faster player playback—does not request synthesis again.

| Action | Synthesis behavior |
|---|---|
| Replay, loop, seek, or change player **Speed** for ready audio | Uses the local clip |
| **Generate missing audio** | Reuses ready clips; synthesizes missing/outdated clips |
| **Regenerate** / **Regenerate all** | Forces new synthesis |
| Change provider, voice, model or applicable synthesis rate/pitch, then practice | May synthesize replacements |
| Import a lesson ZIP | Copies existing audio; no synthesis during import |

Check your provider dashboard for remaining usage and renewal details. Free allowances, prices,
model credit rates and plan conditions can change; use the current
[Azure Speech pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/)
and [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) pages rather than assuming unlimited
free generation. Reusing audio across devices is covered in the
[lesson transfer guide](USER_GUIDE.md#transfer-lessons-and-audio).

## Troubleshooting

| Problem | What to do |
|---|---|
| **Text-to-speech is not configured** | Check the currently selected provider, fill in its credentials and click **Save**. Azure needs both Key and Region; ElevenLabs needs its API key. |
| Azure unauthorized / HTTP 401 | Recopy a Speech resource key and its matching region. Check whether the key was rotated. |
| Azure invalid region | Use the lowercase region identifier, not a friendly label or URL. |
| Voice/model error | Check the exact identifier, account access, regional availability for Azure, and model compatibility for ElevenLabs. Try the app defaults at `0%` rate. |
| ElevenLabs quota exceeded | Read the provider's error message and check account/key allowance. A quota error can appear as 401, so a new key alone may not solve it. |
| ElevenLabs access denied / HTTP 403 | Check Text to Speech scope, account/voice access and any IP allowlist on the key. |
| Too many requests / HTTP 429 | Let the provider's rate limit recover, then retry. The app retries transient failures with backoff and generates lesson clips sequentially. |
| Network or provider server failure | Check connectivity and retry. Cached ready clips remain usable locally. |
| **Voice changed** after editing Settings | The old clip exists but no longer matches. Generate missing audio to replace it, or return to the settings that created it. |
| Old voice still plays after a failed update | The player can fall back to an existing stale MP3 when synthesis fails. Inspect lesson detail and resolve the generation error before expecting the new voice. |
| A credential field is disabled | It is overridden by an environment variable. Update/remove that override and restart the app. |
| Audio ready but silent | Check system volume, output device and playback controls; this may be a playback issue rather than a credential issue. |

## Optional: environment variables for source builds

Most users should use the Settings screen. Developers can configure credentials with the app's
[`.env.example`](../.env.example) or launch environment:

```dotenv
AZURE_SPEECH_KEY=replace-with-your-speech-resource-key
AZURE_SPEECH_REGION=replace-with-your-resource-region
ELEVENLABS_API_KEY=replace-with-your-elevenlabs-api-key
```

Fill only the provider you use; remove/comment unused placeholder lines. A nonempty placeholder
counts as an override and prevents a valid in-app credential from taking effect. Select the provider
and voice/model in Settings separately.

DictationApp uses `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`, even though Microsoft's samples
may call them `SPEECH_KEY` and `SPEECH_REGION`. Environment credentials take precedence over in-app
values and are read at startup. `.env` is loaded from the working directory or app data directory;
see [development setup](DEVELOPMENT.md#run). Restart after changing credentials in that environment.

## Credentials and privacy

Keys entered in Settings are stored unencrypted in the device's local app data. Keep real keys out
of Git, screenshots and shared support messages. If a key is exposed, revoke/rotate it in the
provider dashboard and update your configuration. A lesson export ZIP excludes API credentials.

When synthesizing, the app sends passage text to the selected provider. Ready cached audio plays
locally. You can prepare a lesson on one device, export it with its audio, and import it on another
without sharing your API key.

Provider setup links were checked on 4 October 2026. If a dashboard label changes, follow its linked
official instructions; the DictationApp field names above come from this repository's implementation.
