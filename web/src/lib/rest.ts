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

// --- Gentle alarm ---------------------------------------------------------
// A soft bell arpeggio (C major pentatonic) whose volume rises over ~40 s.
// The AudioContext is created while starting the rest (a user gesture), so
// it may play later from a timer without being blocked by autoplay rules.
const CHIME_NOTES = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
let alarmContext: AudioContext | null = null;
let alarmTimer: ReturnType<typeof setInterval> | null = null;
let alarmStartedAt = 0;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  alarmContext ??= new Ctor();
  return alarmContext;
}

/** Called from the start gesture: unlocks audio for the later alarm. */
export function primeRestAlarm(): void {
  const ctx = audioContext();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}

function bell(ctx: AudioContext, frequency: number, at: number, level: number): void {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(level, at + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
  out.connect(ctx.destination);
  // Inharmonic partials give a soft bell rather than a beep.
  [[1, 1], [2.756, 0.32], [5.404, 0.1]].forEach(([ratio, amp]) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency * ratio;
    const partial = ctx.createGain();
    partial.gain.value = amp;
    osc.connect(partial).connect(out);
    osc.start(at);
    osc.stop(at + 2.7);
    osc.onended = () => { osc.disconnect(); partial.disconnect(); };
  });
}

/** Volume rises from a whisper to a clear chime over the first 40 seconds. */
export function alarmLevel(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / 40_000));
  return 0.035 + (0.26 - 0.035) * t * t;
}

function startAlarm(): void {
  stopAlarm();
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
  alarmStartedAt = Date.now();
  const phrase = () => {
    const level = alarmLevel(Date.now() - alarmStartedAt);
    CHIME_NOTES.forEach((note, index) => bell(ctx, note, ctx.currentTime + 0.05 + index * 0.42, level));
  };
  phrase();
  alarmTimer = setInterval(phrase, 5200);
}

function stopAlarm(): void {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
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
    overlayOpen: false,

    start(minutes = DEFAULT_REST_MINUTES) {
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
      ensureTicker();
    },

    extend(minutes) {
      const { status, endsAt } = get();
      if (status !== "resting" || !endsAt) return;
      persist({ endsAt: endsAt + minutes * 60_000, plannedMinutes: get().plannedMinutes + minutes });
    },

    wakeNow() {
      if (get().status === "idle") return;
      stopAlarm();
      finish(get().status === "ringing");
      persist({ status: "idle", startedAt: undefined, endsAt: undefined });
      set({ overlayOpen: false });
      stopTicker();
      if (useSoundscape.getState().presetId === "soft-rain") void useSoundscape.getState().stop(2);
    },

    snooze(minutes = 5) {
      stopAlarm();
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
          stopTicker();
          return;
        }
        persist({ status: "ringing" });
        set({ overlayOpen: true });
        startAlarm();
        void notify("Time to lift your head", "Your rest is over — ease back in when you’re ready.", { tag: "axom-rest" });
        return;
      }
      if (status === "ringing" && endsAt && now - endsAt > RING_LIMIT_MS) stopAlarm();
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
