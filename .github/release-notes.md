## Download

| Your computer | File |
|---|---|
| Mac (Apple Silicon or Intel) | `DictationApp_<version>_universal.dmg` |
| Windows 10 / 11 | `DictationApp_<version>_x64-setup.exe` (or the `.msi`) |
| Linux | `.AppImage` (any distribution), `.deb` (Debian, Ubuntu) or `.rpm` (Fedora, openSUSE) |

The installers are not code-signed yet, so the first launch needs one extra step:

- **macOS**: open the app once. When macOS blocks it, go to **System Settings → Privacy & Security**
  and click **Open Anyway**.
- **Windows**: when SmartScreen says "Windows protected your PC", click **More info → Run anyway**.
- **Linux AppImage**: make it executable (`chmod +x DictationApp_*.AppImage`), then run it.

DictationApp generates audio with Microsoft Azure Speech: after installing, enter your own Azure
Speech key and region under **Settings**.
