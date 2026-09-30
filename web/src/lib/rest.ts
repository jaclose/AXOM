// ===========================================================================
// "Put my head down" — a short rest with a gentle alarm. Starting a rest
// pauses whatever is running (Pomodoro, study session), optionally plays soft
// rain, and wakes the learner with a slowly rising bell chime plus a system
// notification. The end time is an absolute timestamp, so reloads, sleep and
// background tabs never stretch the rest; a rest that ended long ago while
// AXOM was closed is closed quietly instead of ringing late.
// ===========================================================================
import { create } from "zustand";
import { notify } from "./notify";
import { usePomodoro } from "./pomodoro";
import { useStore } from "./store";
import { findLiveSession } from "./sessions";
import { useSoundscape } from "./soundscapes/store";

import { alarmLevel, primeRestAlarm, startRestAlarm, stopRestAlarm } from "./restAlarm";
import { normalizeRestPreferences, readRestPreferences, REST_PREFERENCES_KEY, type RestPreferences, type RestPreset } from "./restPreferences";
export { alarmLevel, primeRestAlarm };

export type RestStatus = "idle" | "resting" | "ringing";

export interface RestEntry {
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  /** False when the learner woke early. */
  completed: boolean;
}

interface Persisted {
  status: RestStatus;
  startedAt?: number;
  endsAt?: number;
  plannedMinutes: number;
  withSound: boolean;
  /** What the rest paused, so "Resume focus" can pick it back up. */
  paused?: { pomodoro?: boolean; sessionId?: string };
}

interface RestState extends Persisted {
  overlayOpen: boolean;
  preferences: RestPreferences;
  presets: RestPreset[];
  audioError?: string;
  setPreferences: (patch: Partial<RestPreferences>) => void;
  savePreset: (name: string) => void;
  removePreset: (id: string) => void;
  start: (minutes?: number) => void;
  extend: (minutes: number) => void;
  wakeNow: () => void;
  snooze: (minutes?: number) => void;
  dismiss: (options?: { resume?: boolean }) => void;
  setOverlayOpen: (open: boolean) => void;
  setWithSound: (value: boolean) => void;
  /** Advance the state machine against the wall clock. */
  check: (now?: number) => void;
}

export const REST_KEY = "axom.rest.v1";
export const REST_LOG_KEY = "axom.rest.log.v1";
export const DEFAULT_REST_MINUTES = 15;
/** A rest that ended this long ago while AXOM was closed closes quietly. */
export const LATE_RING_LIMIT_MS = 10 * 60_000;
/** Ringing stops by itself after this long. */
export const RING_LIMIT_MS = 3 * 60_000;

function readPersisted(): Persisted {
  try {
    const raw = JSON.parse(window.localStorage.getItem(REST_KEY) ?? "null") as Partial<Persisted> | null;
    if (!raw || (raw.status !== "resting" && raw.status !== "ringing")) {
      return { status: "idle", plannedMinutes: DEFAULT_REST_MINUTES, withSound: raw?.withSound ?? false };
    }
    return {
      status: raw.status,
      startedAt: Number(raw.startedAt) || undefined,
      endsAt: Number(raw.endsAt) || undefined,
      plannedMinutes: Number(raw.plannedMinutes) || DEFAULT_REST_MINUTES,
      withSound: raw.withSound === true,
      paused: raw.paused,
    };
  } catch {
    return { status: "idle", plannedMinutes: DEFAULT_REST_MINUTES, withSound: false };
  }
}

export function readRestLog(): RestEntry[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(REST_LOG_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((entry): entry is RestEntry => Boolean(entry && typeof entry.startedAt === "string" && typeof entry.endedAt === "string")) : [];
  } catch {
    return [];
  }
}

function appendRestLog(entry: RestEntry): void {
  try {
    const cutoff = Date.now() - 60 * 86_400_000;
    const log = [...readRestLog().filter((item) => Date.parse(item.startedAt) >= cutoff), entry].slice(-400);
    window.localStorage.setItem(REST_LOG_KEY, JSON.stringify(log));
  } catch { /* the log is optional */ }
}

// Rest owns only its temporary audio adjustment. User volume stays untouched.
let pausedSoundscape: { id: string; paused: boolean } | undefined;
function adjustSoundscape(mode: RestPreferences["soundscapeMode"]) {
  const soundscape = useSoundscape.getState();
  if (soundscape.status !== "playing" || !soundscape.presetId) return;
  pausedSoundscape = { id: soundscape.presetId, paused: mode === "pause" };
  if (mode === "pause") void soundscape.pause();
  if (mode === "duck") soundscape.setDucking(.2);
}
function restoreSoundscape() {
  const soundscape = useSoundscape.getState();
  soundscape.setDucking(1);
  if (pausedSoundscape?.paused && soundscape.status === "paused" && soundscape.presetId === pausedSoundscape.id) void soundscape.resume();
  pausedSoundscape = undefined;
}

// --- State machine --------------------------------------------------------
let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicker(): void {
  if (ticker || typeof window === "undefined") return;
  ticker = setInterval(() => useRest.getState().check(), 1000);
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

export const useRest = create<RestState>((set, get) => {
  const persist = (patch: Partial<Persisted>) => {
    set(patch);
    const { status, startedAt, endsAt, plannedMinutes, withSound, paused } = get();
    try {
      window.localStorage.setItem(REST_KEY, JSON.stringify({ status, startedAt, endsAt, plannedMinutes, withSound, paused }));
    } catch { /* device-only */ }
  };

  const finish = (completed: boolean) => {
    const { startedAt, plannedMinutes } = get();
    if (startedAt) {
      appendRestLog({ startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), plannedMinutes, completed });
    }
  };

  return {
    ...readPersisted(),
    ...readRestPreferences(),
    overlayOpen: false,

    setPreferences(patch) {
      set({ preferences: normalizeRestPreferences({ ...get().preferences, ...patch }) });
      try { localStorage.setItem(REST_PREFERENCES_KEY, JSON.stringify({ preferences: get().preferences, presets: get().presets })); } catch { /* device preferences */ }
    },
    savePreset(name) {
      if (!name.trim()) return;
      set({ presets: [...get().presets, { id: crypto.randomUUID(), name: name.trim().slice(0, 60), preferences: { ...get().preferences } }].slice(-12) });
      get().setPreferences({});
    },
    removePreset(id) {
      set({ presets: get().presets.filter((item) => item.id !== id) });
      get().setPreferences({});
    },
    start(minutes = get().preferences.minutes) {
      if (get().status !== "idle") { set({ overlayOpen: true }); return; }
      minutes = normalizeRestPreferences({ minutes }).minutes;
      primeRestAlarm();
      const now = Date.now();
      const paused: Persisted["paused"] = {};
      const pomodoro = usePomodoro.getState();
      if (pomodoro.running) {
        pomodoro.pause();
        paused.pomodoro = true;
      }
      const store = useStore.getState();
      const session = findLiveSession(store.sessions ?? []);
      if (session?.status === "active") {
        store.pauseSession(session.id);
        paused.sessionId = session.id;
      }
      persist({ status: "resting", startedAt: now, endsAt: now + minutes * 60_000, plannedMinutes: minutes, paused });
      set({ overlayOpen: true });
      if (get().withSound) void useSoundscape.getState().play("soft-rain", { stopAfterMinutes: minutes });
      else adjustSoundscape(get().preferences.soundscapeMode);
      ensureTicker();
    },

    extend(minutes) {
      const { status, endsAt } = get();
      if (status !== "resting" || !endsAt || !Number.isFinite(minutes) || minutes <= 0) return;
      persist({ endsAt: endsAt + minutes * 60_000, plannedMinutes: get().plannedMinutes + minutes });
    },

    wakeNow() {
      if (get().status === "idle") return;
      stopRestAlarm();
      finish(get().status === "ringing");
      persist({ status: "idle", startedAt: undefined, endsAt: undefined });
      set({ overlayOpen: false });
      restoreSoundscape();
      stopTicker();
      if (get().withSound && useSoundscape.getState().presetId === "soft-rain") void useSoundscape.getState().stop(2);
    },

    snooze(minutes = 5) {
      if (get().status !== "ringing") return;
      minutes = normalizeRestPreferences({ minutes }).minutes;
      stopRestAlarm();
      const now = Date.now();
      persist({ status: "resting", endsAt: now + minutes * 60_000, plannedMinutes: get().plannedMinutes + minutes });
      ensureTicker();
    },

    dismiss(options = {}) {
      const paused = get().paused;
      get().wakeNow();
      persist({ paused: undefined });
      if (!options.resume || !paused) return;
      if (paused.pomodoro) usePomodoro.getState().start();
      if (paused.sessionId) useStore.getState().resumeSession(paused.sessionId);
    },

    setOverlayOpen(open) {
      set({ overlayOpen: open });
    },

    setWithSound(value) {
      persist({ withSound: value });
    },

    check(now = Date.now()) {
      const { status, endsAt } = get();
      if (status === "resting" && endsAt && now >= endsAt) {
        if (now - endsAt > LATE_RING_LIMIT_MS) {
          // Ended long ago while AXOM was closed: close it quietly.
          finish(true);
          persist({ status: "idle", startedAt: undefined, endsAt: undefined });
          restoreSoundscape();
          stopTicker();
          return;
        }
        persist({ status: "ringing" });
        set({ overlayOpen: true });
        void startRestAlarm(get().preferences, { onError: (audioError) => set({ audioError }) });
        if (get().preferences.systemNotification) void notify("AXOM — time to lift your head", "Your rest is over. Ease back in when you’re ready.", { tag: "axom-rest", route: "productivity", action: "rest", dedupeKey: `rest:${endsAt}`, silent: true });
        return;
      }
      if (status === "ringing" && endsAt && now - endsAt > RING_LIMIT_MS) stopRestAlarm();
    },
  };
});

/** Resume the ticker after a reload (a rest in progress keeps counting). */
export function restoreRest(): void {
  const { status } = useRest.getState();
  if (status === "resting" || status === "ringing") {
    ensureTicker();
    useRest.getState().check();
  }
}

export function formatRestClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
