## English dictation and shadowing — one lesson, two ways to practice

Turn English articles, study notes or interview answers into listening and speaking practice.

- **Dictation:** listen, type what you hear, reveal the original and get word-by-word feedback. Answers save automatically so you can continue later.
- **Shadowing:** loop difficult passages with time to repeat aloud, then use **Play article** to read along with the whole text. Choose separate **Dictation** and **Shadowing** buttons on each lesson.
- **Shared audio:** generate speech with your own Azure Speech or ElevenLabs credentials. Both modes reuse locally cached clips.

**英语听写 + 跟读：**听写时边听边打、逐词纠错；跟读时先把难句反复读顺，再整篇连贯朗读。

## Download

Expand **Assets** and choose an installer, not a **Source code** archive. No Rust or Node.js installation is needed to use a desktop installer.

| Your computer | File |
|---|---|
| Mac (Apple Silicon or Intel) | `DictationApp_<version>_universal.dmg` |
| Windows x64 | `DictationApp_<version>_x64-setup.exe` or `.msi` |
| Linux x86_64 | `.AppImage`, `.deb` (Debian/Ubuntu) or `.rpm` (RPM-based systems) |

The installers are not code-signed yet:

- **macOS:** open the DMG and drag the app to Applications. If macOS blocks opening it, go to **System Settings → Privacy & Security → Open Anyway** after attempting to launch.
- **Windows:** if SmartScreen blocks this project's installer, click **More info → Run anyway**.
- **Linux AppImage:** make it executable (`chmod +x DictationApp_*.AppImage`), then run it. Compatibility depends on your system libraries.

## First practice

1. Open **Settings**, choose **Microsoft Azure Speech** (your Key + Region + Voice name) or **ElevenLabs** (your API key + Voice ID + Model), and click **Save**.
2. In **Lessons**, use **Paste text → Create lesson** or **Import .txt lesson**. Separate passages with a **blank line**; each block becomes one audio clip.
3. Audio generation starts automatically when credentials are configured. Use **Generate missing audio** if needed.
4. Choose **Dictation** to listen and type, or **Shadowing** to read aloud.
5. In Shadowing, use **Loop passage** and **Time to repeat aloud** for hard passages; use **Play article** once you are ready to read the whole text.

New audio requires internet access and uses your provider's quota or credits. Replaying current cached audio does not request synthesis again. Shadowing is self-directed practice, without recording or pronunciation scoring.

[English user guide](https://github.com/richardgong1987/DictationApp#quick-start) · [中文使用说明](https://github.com/richardgong1987/DictationApp/blob/main/docs/USER_GUIDE.zh-CN.md)
