# DictationApp 中文使用说明

[返回首页](../README.md) · [下载安装](https://github.com/richardgong1987/DictationApp/releases/latest)

**一份英文材料，两种练习方式：听写练听力，跟读练表达。**

你可以使用文章、课程笔记、技术概念或面试回答：先听清楚、写准确，再把不顺的句子反复读顺，最后整篇连贯朗读。两个模式使用同一份材料和缓存音频，可以按需要选择。

## 1. 下载并安装

打开 [最新发布页面](https://github.com/richardgong1987/DictationApp/releases/latest)，展开 **Assets**，选择适合电脑的安装包。普通使用者不需要安装 Rust、Node.js 或 pnpm；页面中的 **Source code** 是源码压缩包，不是安装程序。

| 设备 | 选择的文件 |
|---|---|
| Mac（Apple Silicon 或 Intel） | 名称含 `universal.dmg` 的文件 |
| Windows x64 | `x64-setup.exe`，也可以选择 `.msi` |
| Linux x86_64 | `.AppImage`；Debian/Ubuntu 可选 `.deb`；RPM 系统可选 `.rpm` |

- **Mac：**打开 DMG，把应用拖到 Applications。当前安装包尚未进行代码签名；首次打开被拦截时，在尝试启动后前往 **系统设置 → 隐私与安全性 → 仍要打开**。
- **Windows：**运行安装程序；如果 SmartScreen 拦截本项目的安装包，点击 **更多信息 → 仍要运行**。
- **Linux：**安装对应的软件包，或执行 `chmod +x DictationApp_*.AppImage` 后运行 AppImage。是否兼容仍取决于系统库版本。

仓库也提供 iOS 构建和安装脚本，需要 Mac 和 Xcode，详见[源码构建说明](DEVELOPMENT.md#build-an-installer)。这与桌面安装包是不同的安装方式，目前这里不提供 App Store 下载入口。

## 2. 首次使用：配置语音

打开 **Settings（设置）→ Text-to-speech → Provider**，选择一种语音服务即可，不需要同时配置两种。

| 服务 | 要填写的内容 |
|---|---|
| Microsoft Azure Speech | 自己的 Speech 资源 **Key**、对应的 **Region**、**Voice name**。美音可用 `en-US-JennyNeural`，英音可用 `en-GB-SoniaNeural` |
| ElevenLabs | 自己的 **API key**、语音库中的 **Voice ID** 和支持的 **Model**。默认模型为 `eleven_multilingual_v2` |

从 [Azure Speech](https://azure.microsoft.com/products/ai-services/text-to-speech) 或 [ElevenLabs](https://elevenlabs.io) 获取自己的凭据。填好后点击 **Save**，看到 **Saved.** 再点击 **Back** 返回。

生成新音频需要联网，并使用你自己的服务额度或积分。已生成且与当前语音设置一致的音频保存在本机，反复播放不需要再次合成。

## 3. 添加练习材料

![课程列表：每份材料都有 Dictation 和 Shadowing 入口](main.png)

在 **Lessons** 页面选择：

- **Paste text：**直接粘贴文本，填写可选标题，点击 **Create lesson**。不填标题时会从正文开头自动取名。
- **Import .txt lesson：**导入 UTF-8 编码的 `.txt` 文件。可以先试用仓库中的[示例材料](../examples/lesson01.txt)。

**用空行分隔每个练习段落。** 每个文本块生成一个音频片段；程序不会按句号自动拆句。如果想逐句练习，请在每句话后留一行空行：

```text
I should have told you earlier.

The meeting has been moved to Friday afternoon.

If I had known about the problem, I would have called you.
```

同一个块里的普通换行会合并。超过 30 个单词的段落会提示建议缩短，但仍能使用。想反复练一句话时，最好把它单独放成一个块。

如果已配置语音服务，创建课程后会自动开始生成音频。也可以点击课程标题进入详情，选择 **Generate missing audio**，补齐缺失或更新过期的音频。建议等到音频数量全部就绪再开始整篇练习。

**Regenerate all** 会重新生成所有音频，并消耗服务额度；不需要为了重复练习而点击它。

## 4. 听写：Dictation

在课程卡片或课程详情中点击 **Dictation**。

![听写界面：查看原文后显示正确率和逐词对比](diction.png)

1. 点击某一段的 **Play**。尚未检查的内容默认隐藏原文。
2. 在输入框中写下听到的内容。没听清时，可以重播、开启 **Loop**、拖动进度条，或降低播放速度。
3. 在输入框中按 **Enter**，或点击 **Show original text**，检查答案并显示原文。
4. 查看正确、错误、遗漏和多余的词，以及正确率。`a`、`the`、`to` 等小词也计入检查；大小写和词语周围的标点会被忽略。
5. 想修改答案，先点击 **Hide original text**；想继续下一段，再按一次 **Enter**。

输入短暂停顿后答案会自动保存。下次进入 **Dictation** 时会从最近的作答位置附近继续。**Clear answers** 可以清空本课答案重新练习，但会保留历史尝试统计。

### 听写快捷键

| 操作 | 不在文本框中 | 正在输入答案时 |
|---|---|---|
| 播放 / 暂停 | Space | Ctrl/⌘ + Space |
| 从头重播当前段 | R | Ctrl/⌘ + R |
| 上一段 / 下一段 | ← / → | Ctrl/⌘ + ← / → |
| 开关循环 | L | Ctrl/⌘ + L |
| 加速 / 减速 | ↑ / ↓ | Ctrl/⌘ + ↑ / ↓ |
| 检查答案，再进入下一段 | Enter | Enter |
| 输入换行 | — | Shift + Enter |
| 离开输入框 | — | Esc |

快捷键控制当前激活的卡片。焦点在按钮上时，Enter/Space 会执行该按钮的动作。这些快捷键属于听写模式，跟读模式请使用界面上的播放按钮。

## 5. 跟读：Shadowing

在课程卡片或课程详情中点击 **Shadowing**，即可直接进入跟读，不需要经过听写页面。

![跟读界面：顶部整篇播放，下方每段独立练习](shadowing.png)

### 第一步：把不顺的句子单独练顺

1. 找到不熟练的段落，点击它的 **Play** 听一遍。原文默认显示，可以看着读。
2. 点击 **Loop passage**，循环练习这一段。
3. 在 **Time to repeat aloud** 中设置两次播放之间留给自己朗读的时间。
4. 音频播放结束后，看到 **Your turn** 倒计时，就开口复述。倒计时结束，程序再次播放这一段。
5. 太快时调低顶部的 **Speed**；需要从头听时点击该段的重播图标。

| 停顿选项 | 含义 |
|---|---|
| No pause | 不留停顿，连续循环，适合与音频同时跟读 |
| 3 seconds | 每次播放后留 3 秒自己朗读 |
| 5 seconds | 每次播放后留 5 秒自己朗读 |
| Match passage length | 按当前播放速度下该段音频的时长留出朗读时间 |

这个停顿设置仅用于 **Loop passage（单段循环）**。

### 第二步：整篇连贯朗读

各段都读顺之后，点击顶部 **Play article**，按顺序播放所有段落，并跟着整篇朗读。整篇播放不会插入上面设置的复述停顿。

- **Pause / Resume：**暂停或继续。
- **Restart：**从文章开头重新播放。
- **Loop article：**读完最后一段后，从第一段再来一遍。
- **Hide text / Show text：**隐藏或显示原文，熟悉之后可以尝试脱离文字练习。

点击单段播放会切换到单段练习；点击整篇播放会切换到整篇练习，两种播放不会重叠。

两种练习模式都支持 **0.60×、0.75×、0.90×、1.00×、1.10×、1.25×** 播放速度。跟读的速度和停顿选择只保留在本次进入页面期间；跟读不会修改听写答案和统计。当前跟读是自主朗读练习，没有录音、语音识别或发音评分功能。

## 6. 常见问题

**每次播放都会收费吗？**

不会重复请求未变化的缓存音频。生成新音频或重新生成音频才会使用服务额度，实际计费以所选服务为准。

**能离线练习吗？**

可以使用已经生成、仍符合当前语音设置的本地音频。离线前先生成全部片段，并保持语音设置不变。缺失或过期的音频可能触发联网生成请求。

**播放速度和 Settings 中的 Speaking rate 有什么区别？**

播放器中的 **Speed** 直接调整本地播放速度，不重新生成音频。Settings 中的 **Speaking rate** 改变合成语音的设置，下次生成或练习时可能需要重新合成。

**为什么显示 Voice changed？**

切换服务、声音、模型或相关语音参数后，旧音频会被标为过期。回到课程详情生成更新后的音频即可；重新合成会消耗服务额度。

**音频生成失败或者没有声音怎么办？**

先检查系统音量、网络和额度，再确认 Settings 中选中的服务，以及对应的 Key、Region、Voice 或 Model。修正后点击失败片段的 **Retry**，或回到课程详情选择 **Generate missing audio**。

**数据保存在哪里？**

课程、音频、答案和练习记录保存在应用的本地数据目录，记录由 SQLite 保存。没有应用账号或自动跨设备同步。生成语音时，相应文本会发送给你选择的语音服务。

**能在 Mac 和 iPhone 上用同一批课程吗？**

可以，而且不用重新生成音频。在已有课程的设备上，点击课程列表底部的 **Export all lessons**，所有课程和音频会导出为一个 `.zip` 文件：Mac 上由你选择保存位置，iPhone 上会保存到“文件” App 的 **我的 iPhone › DictationApp**。把文件传到另一台设备（例如用 AirDrop），再在那里点击 **Import lessons**。

导入只会添加，不会替换：另一台设备上已有的课程保留原来的文本、音频和练习记录，只补上缺少的音频。比如手机上有 A、B，Mac 上有 C，把手机导出的文件导入 Mac 后，Mac 上就是 A、B、C。如果这些音频的语音设置和本机不同，应用会询问是否切换到导出设备的语音设置，以免练习时重新生成。

**API Key 如何保存？**

在 Settings 中输入的 Key 会以未加密形式保存在本地应用数据中。开发者也可以通过环境变量配置；环境变量优先于界面设置，详见[开发说明](DEVELOPMENT.md#run)。

**如何修改课程名称或删除课程？**

在课程列表使用 **Rename** 或 **Delete**。删除会移除应用中的该课程及音频，不会修改原始导入的 `.txt` 文件。

## 7. 源码运行与构建

开发环境、桌面打包、iOS 构建、测试和架构请看[开发说明](DEVELOPMENT.md)。普通用户直接下载安装包，按本说明配置语音服务即可开始使用。
