//! Light or dark, by the clock.
//!
//! The stylesheet follows `prefers-color-scheme`, which the webview takes from
//! the app's native appearance, the same one that colours the title bar, the
//! iOS status bar and the keyboard. Forcing that appearance is therefore all
//! it takes to turn the whole app dark: at night it is forced, even on a
//! system set to light, and by day the app follows the system.

use std::ops::Range;
use std::thread;
use std::time::Duration;

use chrono::{Local, Timelike};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Local hours that count as day; every other hour is night, so dark from
/// 19:00 until 07:00.
const DAY_HOURS: Range<u32> = 7..19;

const CLOCK_CHECK_INTERVAL: Duration = Duration::from_secs(60);

fn is_night_hour(hour: u32) -> bool {
    !DAY_HOURS.contains(&hour)
}

fn is_night_now() -> bool {
    is_night_hour(Local::now().hour())
}

/// Sets the appearance for the current time and keeps it right while the app
/// stays open. Call it from `setup`: that runs before the first paint, so a
/// launch at night does not flash the daytime colours.
pub fn follow_night_schedule<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut was_night = is_night_now();
    set_forced_dark(app, was_night)?;

    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(CLOCK_CHECK_INTERVAL);
        let is_night = is_night_now();
        if is_night != was_night {
            was_night = is_night;
            // Fails only when the app is closing.
            let _ = set_forced_dark(&app, is_night);
        }
    });
    Ok(())
}

/// iOS freezes the schedule's thread while the app is in the background, so
/// coming back has to catch up with the clock straight away.
#[cfg(mobile)]
pub fn catch_up_after_resuming<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    set_forced_dark(app, is_night_now())
}

fn set_forced_dark<R: Runtime>(app: &AppHandle<R>, is_forced: bool) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or(tauri::Error::WindowNotFound)?;
    force_native_appearance(&window, is_forced)
}

#[cfg(not(target_os = "ios"))]
fn force_native_appearance<R: Runtime>(
    window: &WebviewWindow<R>,
    is_forced: bool,
) -> tauri::Result<()> {
    window.set_theme(is_forced.then_some(tauri::Theme::Dark))
}

/// Tauri's `set_theme` does nothing on iOS, so this goes to UIKit directly.
#[cfg(target_os = "ios")]
fn force_native_appearance<R: Runtime>(
    window: &WebviewWindow<R>,
    is_forced: bool,
) -> tauri::Result<()> {
    use objc2::{msg_send, runtime::AnyObject};

    // Values of UIUserInterfaceStyle.
    const FOLLOW_SYSTEM: isize = 0;
    const DARK: isize = 2;
    let style = if is_forced { DARK } else { FOLLOW_SYSTEM };

    window.with_webview(move |webview| {
        let web_view = webview.inner().cast::<AnyObject>();
        // SAFETY: `with_webview` runs this on the main thread and passes the
        // live WKWebView; `window` and `overrideUserInterfaceStyle` are UIKit
        // API with these signatures.
        unsafe {
            let ui_window: *mut AnyObject = msg_send![web_view, window];
            let _: () = msg_send![ui_window, setOverrideUserInterfaceStyle: style];
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn night_starts_at_seven_in_the_evening() {
        assert!(!is_night_hour(18));
        assert!(is_night_hour(19));
        assert!(is_night_hour(23));
    }

    #[test]
    fn night_runs_past_midnight_and_ends_at_seven_in_the_morning() {
        assert!(is_night_hour(0));
        assert!(is_night_hour(6));
        assert!(!is_night_hour(7));
    }

    #[test]
    fn midday_is_not_night() {
        assert!(!is_night_hour(12));
    }
}
