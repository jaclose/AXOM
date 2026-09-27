//! Mirrors the web app's Pomodoro focus timer into the macOS menu bar.
//!
//! The web app stays the source of truth: it owns the timer, logs finished
//! sprints and decides phase changes. It sends a small snapshot through
//! `menu_bar_timer_update` whenever something visible changes (start, pause,
//! phase, label, or a clock jump such as reset/skip). Between snapshots a
//! background ticker counts down locally, so the menu bar keeps an accurate
//! clock without an IPC round-trip every second.
//!
//! The status item (NSStatusItem via Tauri's `TrayIcon`) exists on macOS only.
//! On other platforms the commands still accept snapshots but draw nothing.
//!
//! Threading: `TrayIcon`/`MenuItem` setters hop to the main thread and block
//! until it runs them, while commands, menu events and window events run *on*
//! the main thread and briefly lock the snapshot mutex. The ticker therefore
//! copies the snapshot and releases the lock before it calls into Tauri, which
//! keeps the two from waiting on each other.

// Menu wiring and the ticker are macOS-only; the pure helpers stay shared.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};

/// Id of the menu bar status item.
pub const TRAY_ID: &str = "axom-focus-timer";
/// Global event the web app listens to for menu actions.
pub const ACTION_EVENT: &str = "menu-bar-timer://action";
/// Tooltip shown when no label is attached to the timer.
pub const DEFAULT_TOOLTIP: &str = "AXOM focus timer";
/// Longest label the menu bar shows (in characters).
pub const MAX_LABEL_CHARS: usize = 40;
/// Longest countdown accepted from the web app (24 hours).
pub const MAX_SECONDS: u32 = 24 * 60 * 60;

const MENU_TOGGLE: &str = "axom-focus-timer:toggle";
const MENU_SKIP: &str = "axom-focus-timer:skip";
const MENU_RESET: &str = "axom-focus-timer:reset";
const MENU_OPEN: &str = "axom-focus-timer:open";
const MENU_QUIT: &str = "axom-focus-timer:quit";

/// Which half of the Pomodoro cycle is on the clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerPhase {
    Focus,
    Break,
}

/// Snapshot as sent by the web app (`MenuBarTimerSnapshot` in menuBarTimer.ts).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarTimerInput {
    pub enabled: bool,
    pub phase: TimerPhase,
    pub running: bool,
    /// Any JSON number; sanitized by [`sanitize_seconds`].
    pub seconds_left: f64,
    /// True when the phase has not been started yet (full length, paused).
    #[serde(default)]
    pub idle: bool,
    #[serde(default)]
    pub label: Option<String>,
}

/// Validated timer state, stamped with the wall-clock time it arrived.
#[derive(Debug, Clone, PartialEq)]
pub struct TimerSnapshot {
    pub enabled: bool,
    pub phase: TimerPhase,
    pub running: bool,
    pub idle: bool,
    /// Seconds left when the snapshot was received.
    pub remaining_secs: u32,
    /// Wall-clock receipt time. The web timer counts with `Date.now()`, and
    /// `Instant` on macOS stops while the Mac sleeps, so wall-clock time keeps
    /// both clocks in step across sleep.
    pub received: SystemTime,
    pub label: Option<String>,
}

impl TimerSnapshot {
    pub fn from_input(input: MenuBarTimerInput, received: SystemTime) -> Self {
        Self {
            enabled: input.enabled,
            phase: input.phase,
            running: input.running,
            idle: input.idle && !input.running,
            remaining_secs: sanitize_seconds(input.seconds_left),
            received,
            label: sanitize_label(input.label.as_deref()),
        }
    }

    /// Seconds left at `now`, counting down only while running.
    pub fn remaining_at(&self, now: SystemTime) -> u32 {
        // A clock moved backwards counts as no time elapsed.
        let elapsed = now.duration_since(self.received).unwrap_or_default();
        remaining_seconds(self.remaining_secs, self.running, elapsed)
    }
}

/// Managed state shared by the commands, the menu handler and the ticker.
#[derive(Default)]
pub struct MenuBarTimerState {
    snapshot: Arc<Mutex<Option<TimerSnapshot>>>,
    /// Set once the status item exists and its ticker runs. Without it there
    /// is no menu bar clock to fall back on, so closing must not hide AXOM.
    installed: AtomicBool,
}

impl MenuBarTimerState {
    fn lock(&self) -> MutexGuard<'_, Option<TimerSnapshot>> {
        lock_snapshot(&self.snapshot)
    }

    fn set(&self, next: Option<TimerSnapshot>) {
        *self.lock() = next;
    }

    fn mark_installed(&self) {
        self.installed.store(true, Ordering::Release);
    }

    /// Whether closing the window should leave AXOM running in the menu bar:
    /// only when the status item is live and shows a running, enabled timer.
    pub fn keeps_running_in_menu_bar(&self) -> bool {
        self.installed.load(Ordering::Acquire)
            && self
                .lock()
                .as_ref()
                .is_some_and(|snapshot| snapshot.enabled && snapshot.running)
    }

    fn is_running(&self) -> bool {
        self.lock()
            .as_ref()
            .is_some_and(|snapshot| snapshot.running)
    }
}

/// Lock the snapshot, recovering from a poisoned mutex instead of panicking:
/// the data is a plain value, so the last write is still usable.
fn lock_snapshot(snapshot: &Mutex<Option<TimerSnapshot>>) -> MutexGuard<'_, Option<TimerSnapshot>> {
    snapshot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Receive the latest timer snapshot from the web app.
#[tauri::command]
pub fn menu_bar_timer_update(
    state: tauri::State<'_, MenuBarTimerState>,
    snapshot: MenuBarTimerInput,
) {
    state.set(Some(TimerSnapshot::from_input(snapshot, SystemTime::now())));
}

/// Forget the timer (the web app unmounted); hides the status item.
#[tauri::command]
pub fn menu_bar_timer_clear(state: tauri::State<'_, MenuBarTimerState>) {
    state.set(None);
}

/// Clamp a JS number to whole seconds in `0..=MAX_SECONDS`.
pub fn sanitize_seconds(value: f64) -> u32 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    value.round().min(MAX_SECONDS as f64) as u32
}

/// Trim, collapse whitespace, drop control characters, and cap the label.
pub fn sanitize_label(label: Option<&str>) -> Option<String> {
    let cleaned = label?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    if cleaned.is_empty() {
        return None;
    }
    if cleaned.chars().count() <= MAX_LABEL_CHARS {
        return Some(cleaned);
    }
    let mut truncated = cleaned
        .chars()
        .take(MAX_LABEL_CHARS - 1)
        .collect::<String>()
        .trim_end()
        .to_string();
    truncated.push('…');
    Some(truncated)
}

/// Seconds left after `elapsed`, never below zero; paused clocks do not move.
pub fn remaining_seconds(remaining_secs: u32, running: bool, elapsed: Duration) -> u32 {
    if !running {
        return remaining_secs;
    }
    let elapsed = u32::try_from(elapsed.as_secs()).unwrap_or(u32::MAX);
    remaining_secs.saturating_sub(elapsed)
}

/// `mm:ss` below an hour (Raycast-style fixed width), `h:mm:ss` from one hour up.
pub fn format_clock(total_secs: u32) -> String {
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// Text inside the menu bar pill: the clock, then `⋯` for the menu. A running
/// focus sprint is just the clock; other states add one short word or glyph.
pub fn format_menu_bar_title(phase: TimerPhase, running: bool, remaining_secs: u32) -> String {
    let clock = format_clock(remaining_secs);
    match (running, phase) {
        (true, _) if remaining_secs == 0 => "Done  ⋯".to_string(),
        (true, TimerPhase::Focus) => format!("{clock}  ⋯"),
        (true, TimerPhase::Break) => format!("Break {clock}  ⋯"),
        (false, _) => format!("‖ {clock}  ⋯"),
    }
}

pub fn tooltip_text(label: Option<&str>) -> String {
    match label {
        Some(label) => format!("AXOM focus · {label}"),
        None => DEFAULT_TOOLTIP.to_string(),
    }
}

pub fn toggle_item_text(phase: TimerPhase, running: bool, idle: bool) -> &'static str {
    match (running, idle, phase) {
        (true, _, _) => "Pause",
        (false, true, TimerPhase::Focus) => "Start focus",
        (false, true, TimerPhase::Break) => "Start break",
        (false, false, _) => "Resume",
    }
}

pub fn skip_item_text(phase: TimerPhase) -> &'static str {
    match phase {
        TimerPhase::Focus => "Skip to break",
        TimerPhase::Break => "Skip to focus",
    }
}

/// Everything the status item shows, derived from a snapshot at a moment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayView {
    pub visible: bool,
    pub title: String,
    pub tooltip: String,
    pub toggle_text: &'static str,
    pub skip_text: &'static str,
}

impl TrayView {
    /// The state the status item is created in.
    pub fn hidden() -> Self {
        Self {
            visible: false,
            title: String::new(),
            tooltip: DEFAULT_TOOLTIP.to_string(),
            toggle_text: toggle_item_text(TimerPhase::Focus, false, true),
            skip_text: skip_item_text(TimerPhase::Focus),
        }
    }
}

/// Status item contents for `snapshot` at `now`. A missing or disabled
/// snapshot hides the item; menu texts keep their last values while hidden.
pub fn tray_view(
    snapshot: Option<&TimerSnapshot>,
    now: SystemTime,
    previous: &TrayView,
) -> TrayView {
    match snapshot {
        Some(snapshot) if snapshot.enabled => TrayView {
            visible: true,
            title: format_menu_bar_title(
                snapshot.phase,
                snapshot.running,
                snapshot.remaining_at(now),
            ),
            tooltip: tooltip_text(snapshot.label.as_deref()),
            toggle_text: toggle_item_text(snapshot.phase, snapshot.running, snapshot.idle),
            skip_text: skip_item_text(snapshot.phase),
        },
        _ => TrayView {
            visible: false,
            title: String::new(),
            ..previous.clone()
        },
    }
}

/// Create the status item and start the ticker. Failures are logged, never
/// fatal: the desktop app works the same without the menu bar timer.
pub fn setup(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if let Err(error) = native::install(app) {
            eprintln!("[AXOM] menu bar timer unavailable: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Keep the timer alive in the menu bar when the main window closes mid-sprint.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    #[cfg(target_os = "macos")]
    native::on_window_event(window, event);
    #[cfg(not(target_os = "macos"))]
    let _ = (window, event);
}

/// Bring the hidden window back when the Dock icon is clicked.
pub fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    native::on_run_event(app, event);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{TrayIcon, TrayIconBuilder};
    use tauri::{AppHandle, Emitter, Manager, RunEvent, Window, WindowEvent};

    pub(super) const MENU_BAR_ICON: &[u8] = include_bytes!("../icons/menu-bar-timer.png");
    const TICK_INTERVAL: Duration = Duration::from_millis(250);
    const MAIN_WINDOW: &str = "main";

    type InstallResult = Result<(), Box<dyn std::error::Error>>;

    pub(super) fn install(app: &AppHandle) -> InstallResult {
        let state = app
            .try_state::<MenuBarTimerState>()
            .ok_or("MenuBarTimerState is not managed")?;
        let snapshot = Arc::clone(&state.snapshot);
        let initial = TrayView::hidden();
        let toggle = MenuItem::with_id(app, MENU_TOGGLE, initial.toggle_text, true, None::<&str>)?;
        let skip = MenuItem::with_id(app, MENU_SKIP, initial.skip_text, true, None::<&str>)?;
        let reset = MenuItem::with_id(app, MENU_RESET, "Reset", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let open = MenuItem::with_id(app, MENU_OPEN, "Open AXOM", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, MENU_QUIT, "Quit AXOM", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&toggle, &skip, &reset, &separator, &open, &quit])?;

        let tray = TrayIconBuilder::with_id(TRAY_ID)
            .icon(Image::from_bytes(MENU_BAR_ICON)?)
            .icon_as_template(true)
            .tooltip(&initial.tooltip)
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
            .build(app)?;
        if let Err(error) = start_ticker(snapshot, tray, toggle, skip, initial) {
            // Leave no frozen status item behind in the menu bar.
            drop(app.remove_tray_by_id(TRAY_ID));
            return Err(error);
        }
        state.mark_installed();
        Ok(())
    }

    fn start_ticker(
        snapshot: Arc<Mutex<Option<TimerSnapshot>>>,
        tray: TrayIcon,
        toggle: MenuItem<tauri::Wry>,
        skip: MenuItem<tauri::Wry>,
        initial: TrayView,
    ) -> InstallResult {
        // Hidden until the web app reports an enabled timer. This runs in
        // setup on the main thread, so the item never gets drawn first.
        tray.set_visible(false)?;
        std::thread::Builder::new()
            .name("axom-menu-bar-timer".into())
            .spawn(move || run_ticker(snapshot, tray, toggle, skip, initial))?;
        Ok(())
    }

    fn run_ticker(
        snapshot: Arc<Mutex<Option<TimerSnapshot>>>,
        tray: TrayIcon,
        toggle: MenuItem<tauri::Wry>,
        skip: MenuItem<tauri::Wry>,
        mut applied: TrayView,
    ) {
        loop {
            std::thread::sleep(TICK_INTERVAL);
            // Copy, then release the lock before calling into Tauri.
            let current = lock_snapshot(&snapshot).clone();
            let next = tray_view(current.as_ref(), SystemTime::now(), &applied);
            if next != applied {
                apply_view(&tray, &toggle, &skip, &mut applied, next);
            }
        }
    }

    /// Push only what changed. Each field is recorded as applied only once
    /// Tauri accepted it, so a failed call is retried on the next tick.
    fn apply_view(
        tray: &TrayIcon,
        toggle: &MenuItem<tauri::Wry>,
        skip: &MenuItem<tauri::Wry>,
        applied: &mut TrayView,
        next: TrayView,
    ) {
        // Hide before clearing the title and set the title before showing,
        // so the item never flashes an empty or stale clock.
        let hiding = applied.visible && !next.visible;
        if hiding && tray.set_visible(false).is_ok() {
            applied.visible = false;
            // Showing again recreates the status item; redraw the pill then.
            applied.title.clear();
        }
        if next.tooltip != applied.tooltip && tray.set_tooltip(Some(next.tooltip.as_str())).is_ok()
        {
            applied.tooltip = next.tooltip.clone();
        }
        if next.toggle_text != applied.toggle_text && toggle.set_text(next.toggle_text).is_ok() {
            applied.toggle_text = next.toggle_text;
        }
        if next.skip_text != applied.skip_text && skip.set_text(next.skip_text).is_ok() {
            applied.skip_text = next.skip_text;
        }
        if next.visible && !applied.visible && tray.set_visible(true).is_ok() {
            applied.visible = true;
            applied.title.clear();
        }
        if applied.visible && next.title != applied.title {
            if let Ok(true) = crate::menu_bar_pill::apply(tray, &next.title) {
                applied.title = next.title.clone();
            }
        }
    }

    fn handle_menu_event(app: &AppHandle, id: &str) {
        let action = match id {
            // Explicit start/pause instead of a blind toggle, so a click that
            // races a phase change on the web side cannot invert the intent.
            MENU_TOGGLE => {
                if app
                    .try_state::<MenuBarTimerState>()
                    .is_some_and(|state| state.is_running())
                {
                    "pause"
                } else {
                    "start"
                }
            }
            MENU_SKIP => "skip",
            MENU_RESET => "reset",
            MENU_OPEN => {
                show_main_window(app);
                return;
            }
            MENU_QUIT => {
                app.exit(0);
                return;
            }
            // Menu events are global: ignore items that belong to other menus.
            _ => return,
        };
        if let Err(error) = app.emit(ACTION_EVENT, action) {
            eprintln!("[AXOM] menu bar timer action failed: {error}");
        }
    }

    fn show_main_window(app: &AppHandle) {
        let _ = app.show();
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    pub(super) fn on_window_event(window: &Window, event: &WindowEvent) {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if window.label() == MAIN_WINDOW
                && window
                    .try_state::<MenuBarTimerState>()
                    .is_some_and(|state| state.keeps_running_in_menu_bar())
            {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    }

    pub(super) fn on_run_event(app: &AppHandle, event: RunEvent) {
        if let RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } = event
        {
            show_main_window(app);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(phase: TimerPhase, running: bool, seconds_left: f64) -> MenuBarTimerInput {
        MenuBarTimerInput {
            enabled: true,
            phase,
            running,
            seconds_left,
            idle: false,
            label: None,
        }
    }

    #[test]
    fn formats_running_focus_and_break() {
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, true, 24 * 60 + 13),
            "24:13  ⋯"
        );
        assert_eq!(
            format_menu_bar_title(TimerPhase::Break, true, 4 * 60 + 59),
            "Break 04:59  ⋯"
        );
    }

    #[test]
    fn formats_paused_for_either_phase() {
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, false, 24 * 60 + 13),
            "‖ 24:13  ⋯"
        );
        assert_eq!(
            format_menu_bar_title(TimerPhase::Break, false, 5 * 60),
            "‖ 05:00  ⋯"
        );
        // An idle, never-started timer still shows its full length.
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, false, 25 * 60),
            "‖ 25:00  ⋯"
        );
    }

    #[test]
    fn formats_hours_and_the_finished_state() {
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, true, 3900),
            "1:05:00  ⋯"
        );
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, false, 2 * 3600),
            "‖ 2:00:00  ⋯"
        );
        assert_eq!(format_menu_bar_title(TimerPhase::Focus, true, 0), "Done  ⋯");
        assert_eq!(format_menu_bar_title(TimerPhase::Break, true, 0), "Done  ⋯");
        assert_eq!(
            format_menu_bar_title(TimerPhase::Focus, false, 0),
            "‖ 00:00  ⋯"
        );
    }

    #[test]
    fn formats_clock_boundaries() {
        assert_eq!(format_clock(0), "00:00");
        assert_eq!(format_clock(59), "00:59");
        assert_eq!(format_clock(3599), "59:59");
        assert_eq!(format_clock(3600), "1:00:00");
        assert_eq!(format_clock(MAX_SECONDS), "24:00:00");
    }

    #[test]
    fn counts_down_only_while_running() {
        let elapsed = Duration::from_millis(61_900);
        assert_eq!(remaining_seconds(1500, true, elapsed), 1439);
        assert_eq!(remaining_seconds(1500, false, elapsed), 1500);
        assert_eq!(remaining_seconds(30, true, Duration::from_secs(45)), 0);
        assert_eq!(
            remaining_seconds(30, true, Duration::from_secs(u64::MAX)),
            0
        );
    }

    #[test]
    fn snapshot_remaining_uses_receipt_time_and_tolerates_clock_rollback() {
        let received = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let snapshot = TimerSnapshot::from_input(input(TimerPhase::Focus, true, 600.0), received);
        assert_eq!(
            snapshot.remaining_at(received + Duration::from_millis(2_400)),
            598
        );
        assert_eq!(
            snapshot.remaining_at(received - Duration::from_secs(30)),
            600
        );
        let paused = TimerSnapshot::from_input(input(TimerPhase::Focus, false, 600.0), received);
        assert_eq!(paused.remaining_at(received + Duration::from_secs(90)), 600);
    }

    #[test]
    fn sanitizes_seconds_from_javascript_numbers() {
        assert_eq!(sanitize_seconds(1499.6), 1500);
        assert_eq!(sanitize_seconds(-3.0), 0);
        assert_eq!(sanitize_seconds(f64::NAN), 0);
        assert_eq!(sanitize_seconds(f64::INFINITY), 0);
        assert_eq!(sanitize_seconds(10.0 * MAX_SECONDS as f64), MAX_SECONDS);
    }

    #[test]
    fn sanitizes_labels() {
        assert_eq!(sanitize_label(None), None);
        assert_eq!(sanitize_label(Some("   ")), None);
        assert_eq!(
            sanitize_label(Some("  Renal\n  block \t")),
            Some("Renal block".to_string())
        );
        let long = "Cardiology".repeat(6);
        let truncated = sanitize_label(Some(&long)).unwrap();
        assert_eq!(truncated.chars().count(), MAX_LABEL_CHARS);
        assert!(truncated.ends_with('…'));
        let exact = "x".repeat(MAX_LABEL_CHARS);
        assert_eq!(sanitize_label(Some(&exact)), Some(exact.clone()));
        // Multi-byte characters are counted as characters, not bytes.
        let accents = "é".repeat(MAX_LABEL_CHARS + 5);
        assert_eq!(
            sanitize_label(Some(&accents)).unwrap().chars().count(),
            MAX_LABEL_CHARS
        );
    }

    #[test]
    fn menu_texts_follow_state() {
        assert_eq!(toggle_item_text(TimerPhase::Focus, true, false), "Pause");
        assert_eq!(
            toggle_item_text(TimerPhase::Focus, false, true),
            "Start focus"
        );
        assert_eq!(
            toggle_item_text(TimerPhase::Break, false, true),
            "Start break"
        );
        assert_eq!(toggle_item_text(TimerPhase::Focus, false, false), "Resume");
        assert_eq!(skip_item_text(TimerPhase::Focus), "Skip to break");
        assert_eq!(skip_item_text(TimerPhase::Break), "Skip to focus");
    }

    #[test]
    fn running_snapshot_is_never_idle() {
        let mut running = input(TimerPhase::Focus, true, 1500.0);
        running.idle = true;
        assert!(!TimerSnapshot::from_input(running, SystemTime::now()).idle);
    }

    #[test]
    fn tray_view_hides_without_an_enabled_snapshot() {
        let now = SystemTime::now();
        let previous = TrayView::hidden();
        assert_eq!(tray_view(None, now, &previous), previous);

        let mut disabled = input(TimerPhase::Break, true, 120.0);
        disabled.enabled = false;
        let disabled = TimerSnapshot::from_input(disabled, now);
        let view = tray_view(Some(&disabled), now, &previous);
        assert!(!view.visible);
        assert_eq!(view.title, "");
    }

    #[test]
    fn tray_view_shows_the_clock_label_and_menu_texts() {
        let received = SystemTime::UNIX_EPOCH + Duration::from_secs(5_000);
        let mut focus = input(TimerPhase::Focus, true, 1500.0);
        focus.label = Some("Renal physiology".into());
        let snapshot = TimerSnapshot::from_input(focus, received);
        let view = tray_view(
            Some(&snapshot),
            received + Duration::from_secs(47),
            &TrayView::hidden(),
        );
        assert_eq!(
            view,
            TrayView {
                visible: true,
                title: "24:13  ⋯".into(),
                tooltip: "AXOM focus · Renal physiology".into(),
                toggle_text: "Pause",
                skip_text: "Skip to break",
            }
        );

        let mut idle = input(TimerPhase::Focus, false, 1500.0);
        idle.idle = true;
        let idle = TimerSnapshot::from_input(idle, received);
        let view = tray_view(
            Some(&idle),
            received + Duration::from_secs(600),
            &TrayView::hidden(),
        );
        assert_eq!(view.title, "‖ 25:00  ⋯");
        assert_eq!(view.tooltip, DEFAULT_TOOLTIP);
        assert_eq!(view.toggle_text, "Start focus");
    }

    #[test]
    fn state_keeps_running_only_for_enabled_running_timers() {
        let state = MenuBarTimerState::default();
        state.mark_installed();
        assert!(!state.keeps_running_in_menu_bar());
        state.set(Some(TimerSnapshot::from_input(
            input(TimerPhase::Focus, true, 60.0),
            SystemTime::now(),
        )));
        assert!(state.keeps_running_in_menu_bar());
        state.set(Some(TimerSnapshot::from_input(
            input(TimerPhase::Focus, false, 60.0),
            SystemTime::now(),
        )));
        assert!(!state.keeps_running_in_menu_bar());
        let mut disabled = input(TimerPhase::Focus, true, 60.0);
        disabled.enabled = false;
        state.set(Some(TimerSnapshot::from_input(disabled, SystemTime::now())));
        assert!(!state.keeps_running_in_menu_bar());
        state.set(None);
        assert!(!state.keeps_running_in_menu_bar());
    }

    #[test]
    fn closing_quits_normally_when_the_status_item_never_installed() {
        // install() failed (or is not supported on this OS): a running timer
        // must not hide the window, since nothing in the menu bar could bring
        // it back or show the clock.
        let state = MenuBarTimerState::default();
        state.set(Some(TimerSnapshot::from_input(
            input(TimerPhase::Focus, true, 60.0),
            SystemTime::now(),
        )));
        assert!(!state.keeps_running_in_menu_bar());
        state.mark_installed();
        assert!(state.keeps_running_in_menu_bar());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn menu_bar_icon_is_a_36px_template_with_transparency() {
        let icon = tauri::image::Image::from_bytes(native::MENU_BAR_ICON).unwrap();
        assert_eq!((icon.width(), icon.height()), (36, 36));
        let alpha = icon.rgba().chunks_exact(4).map(|pixel| pixel[3]);
        let (transparent, opaque) = alpha.fold((0, 0), |(clear, solid), a| match a {
            0 => (clear + 1, solid),
            255 => (clear, solid + 1),
            _ => (clear, solid),
        });
        assert!(transparent > 400, "background should be transparent");
        assert!(opaque > 150, "glyph should be solid");
        // Template images draw from alpha only; the glyph itself is black.
        assert!(icon
            .rgba()
            .chunks_exact(4)
            .all(|pixel| pixel[..3] == [0, 0, 0]));
    }

    #[test]
    fn deserializes_the_web_snapshot_shape() {
        let parsed: MenuBarTimerInput = serde_json::from_str(
            r#"{"enabled":true,"phase":"break","running":false,"secondsLeft":299.5,"idle":true,"label":"Cardio"}"#,
        )
        .unwrap();
        assert_eq!(parsed.phase, TimerPhase::Break);
        assert!(parsed.idle);
        assert_eq!(sanitize_seconds(parsed.seconds_left), 300);
        let minimal: MenuBarTimerInput = serde_json::from_str(
            r#"{"enabled":false,"phase":"focus","running":false,"secondsLeft":0}"#,
        )
        .unwrap();
        assert!(!minimal.idle);
        assert_eq!(minimal.label, None);
        assert!(serde_json::from_str::<MenuBarTimerInput>(
            r#"{"enabled":true,"phase":"nap","running":false,"secondsLeft":0}"#
        )
        .is_err());
    }
}
