//! End-to-end tests through the Tauri IPC layer (mock runtime): argument
//! names, serialization and command wiring as the frontend sees them.

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

use crate::app_state::AppState;
use crate::audio::cache::cache_key;
use crate::database::Database;
use crate::lesson::files::LessonFiles;
use crate::lesson::repository::LessonRepository;
use crate::settings::{EnvCredentials, Settings};

struct Harness {
    _app: tauri::App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    database: Database,
    dir: tempfile::TempDir,
}

impl Harness {
    /// An app with an empty data directory and no TTS credentials.
    fn new() -> Self {
        Self::open(tempfile::tempdir().unwrap())
    }

    /// Closes the app and starts it again on the same data directory.
    fn restart(self) -> Self {
        let Self { dir, .. } = self;
        Self::open(dir)
    }

    fn open(dir: tempfile::TempDir) -> Self {
        let database = Database::open(&dir.path().join("dictation.db")).unwrap();
        let state = AppState::new(
            database.clone(),
            dir.path().to_path_buf(),
            EnvCredentials::default(),
        );
        let app = super::with_commands(mock_builder())
            .manage(state)
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        Self {
            _app: app,
            webview,
            database,
            dir,
        }
    }

    fn call_raw(&self, cmd: &str, args: Value) -> Result<InvokeResponseBody, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
    }

    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        self.call_raw(cmd, args)
            .map(|body| body.deserialize::<Value>().unwrap())
    }

    fn write_lesson_file(&self, name: &str, content: &str) -> String {
        let path = self.dir.path().join(name);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// Stores an MP3 for the item as if it had been generated earlier with
    /// the default voice settings.
    fn fake_generated_audio(&self, lesson_id: &str, item: &Value) {
        let audio = format!("mp3 {}", item["id"]);
        self.fake_audio_made_with(&Settings::default(), lesson_id, item, &audio);
    }

    fn fake_audio_made_with(
        &self,
        settings: &Settings,
        lesson_id: &str,
        item: &Value,
        audio: &str,
    ) {
        let text = item["text"].as_str().unwrap();
        let path = LessonFiles::audio_path(lesson_id, item["position"].as_i64().unwrap());
        std::fs::write(self.dir.path().join(&path), audio).unwrap();
        let key = cache_key(&settings.tts_request(text));
        LessonRepository::new(self.database.clone())
            .set_item_audio(item["id"].as_i64().unwrap(), &path, &key)
            .unwrap();
    }

    fn paste_lesson(&self, title: &str, text: &str) -> Value {
        self.call(
            "import_lesson_text",
            json!({ "title": title, "text": text }),
        )
        .unwrap()
    }

    fn lesson(&self, lesson_id: &Value) -> Value {
        self.call("get_lesson", json!({ "lessonId": lesson_id }))
            .unwrap()
    }

    fn item_audio(&self, item_id: &Value) -> Vec<u8> {
        match self
            .call_raw("get_item_audio", json!({ "itemId": item_id }))
            .unwrap()
        {
            InvokeResponseBody::Raw(bytes) => bytes,
            other => panic!("expected raw bytes, got {other:?}"),
        }
    }

    /// Exports every lesson to a file outside the data directory and returns its path.
    fn export_to(&self, dir: &tempfile::TempDir) -> String {
        let path = dir.path().join("lessons.zip");
        self.call("export_lessons", json!({ "path": path }))
            .unwrap();
        path.to_string_lossy().into_owned()
    }

    fn import(&self, path: &str) -> Value {
        self.call("import_lessons", json!({ "path": path }))
            .unwrap()
    }
}

const LESSON: &str = "I haven't seen him since last Monday.\n\nHe told me that he would call me back.\n\nWould you mind closing the window?\n";

#[test]
fn import_practice_and_reopen_flow() {
    let h = Harness::new();
    let path = h.write_lesson_file("lesson01.txt", LESSON);

    let detail = h.call("import_lesson", json!({ "path": path })).unwrap();
    assert_eq!(detail["lesson"]["title"], "lesson01");
    let items = detail["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[2]["text"], "Would you mind closing the window?");
    assert_eq!(items[0]["audioStatus"], "missing");
    assert_eq!(items[0]["tooLong"], false);
    let lesson_id = detail["lesson"]["id"].as_str().unwrap().to_string();

    // Lesson folder follows the documented layout.
    let lesson_dir = h.dir.path().join("lessons").join(&lesson_id);
    assert_eq!(
        std::fs::read_to_string(lesson_dir.join("source.txt")).unwrap(),
        LESSON
    );
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(lesson_dir.join("metadata.json")).unwrap()).unwrap();
    assert_eq!(metadata["items"][1]["audioFile"], "002.mp3");

    for item in items {
        h.fake_generated_audio(&lesson_id, item);
    }

    // Everything is cached, so no TTS call (and no credentials) is needed.
    let summary = h
        .call(
            "generate_lesson_audio",
            json!({ "lessonId": lesson_id, "force": false }),
        )
        .unwrap();
    assert_eq!(summary["cached"], 3);
    assert_eq!(summary["generated"], 0);

    let lessons = h.call("list_lessons", json!({})).unwrap();
    assert_eq!(lessons[0]["itemCount"], 3);
    assert_eq!(lessons[0]["audioReadyCount"], 3);

    // Audio is returned as raw bytes.
    let first_id = items[0]["id"].as_i64().unwrap();
    match h
        .call_raw("get_item_audio", json!({ "itemId": first_id }))
        .unwrap()
    {
        InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, format!("mp3 {first_id}").into_bytes()),
        other => panic!("expected raw bytes, got {other:?}"),
    }

    // Checking an answer returns the diff and records the attempt.
    let result = h
        .call(
            "check_answer",
            json!({ "itemId": first_id, "answer": "i havent seen him since  monday", "replayCount": 2 }),
        )
        .unwrap();
    assert_eq!(result["isCorrect"], false);
    assert_eq!(
        result["sourceText"],
        "I haven't seen him since last Monday."
    );
    assert_eq!(result["answer"], "i havent seen him since monday");
    let kinds: Vec<&str> = result["diff"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        ["equal", "changed", "equal", "equal", "equal", "missing", "equal"]
    );

    let detail = h
        .call("get_lesson", json!({ "lessonId": lesson_id }))
        .unwrap();
    assert_eq!(detail["items"][0]["attemptCount"], 1);
    assert_eq!(detail["items"][0]["audioStatus"], "ready");

    // A voice change marks audio as outdated rather than silently reusing it.
    let mut changed = h.call("get_settings", json!({})).unwrap()["settings"].clone();
    changed["azureVoice"] = json!("en-GB-SoniaNeural");
    h.call("save_settings", json!({ "settings": changed }))
        .unwrap();
    let detail = h
        .call("get_lesson", json!({ "lessonId": lesson_id }))
        .unwrap();
    assert_eq!(detail["items"][0]["audioStatus"], "stale");

    // Player preferences don't clobber other settings.
    h.call(
        "save_player_preferences",
        json!({ "playbackSpeed": 0.75, "loopEnabled": true }),
    )
    .unwrap();
    let view = h.call("get_settings", json!({})).unwrap();
    assert_eq!(view["settings"]["azureVoice"], "en-GB-SoniaNeural");
    assert_eq!(view["settings"]["playbackSpeed"], 0.75);
    assert_eq!(view["settings"]["loopEnabled"], true);

    h.call("delete_lesson", json!({ "lessonId": lesson_id }))
        .unwrap();
    assert!(!lesson_dir.exists());
    assert_eq!(h.call("list_lessons", json!({})).unwrap(), json!([]));
}

#[test]
fn import_rejects_empty_and_non_utf8_files() {
    let h = Harness::new();
    let empty = h.write_lesson_file("empty.txt", "\n  \n\n");
    let err = h
        .call("import_lesson", json!({ "path": empty }))
        .unwrap_err();
    assert!(err.as_str().unwrap().contains("No dictation items"));

    let path = h.dir.path().join("latin1.txt");
    std::fs::write(&path, [0x63, 0x61, 0x66, 0xe9]).unwrap();
    let err = h
        .call("import_lesson", json!({ "path": path.to_string_lossy() }))
        .unwrap_err();
    assert!(err.as_str().unwrap().contains("UTF-8"));
    assert_eq!(h.call("list_lessons", json!({})).unwrap(), json!([]));
}

#[test]
fn pasted_text_becomes_a_lesson_like_a_file() {
    let h = Harness::new();

    let detail = h
        .call(
            "import_lesson_text",
            json!({ "title": "  ", "text": LESSON }),
        )
        .unwrap();
    assert_eq!(
        detail["lesson"]["title"],
        "I haven't seen him since last Monday."
    );
    assert_eq!(detail["lesson"]["sourcePath"], Value::Null);
    assert_eq!(detail["items"].as_array().unwrap().len(), 3);
    let lesson_id = detail["lesson"]["id"].as_str().unwrap().to_string();
    let source = h
        .dir
        .path()
        .join("lessons")
        .join(&lesson_id)
        .join("source.txt");
    assert_eq!(std::fs::read_to_string(source).unwrap(), LESSON);

    let detail = h
        .call(
            "import_lesson_text",
            json!({ "title": " Unit 2 ", "text": LESSON }),
        )
        .unwrap();
    assert_eq!(detail["lesson"]["title"], "Unit 2");

    let err = h
        .call(
            "import_lesson_text",
            json!({ "title": "Empty", "text": " \n\n" }),
        )
        .unwrap_err();
    assert!(err.as_str().unwrap().contains("No dictation items"));

    let h = h.restart();
    let lessons = h.call("list_lessons", json!({})).unwrap();
    assert_eq!(lessons.as_array().unwrap().len(), 2);
}

#[test]
fn renamed_title_is_trimmed_and_survives_restart() {
    let h = Harness::new();
    let path = h.write_lesson_file("lesson01.txt", LESSON);
    let detail = h.call("import_lesson", json!({ "path": path })).unwrap();
    let lesson_id = detail["lesson"]["id"].as_str().unwrap().to_string();

    let lesson = h
        .call(
            "rename_lesson",
            json!({ "lessonId": lesson_id, "title": "  Unit 1: Everyday phrases  " }),
        )
        .unwrap();
    assert_eq!(lesson["title"], "Unit 1: Everyday phrases");

    let h = h.restart();
    let lessons = h.call("list_lessons", json!({})).unwrap();
    assert_eq!(lessons[0]["title"], "Unit 1: Everyday phrases");
    assert_eq!(lessons[0]["itemCount"], 3);
    let metadata_path = h
        .dir
        .path()
        .join("lessons")
        .join(&lesson_id)
        .join("metadata.json");
    let metadata: Value = serde_json::from_slice(&std::fs::read(metadata_path).unwrap()).unwrap();
    assert_eq!(metadata["title"], "Unit 1: Everyday phrases");

    let err = h
        .call(
            "rename_lesson",
            json!({ "lessonId": lesson_id, "title": "   " }),
        )
        .unwrap_err();
    assert_eq!(err, "Lesson title cannot be empty.");
    let err = h
        .call(
            "rename_lesson",
            json!({ "lessonId": "no-such-lesson", "title": "Anything" }),
        )
        .unwrap_err();
    assert_eq!(err, "Lesson not found");
}

#[test]
fn missing_audio_without_credentials_is_a_clear_error() {
    let h = Harness::new();
    let path = h.write_lesson_file("l.txt", "One.\n\nTwo.");
    let detail = h.call("import_lesson", json!({ "path": path })).unwrap();
    let lesson_id = detail["lesson"]["id"].clone();
    let err = h
        .call(
            "generate_lesson_audio",
            json!({ "lessonId": lesson_id, "force": false }),
        )
        .unwrap_err();
    assert!(err
        .as_str()
        .unwrap()
        .contains("credentials are not configured"));

    let item_id = detail["items"][0]["id"].clone();
    let err = h
        .call("get_item_audio", json!({ "itemId": item_id }))
        .unwrap_err();
    assert!(err.as_str().unwrap().contains("not found"));
}

#[test]
fn switching_provider_marks_audio_outdated_until_switched_back() {
    let h = Harness::new();
    let path = h.write_lesson_file("l.txt", "One.\n\nTwo.");
    let detail = h.call("import_lesson", json!({ "path": path })).unwrap();
    let lesson_id = detail["lesson"]["id"].as_str().unwrap().to_string();
    for item in detail["items"].as_array().unwrap() {
        h.fake_generated_audio(&lesson_id, item);
    }
    let audio_status = || {
        h.call("get_lesson", json!({ "lessonId": lesson_id }))
            .unwrap()["items"][0]["audioStatus"]
            .clone()
    };

    let mut settings = h.call("get_settings", json!({})).unwrap()["settings"].clone();
    settings["ttsProvider"] = json!("elevenlabs");
    settings["speakingRate"] = json!(50);
    let saved = h
        .call("save_settings", json!({ "settings": settings }))
        .unwrap();
    // ElevenLabs speaks at most 1.2x.
    assert_eq!(saved["settings"]["speakingRate"], 20);
    assert_eq!(saved["credentialsConfigured"], false);
    assert_eq!(audio_status(), "stale");

    let err = h
        .call(
            "generate_lesson_audio",
            json!({ "lessonId": lesson_id, "force": false }),
        )
        .unwrap_err();
    assert!(err
        .as_str()
        .unwrap()
        .contains("ElevenLabs API key is not configured"));

    // Nothing was regenerated, so the Azure audio is current again.
    settings["ttsProvider"] = json!("azure");
    settings["speakingRate"] = json!(0);
    h.call("save_settings", json!({ "settings": settings }))
        .unwrap();
    assert_eq!(audio_status(), "ready");
}

#[test]
fn answers_are_kept_and_practice_resumes_where_it_stopped() {
    let h = Harness::new();
    let path = h.write_lesson_file("lesson01.txt", LESSON);
    let detail = h.call("import_lesson", json!({ "path": path })).unwrap();
    let lesson_id = detail["lesson"]["id"].clone();
    let ids: Vec<i64> = detail["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_i64().unwrap())
        .collect();
    let progress = |h: &Harness| {
        h.call("get_practice_progress", json!({ "lessonId": lesson_id }))
            .unwrap()
    };
    let nothing_saved = json!({ "answers": [], "resumeItemId": null });
    assert_eq!(progress(&h), nothing_saved);

    // A typed answer is kept exactly as typed, and practice resumes on it.
    h.call(
        "save_answer",
        json!({ "itemId": ids[0], "answer": "I haven't  seen him" }),
    )
    .unwrap();
    let saved = progress(&h);
    assert_eq!(saved["answers"][0]["text"], "I haven't  seen him");
    assert_eq!(saved["answers"][0]["result"], Value::Null);
    assert_eq!(saved["resumeItemId"], ids[0]);

    // A checked answer comes back with its result, and practice moves on.
    h.call(
        "check_answer",
        json!({ "itemId": ids[0], "answer": "I haven't seen him since last Monday.", "replayCount": 1 }),
    )
    .unwrap();
    let h = h.restart();
    let saved = progress(&h);
    assert_eq!(saved["answers"][0]["result"]["isCorrect"], true);
    assert_eq!(saved["resumeItemId"], ids[1]);

    // Clearing an answer deletes it.
    h.call("save_answer", json!({ "itemId": ids[0], "answer": "  " }))
        .unwrap();
    assert_eq!(progress(&h), nothing_saved);

    // Clearing the lesson deletes every answer but keeps the statistics.
    for id in &ids {
        h.call(
            "save_answer",
            json!({ "itemId": id, "answer": "something" }),
        )
        .unwrap();
    }
    h.call("clear_answers", json!({ "lessonId": lesson_id }))
        .unwrap();
    assert_eq!(progress(&h), nothing_saved);
    let detail = h
        .call("get_lesson", json!({ "lessonId": lesson_id }))
        .unwrap();
    assert_eq!(detail["items"][0]["attemptCount"], 1);

    let err = h
        .call("clear_answers", json!({ "lessonId": "no-such-lesson" }))
        .unwrap_err();
    assert_eq!(err, "Lesson not found");
}

#[test]
fn lessons_move_between_devices_and_importing_only_adds() {
    let phone = Harness::new();
    let a = phone.paste_lesson("A", LESSON);
    let b = phone.paste_lesson("B", "One.\n\nTwo.");
    for item in a["items"].as_array().unwrap() {
        phone.fake_generated_audio(a["lesson"]["id"].as_str().unwrap(), item);
    }
    let b_id = b["lesson"]["id"].as_str().unwrap();
    phone.fake_generated_audio(b_id, &b["items"][0]);

    let mac = Harness::new();
    let c = mac.paste_lesson("C", "Three.");
    let c_item = &c["items"][0]["id"];
    mac.call(
        "check_answer",
        json!({ "itemId": c_item, "answer": "three", "replayCount": 0 }),
    )
    .unwrap();

    let exports = tempfile::tempdir().unwrap();
    let summary = mac.import(&phone.export_to(&exports));
    assert_eq!(summary["addedLessons"], 2);
    assert_eq!(summary["existingLessons"], 0);
    assert_eq!(summary["addedAudio"], 4);
    assert_eq!(summary["audioWithOtherVoice"], 0);

    // The phone's A and B join the Mac's C, keeping when they were created.
    let lessons = mac.call("list_lessons", json!({})).unwrap();
    let mut titles: Vec<&str> = lessons
        .as_array()
        .unwrap()
        .iter()
        .map(|lesson| lesson["title"].as_str().unwrap())
        .collect();
    titles.sort();
    assert_eq!(titles, ["A", "B", "C"]);
    let imported_a = mac.lesson(&a["lesson"]["id"]);
    assert_eq!(imported_a["lesson"]["createdAt"], a["lesson"]["createdAt"]);
    assert_eq!(
        imported_a["items"][2]["text"],
        "Would you mind closing the window?"
    );
    assert_eq!(imported_a["items"][0]["audioStatus"], "ready");
    assert_eq!(
        mac.item_audio(&imported_a["items"][0]["id"]),
        phone.item_audio(&a["items"][0]["id"])
    );
    let imported_b = mac.lesson(&b["lesson"]["id"]);
    assert_eq!(imported_b["items"][1]["audioStatus"], "missing");
    assert_eq!(
        mac.lesson(&c["lesson"]["id"])["items"][0]["attemptCount"],
        1
    );

    // Importing the same file again adds nothing.
    let again = mac.import(&phone.export_to(&exports));
    assert_eq!(again["addedLessons"], 0);
    assert_eq!(again["existingLessons"], 2);
    assert_eq!(again["addedAudio"], 0);

    // Audio the Mac lacks is filled in later; audio it has is never replaced.
    phone.fake_audio_made_with(&Settings::default(), b_id, &b["items"][1], "phone two");
    phone.fake_audio_made_with(
        &Settings::default(),
        b_id,
        &b["items"][0],
        "phone one, redone",
    );
    let later = mac.import(&phone.export_to(&exports));
    assert_eq!(later["addedAudio"], 1);
    let imported_b = mac.lesson(&b["lesson"]["id"]);
    assert_eq!(mac.item_audio(&imported_b["items"][1]["id"]), b"phone two");
    assert_eq!(
        mac.item_audio(&imported_b["items"][0]["id"]),
        format!("mp3 {}", b["items"][0]["id"]).into_bytes()
    );

    // And it all works the other way round.
    let phone = phone.restart();
    let back = phone.import(&mac.export_to(&exports));
    assert_eq!(back["addedLessons"], 1);
    assert_eq!(back["existingLessons"], 2);
    assert_eq!(
        phone
            .call("list_lessons", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn audio_made_with_another_voice_is_reported_until_the_voice_is_adopted() {
    let elevenlabs = Settings {
        tts_provider: crate::tts::TtsProviderKind::ElevenLabs,
        ..Settings::default()
    };
    let phone = Harness::new();
    let mut phone_settings = phone.call("get_settings", json!({})).unwrap()["settings"].clone();
    phone_settings["ttsProvider"] = json!("elevenlabs");
    phone
        .call("save_settings", json!({ "settings": phone_settings }))
        .unwrap();
    let lesson = phone.paste_lesson("A", "One.\n\nTwo.");
    let lesson_id = lesson["lesson"]["id"].as_str().unwrap();
    for item in lesson["items"].as_array().unwrap() {
        phone.fake_audio_made_with(&elevenlabs, lesson_id, item, "george");
    }

    let mac = Harness::new();
    let exports = tempfile::tempdir().unwrap();
    let summary = mac.import(&phone.export_to(&exports));
    assert_eq!(summary["addedAudio"], 2);
    assert_eq!(summary["audioWithOtherVoice"], 2);
    assert_eq!(summary["exportedVoice"]["ttsProvider"], "elevenlabs");
    assert_eq!(
        mac.lesson(&lesson["lesson"]["id"])["items"][0]["audioStatus"],
        "stale"
    );

    // Field names match Settings, so the voice applies to them as it is.
    let mut mac_settings = mac.call("get_settings", json!({})).unwrap()["settings"].clone();
    for (field, value) in summary["exportedVoice"].as_object().unwrap() {
        mac_settings[field] = value.clone();
    }
    mac.call("save_settings", json!({ "settings": mac_settings }))
        .unwrap();
    assert_eq!(
        mac.lesson(&lesson["lesson"]["id"])["items"][0]["audioStatus"],
        "ready"
    );
}

#[test]
fn importing_something_else_is_a_clear_error() {
    let h = Harness::new();
    let path = h.write_lesson_file("lesson01.txt", LESSON);
    let err = h
        .call("import_lessons", json!({ "path": path }))
        .unwrap_err();
    assert_eq!(
        err,
        "This file is not a lesson export from DictationApp, or it is damaged."
    );
    assert_eq!(h.call("list_lessons", json!({})).unwrap(), json!([]));
}
