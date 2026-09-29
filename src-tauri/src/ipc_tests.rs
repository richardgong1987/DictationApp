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
    /// An app with an empty data directory and no Azure credentials.
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
        let id = item["id"].as_i64().unwrap();
        let text = item["text"].as_str().unwrap();
        let path = LessonFiles::audio_path(lesson_id, item["position"].as_i64().unwrap());
        std::fs::write(self.dir.path().join(&path), format!("mp3 {id}")).unwrap();
        let key = cache_key(&Settings::default().tts_request(text));
        LessonRepository::new(self.database.clone())
            .set_item_audio(id, &path, &key)
            .unwrap();
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

    // Everything is cached, so no Azure call (and no credentials) is needed.
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
    changed["voice"] = json!("en-GB-SoniaNeural");
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
    assert_eq!(view["settings"]["voice"], "en-GB-SoniaNeural");
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
        .call("rename_lesson", json!({ "lessonId": lesson_id, "title": "   " }))
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
