// Mounted once at the app root, next to PomodoroFx. Inside the macOS desktop
// app it mirrors the Pomodoro clock into the menu bar (see
// src-tauri/src/menu_bar_timer.rs) and runs the menu bar's Pause / Skip / Reset
// against the same timer store the in-app controls use. In a browser it renders
// nothing and never loads the Tauri bridge modules.
import { useEffect } from "react";
import { pomodoroPhaseSeconds, reconcilePomodoro, usePomodoro } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { isMacDesktopShell } from "../../lib/desktopShell";
import {
  MENU_BAR_ACTION_EVENT,
  MENU_BAR_CLEAR_COMMAND,
  MENU_BAR_UPDATE_COMMAND,
  isMenuBarTimerEnabled,
  menuBarSnapshot,
  parseMenuBarAction,
  shouldSendSnapshot,
  type MenuBarTimerAction,
  type MenuBarTimerSnapshot,
} from "../../lib/menuBarTimer";

type Invoke = typeof import("@tauri-apps/api/core")["invoke"];
type TauriApi = [typeof import("@tauri-apps/api/core"), typeof import("@tauri-apps/api/event")];
type PomodoroSnapshot = ReturnType<typeof usePomodoro.getState>;

let tauriApi: Promise<TauriApi> | null = null;

/**
 * Load the Tauri bridge modules once and share the load across mounts
 * (StrictMode, setup re-runs). A failed load is retried on the next mount.
 */
function loadTauriApi(): Promise<TauriApi> {
  tauriApi ??= Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]).catch((error: unknown) => {
    tauriApi = null;
    throw error;
  });
  return tauriApi;
}

const phaseSeconds = (state: PomodoroSnapshot) => pomodoroPhaseSeconds(state);

function runMenuBarAction(action: MenuBarTimerAction) {
  // A menu bar click does not focus the page, so PomodoroFx's focus listener
  // never catches the clock up first. Do it here, or a hidden window's stale
  // secondsLeft would be paused, skipped, or logged.
  const phaseShown = usePomodoro.getState().phase;
  reconcilePomodoro();
  const pomodoro = usePomodoro.getState();
  // The catch-up finished the phase the menu offered to skip (and logged it
  // as complete), so skipping again would skip the next phase too.
  if (action === "skip" && pomodoro.phase !== phaseShown) return;
  switch (action) {
    case "toggle": pomodoro.toggle(); break;
    case "start": pomodoro.start(); break;
    case "pause": pomodoro.pause(); break;
    case "skip": pomodoro.skip(); break;
    case "reset": pomodoro.reset(); break;
  }
}

function warn(message: string, error: unknown) {
  console.warn(`[AXOM] ${message}`, error);
}

export function MenuBarTimerBridge() {
  useEffect(() => {
    if (!isMacDesktopShell()) return;
    let disposed = false;
    let invoke: Invoke | null = null;
    let unlisten: (() => unknown) | null = null;
    const unsubscribers: Array<() => void> = [];
    let lastSent: MenuBarTimerSnapshot | null = null;
    let lastSentAt = 0;

    const release = (stop: () => unknown) => {
      Promise.resolve().then(stop).catch((error) => warn("menu bar timer listener cleanup failed", error));
    };

    const sync = () => {
      if (disposed || !invoke) return;
      const state = usePomodoro.getState();
      const enabled = isMenuBarTimerEnabled(useStore.getState().profile?.pomodoroPreferences);
      const next = menuBarSnapshot(state, enabled, phaseSeconds(state));
      const now = Date.now();
      if (!shouldSendSnapshot(lastSent, next, lastSentAt, now)) return;
      lastSent = next;
      lastSentAt = now;
      invoke(MENU_BAR_UPDATE_COMMAND, { snapshot: next }).catch((error) => {
        lastSent = null; // resend on the next change
        warn("menu bar timer update failed", error);
      });
    };

    const connect = async () => {
      const [core, events] = await loadTauriApi();
      if (disposed) return;
      invoke = core.invoke;
      unsubscribers.push(
        usePomodoro.subscribe(sync),
        useStore.subscribe((state, previous) => {
          if (state.profile?.pomodoroPreferences !== previous.profile?.pomodoroPreferences) sync();
        }),
      );
      sync();
      try {
        const stop = await events.listen<unknown>(MENU_BAR_ACTION_EVENT, ({ payload }) => {
          const action = parseMenuBarAction(payload);
          if (action) runMenuBarAction(action);
        });
        if (disposed) release(stop);
        else unlisten = stop;
      } catch (error) {
        warn("menu bar timer actions unavailable", error);
      }
    };

    connect().catch((error) => warn("menu bar timer unavailable", error));

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (unlisten) release(unlisten);
      if (invoke) invoke(MENU_BAR_CLEAR_COMMAND).catch((error) => warn("menu bar timer clear failed", error));
    };
  }, []);

  return null;
}
