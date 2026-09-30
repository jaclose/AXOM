// ===========================================================================
// Pomodoro focus timer. A small, self-contained zustand store kept OUT of the
// persisted vault: the timer is ephemeral session state, but it is global so the
// Productivity panel and the Dashboard widget always show the same running clock.
// When a focus phase completes naturally it auto-logs its minutes to the active
// study day through the main store, so finished sprints feed productivity.
//
// The "Custom" preset is user-configurable (§3): its durations live on the main
// store's profile (so they back up + sync) and are mirrored into the timer
// snapshot so a reload restores them before the vault rehydrates.
// ===========================================================================
import { create } from "zustand";
import type { StudyActivity } from "./studyActivity";
import { useStore } from "./store";
import { effectivePomodoroPreferences } from "./pomodoroPreferences";

export interface PomodoroPreset {
  id: string;
  label: string;
  focus: number; // minutes
  break: number; // minutes
  longBreak?: number;
  cyclesBeforeLongBreak?: number;
  defaultTrackerId?: string;
}

export const POMODORO_PRESETS: PomodoroPreset[] = [
  { id: "90-20", label: "90 / 20", focus: 90, break: 20, longBreak: 30, cyclesBeforeLongBreak: 3, defaultTrackerId: "tracker-study" },
  { id: "50-10", label: "50 / 10", focus: 50, break: 10, longBreak: 25, cyclesBeforeLongBreak: 4, defaultTrackerId: "tracker-study" },
  { id: "120-25", label: "120 / 25", focus: 120, break: 25, longBreak: 40, cyclesBeforeLongBreak: 3, defaultTrackerId: "tracker-study" },
  { id: "25-5", label: "25 / 5", focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4, defaultTrackerId: "tracker-study" },
  { id: "custom", label: "Custom", focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 },
];

export const PRIMARY_POMODORO_PRESET_IDS = ["90-20", "50-10", "120-25", "custom"] as const;

export const DEFAULT_CUSTOM = { focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 };
const clampMin = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

function validCyclesBeforeLongBreak(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0
    ? clampMin(Number(value), 1, 12)
    : DEFAULT_CUSTOM.cyclesBeforeLongBreak;
}

export interface PomodoroCustomDurations {
  focus: number;
  break: number;
  longBreak: number;
  cyclesBeforeLongBreak: number;
}

/** Clamp a custom timer before it reaches either session or profile storage. */
export function clampPomodoroCustomDurations(input: PomodoroCustomDurations): PomodoroCustomDurations {
  return {
    focus: clampMin(input.focus, 1, 180),
    break: clampMin(input.break, 1, 90),
    longBreak: clampMin(input.longBreak, 1, 120),
    cyclesBeforeLongBreak: validCyclesBeforeLongBreak(input.cyclesBeforeLongBreak),
  };
}

/**
 * Select the duration of the break represented by a completed-session count.
 * This is the single cadence rule used when a break starts, is restored, is
 * re-fit after a custom edit, or is rendered by the progress ring.
 */
export function getBreakDurationMinutes({
  sessionsToday,
  cyclesBeforeLongBreak,
  shortBreak,
  longBreak,
}: {
  sessionsToday: number;
  cyclesBeforeLongBreak?: number;
  shortBreak: number;
  longBreak?: number;
}): number {
  const sessions = Number.isFinite(sessionsToday) ? Math.max(0, Math.floor(sessionsToday)) : 0;
  const cycles = validCyclesBeforeLongBreak(cyclesBeforeLongBreak);
  const shortMinutes = clampMin(shortBreak, 1, 90);
  const longMinutes = longBreak == null || !Number.isFinite(longBreak)
    ? shortMinutes
    : clampMin(longBreak, 1, 120);
  return sessions > 0 && sessions % cycles === 0 ? longMinutes : shortMinutes;
}

export type PomodoroPhase = "focus" | "break";
export type PomodoroTargetKind = "free" | "tracker" | "blueprint";

interface CustomDurations {
  customFocus: number;
  customBreak: number;
  customLongBreak: number;
  customCycles: number;
}

interface FocusRun {
  focusRunId?: string;
  focusSegments?: Array<{ startedAt: string; endedAt: string }>;
  focusSegmentStart?: string;
}

interface PersistedPomodoro extends CustomDurations, FocusRun {
  presetId: string;
  phase: PomodoroPhase;
  secondsLeft: number;
  running: boolean;
  autoLog: boolean;
  anchorDay: string;
  sessionsToday: number;
  loggedMinutesToday: number;
  targetKind: PomodoroTargetKind;
  targetId?: string;
  targetLabel?: string;
  intention?: string;
  activeSavedPresetId?: string;
  focusRunStarted?: boolean;
  updatedAt: number;
}

interface PomodoroState extends CustomDurations, FocusRun {
  presetId: string;
  phase: PomodoroPhase;
  secondsLeft: number;
  running: boolean;
  autoLog: boolean;
  anchorDay: string;
  sessionsToday: number;
  loggedMinutesToday: number;
  targetKind: PomodoroTargetKind;
  targetId?: string;
  targetLabel?: string;
  intention: string;
  activeSavedPresetId?: string;
  focusRunStarted: boolean;
  lastTickAt: number;
  // FX signal — bumped each time a focus sprint completes so the app root can
  // fire the page glow + completion toast (kept here so it works on any page).
  completedAt: string | null;
  completedMinutes: number;
  // actions
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  setPreset: (id: string) => void;
  setAutoLog: (value: boolean) => void;
  setCustom: (patch: Partial<{ focus: number; break: number; longBreak: number; cyclesBeforeLongBreak: number }>) => void;
  runCustom: (preset: { focus: number; break: number; longBreak: number; cyclesBeforeLongBreak: number; intention?: string }, savedPresetId?: string) => void;
  setTarget: (target: { kind: PomodoroTargetKind; id?: string; label?: string }) => void;
  setIntention: (value: string) => void;
  _tick: () => void;
}

const PRESET_ALIASES: Record<string, string> = {
  "deep-study": "50-10",
  "anki": "25-5",
  "lecture-review": "50-10",
  "coding": "50-10",
  "reading": "25-5",
};

const presetById = (id: string): PomodoroPreset =>
  POMODORO_PRESETS.find((preset) => preset.id === (PRESET_ALIASES[id] ?? id)) ?? POMODORO_PRESETS[0];

/** The effective preset, resolving "custom" against the user's live durations. */
export function effectivePreset(s: { presetId: string } & CustomDurations): PomodoroPreset {
  if ((PRESET_ALIASES[s.presetId] ?? s.presetId) === "custom") {
    return { id: "custom", label: "Custom", focus: s.customFocus, break: s.customBreak, longBreak: s.customLongBreak, cyclesBeforeLongBreak: s.customCycles };
  }
  return presetById(s.presetId);
}

/** Custom durations from the persisted profile (or defaults). */
function profileCustom(): CustomDurations {
  const c = useStore.getState().profile.pomodoroCustom;
  return {
    customFocus: clampMin(c?.focus ?? DEFAULT_CUSTOM.focus, 1, 180),
    customBreak: clampMin(c?.break ?? DEFAULT_CUSTOM.break, 1, 90),
    customLongBreak: clampMin(c?.longBreak ?? DEFAULT_CUSTOM.longBreak, 1, 120),
    customCycles: validCyclesBeforeLongBreak(c?.cyclesBeforeLongBreak),
  };
}

let interval: ReturnType<typeof setInterval> | null = null;
const POMO_KEY = "noctyrium-pomodoro-session";

function startInterval(tick: () => void) {
  if (interval) return;
  interval = setInterval(tick, 1000);
}
function stopInterval() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

function readPersisted(): Partial<PersistedPomodoro> {
  const fallbackCustom = profileCustom();
  try {
    const raw = localStorage.getItem(POMO_KEY);
    if (!raw) return fallbackCustom;
    const parsed = JSON.parse(raw) as PersistedPomodoro;
    const custom: CustomDurations = {
      customFocus: clampMin(parsed.customFocus ?? fallbackCustom.customFocus, 1, 180),
      customBreak: clampMin(parsed.customBreak ?? fallbackCustom.customBreak, 1, 90),
      customLongBreak: clampMin(parsed.customLongBreak ?? fallbackCustom.customLongBreak, 1, 120),
      customCycles: validCyclesBeforeLongBreak(parsed.customCycles ?? fallbackCustom.customCycles),
    };
    const phase = parsed.phase === "break" ? "break" : "focus";
    const preset = effectivePreset({ presetId: parsed.presetId, ...custom });
    const sessionsToday = Number.isFinite(parsed.sessionsToday) ? Math.max(0, Math.floor(parsed.sessionsToday)) : 0;
    const breakMinutes = getBreakDurationMinutes({
      sessionsToday,
      cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
      shortBreak: preset.break,
      longBreak: preset.longBreak,
    });
    const maxSeconds = (phase === "focus" ? clampMin(preset.focus, 1, 180) : breakMinutes) * 60;
    const storedSeconds = Number(parsed.secondsLeft);
    const updatedAt = Number(parsed.updatedAt);
    const elapsedSeconds = parsed.running && Number.isFinite(updatedAt)
      ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
      : 0;
    const remainingSeconds = (Number.isFinite(storedSeconds) ? storedSeconds : maxSeconds) - elapsedSeconds;
    return {
      ...parsed,
      ...custom,
      phase,
      secondsLeft: Math.max(parsed.running ? 1 : 0, Math.min(maxSeconds, remainingSeconds)),
      sessionsToday,
      presetId: PRESET_ALIASES[parsed.presetId] ?? parsed.presetId,
      targetKind: parsed.targetKind ?? "free",
      intention: parsed.intention ?? "",
      activeSavedPresetId: typeof parsed.activeSavedPresetId === "string" ? parsed.activeSavedPresetId : undefined,
      focusRunStarted: parsed.focusRunStarted === true,
    };
  } catch {
    return fallbackCustom;
  }
}

function persistSnapshot(s: PomodoroState) {
  try {
    const snapshot: PersistedPomodoro = {
      presetId: s.presetId,
      phase: s.phase,
      secondsLeft: s.secondsLeft,
      running: s.running,
      autoLog: s.autoLog,
      anchorDay: s.anchorDay,
      sessionsToday: s.sessionsToday,
      loggedMinutesToday: s.loggedMinutesToday,
      targetKind: s.targetKind,
      targetId: s.targetId,
      targetLabel: s.targetLabel,
      intention: s.intention,
      activeSavedPresetId: s.activeSavedPresetId,
      focusRunStarted: s.focusRunStarted,
      focusRunId: s.focusRunId, focusSegments: s.focusSegments, focusSegmentStart: s.focusSegmentStart,
      customFocus: s.customFocus,
      customBreak: s.customBreak,
      customLongBreak: s.customLongBreak,
      customCycles: s.customCycles,
      updatedAt: Date.now(),
    };
    localStorage.setItem(POMO_KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable */
  }
}

function focusActivity(state: PomodoroState, seconds: number, completed: boolean): StudyActivity {
  const stamp = new Date().toISOString();
  const segments = [...(state.focusSegments ?? []), ...(state.focusSegmentStart ? [{ startedAt: state.focusSegmentStart, endedAt: stamp }] : [])];
  let remaining = seconds * 1000;
  const intervals = segments.flatMap((segment) => {
    const start = Date.parse(segment.startedAt);
    const length = Math.min(remaining, Math.max(0, Date.parse(segment.endedAt) - start));
    remaining -= length;
    return length > 0 ? [{ startedAt: segment.startedAt, endedAt: new Date(start + length).toISOString() }] : [];
  });
  const endedAt = intervals.at(-1)?.endedAt ?? stamp;
  return { eventId: `pomodoro:${state.focusRunId ?? `${state.anchorDay}:${state.lastTickAt}`}`, kind: "pomodoro", source: "axom", endedAt, durationSeconds: seconds, intervals: intervals.length ? intervals : undefined, completed };
}

function logNote(reason: "complete" | "reset" | "skip" | "switch", targetLabel?: string, intention?: string): string {
  const prefix = reason === "complete"
    ? "Pomodoro focus sprint"
    : reason === "switch"
      ? "Pomodoro preset change: partial focus sprint"
      : `Pomodoro ${reason}: partial focus sprint`;
  return [prefix, targetLabel ? `target: ${targetLabel}` : "", intention ? `intention: ${intention}` : ""]
    .filter(Boolean)
    .join(" - ");
}

function recordSavedPresetUse(id: string) {
  const store = useStore.getState();
  const preferences = effectivePomodoroPreferences(store.profile.pomodoroPreferences);
  if (!preferences.savedPresets.some((preset) => preset.id === id)) return;
  const timestamp = new Date().toISOString();
  store.updateProfile({
    pomodoroPreferences: {
      ...preferences,
      savedPresets: preferences.savedPresets.map((preset) => preset.id === id
        ? { ...preset, useCount: preset.useCount + 1, lastUsedAt: timestamp, updatedAt: timestamp }
        : preset),
    },
  });
}

// A short, gentle two-tone chime so a finished sprint is noticeable without a
// jarring alarm. Best-effort: silently no-op if WebAudio is unavailable/blocked.
function chime(up: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(up ? 523.25 : 392, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(up ? 783.99 : 261.63, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.62);
    osc.onended = () => ctx.close();
  } catch {
    /* no audio available */
  }
}

export const usePomodoro = create<PomodoroState>((set, get) => {
  const initial = readPersisted();
  const initialCustom = profileCustom();
  // Reset the per-day counters when the active study day rolls over.
  const syncDay = () => {
    const today = useStore.getState().activeDayKey;
    if (get().anchorDay !== today) set({ anchorDay: today, sessionsToday: 0, loggedMinutesToday: 0 });
  };

  const logPartialFocus = (reason: "reset" | "skip" | "switch") => {
    syncDay();
    const { phase, secondsLeft, autoLog, targetLabel, intention, running, lastTickAt } = get();
    if (phase !== "focus" || !autoLog) return 0;
    const preset = effectivePreset(get());
    // A user action can arrive before the throttled clock's next tick.
    const pendingSeconds = running ? Math.max(0, (Date.now() - lastTickAt) / 1000) : 0;
    const elapsedSeconds = Math.min(preset.focus * 60, Math.max(0, preset.focus * 60 - secondsLeft + pendingSeconds));
    const minutes = Math.floor(elapsedSeconds / 60);
    if (elapsedSeconds <= 0) return 0;
    useStore.getState().logStudy({ type: "Pomodoro", minutes, note: logNote(reason, targetLabel, intention), activity: focusActivity(get(), elapsedSeconds, false) });
    set((s) => ({
      loggedMinutesToday: s.loggedMinutesToday + minutes,
    }));
    persistSnapshot(get());
    return minutes;
  };

  // A phase finished — log the focus block (if natural + auto-log on), then
  // advance: focus → break keeps running; break → focus pauses for a fresh start.
  const complete = (natural: boolean) => {
    stopInterval();
    syncDay();
    const { phase, autoLog, targetLabel, intention } = get();
    const preset = effectivePreset(get());
    const preferences = effectivePomodoroPreferences(useStore.getState().profile.pomodoroPreferences);
    if (phase === "focus") {
      if (natural && autoLog) {
        useStore.getState().logStudy({ type: "Pomodoro", minutes: preset.focus, note: logNote("complete", targetLabel, intention), activity: focusActivity(get(), preset.focus * 60, true) });
      }
      if (natural) chime(true);
      // Completed focus sprints today (this one included only when natural — a
      // skipped/cancelled focus never advances the long-break cadence).
      const completedFocus = get().sessionsToday + (natural ? 1 : 0);
      const breakMinutes = getBreakDurationMinutes({
        sessionsToday: completedFocus,
        cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
        shortBreak: preset.break,
        longBreak: preset.longBreak,
      });
      const continueIntoBreak = natural && preferences.autoStartBreak;
      set((s) => ({
        phase: "break",
        secondsLeft: breakMinutes * 60,
        running: continueIntoBreak,
        lastTickAt: Date.now(),
        focusRunStarted: false, focusRunId: undefined, focusSegments: [], focusSegmentStart: undefined,
        sessionsToday: natural ? s.sessionsToday + 1 : s.sessionsToday,
        loggedMinutesToday: natural && autoLog ? s.loggedMinutesToday + preset.focus : s.loggedMinutesToday,
        completedAt: natural ? new Date().toISOString() : s.completedAt,
        completedMinutes: natural ? (autoLog ? preset.focus : 0) : s.completedMinutes,
      }));
      persistSnapshot(get());
      if (continueIntoBreak) startInterval(() => get()._tick());
    } else {
      if (natural) chime(false);
      const continueIntoFocus = natural && preferences.autoStartFocus;
      if (continueIntoFocus && get().activeSavedPresetId) recordSavedPresetUse(get().activeSavedPresetId!);
      set({
        phase: "focus",
        secondsLeft: preset.focus * 60,
        running: continueIntoFocus,
        focusRunStarted: continueIntoFocus,
        focusRunId: continueIntoFocus ? crypto.randomUUID() : undefined, focusSegments: [], focusSegmentStart: continueIntoFocus ? new Date().toISOString() : undefined,
        lastTickAt: Date.now(),
      });
      persistSnapshot(get());
      if (continueIntoFocus) startInterval(() => get()._tick());
    }
  };

  return {
    presetId: initial.presetId ?? "25-5",
    phase: initial.phase ?? "focus",
    secondsLeft: initial.secondsLeft ?? 25 * 60,
    running: initial.running ?? false,
    autoLog: initial.autoLog ?? true,
    anchorDay: initial.anchorDay ?? useStore.getState().activeDayKey,
    sessionsToday: initial.sessionsToday ?? 0,
    loggedMinutesToday: initial.loggedMinutesToday ?? 0,
    targetKind: initial.targetKind ?? "free",
    targetId: initial.targetId,
    targetLabel: initial.targetLabel,
    intention: initial.intention ?? "",
    activeSavedPresetId: initial.activeSavedPresetId,
    focusRunStarted: initial.focusRunStarted ?? false,
    focusRunId: initial.focusRunId, focusSegments: initial.focusSegments ?? [], focusSegmentStart: initial.focusSegmentStart,
    customFocus: initial.customFocus ?? initialCustom.customFocus,
    customBreak: initial.customBreak ?? initialCustom.customBreak,
    customLongBreak: initial.customLongBreak ?? initialCustom.customLongBreak,
    customCycles: initial.customCycles ?? initialCustom.customCycles,
    lastTickAt: Date.now(),
    completedAt: null,
    completedMinutes: 0,

    start: () => {
      if (get().running) return;
      syncDay();
      const state = get();
      if (state.phase === "focus" && !state.focusRunStarted && state.activeSavedPresetId) {
        recordSavedPresetUse(state.activeSavedPresetId);
      }
      set({
        focusRunId: state.phase === "focus" ? state.focusRunId ?? crypto.randomUUID() : undefined,
        focusSegmentStart: state.phase === "focus" ? new Date().toISOString() : undefined,
        running: true,
        focusRunStarted: state.phase === "focus" ? true : state.focusRunStarted,
        lastTickAt: Date.now(),
      });
      persistSnapshot(get());
      startInterval(() => get()._tick());
    },
    pause: () => {
      stopInterval();
      if (get().running) get()._tick();
      stopInterval();
      const state = get();
      set({ running: false, lastTickAt: Date.now(), focusSegments: state.focusSegmentStart ? [...(state.focusSegments ?? []), { startedAt: state.focusSegmentStart, endedAt: new Date().toISOString() }] : state.focusSegments, focusSegmentStart: undefined });
      persistSnapshot(get());
    },
    toggle: () => (get().running ? get().pause() : get().start()),
    reset: () => {
      stopInterval();
      logPartialFocus("reset");
      const preset = effectivePreset(get());
      set({ running: false, phase: "focus", secondsLeft: preset.focus * 60, focusRunStarted: false, focusRunId: undefined, focusSegments: [], focusSegmentStart: undefined, lastTickAt: Date.now() });
      persistSnapshot(get());
    },
    skip: () => {
      logPartialFocus("skip");
      complete(false);
    },
    setPreset: (id) => {
      stopInterval();
      logPartialFocus("switch");
      const presetId = PRESET_ALIASES[id] ?? id;
      const preset = effectivePreset({ presetId, customFocus: get().customFocus, customBreak: get().customBreak, customLongBreak: get().customLongBreak, customCycles: get().customCycles });
      set({ presetId, phase: "focus", secondsLeft: preset.focus * 60, running: false, activeSavedPresetId: undefined, focusRunStarted: false, focusRunId: undefined, focusSegments: [], focusSegmentStart: undefined, lastTickAt: Date.now() });
      persistSnapshot(get());
    },
    setAutoLog: (autoLog) => { set({ autoLog }); persistSnapshot(get()); },
    setCustom: (patch) => {
      const next = {
        customFocus: clampMin(patch.focus ?? get().customFocus, 1, 180),
        customBreak: clampMin(patch.break ?? get().customBreak, 1, 90),
        customLongBreak: clampMin(patch.longBreak ?? get().customLongBreak, 1, 120),
        customCycles: patch.cyclesBeforeLongBreak === undefined
          ? validCyclesBeforeLongBreak(get().customCycles)
          : validCyclesBeforeLongBreak(patch.cyclesBeforeLongBreak),
      };
      set(next);
      // Persist to the profile so custom durations back up + sync with the vault.
      useStore.getState().updateProfile({
        pomodoroCustom: {
          focus: next.customFocus, break: next.customBreak, longBreak: next.customLongBreak, cyclesBeforeLongBreak: next.customCycles,
        },
      });
      // Re-fit the clock if the custom preset is active and idle.
      if ((PRESET_ALIASES[get().presetId] ?? get().presetId) === "custom" && !get().running) {
        const preset = effectivePreset(get());
        const breakMinutes = getBreakDurationMinutes({
          sessionsToday: get().sessionsToday,
          cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
          shortBreak: preset.break,
          longBreak: preset.longBreak,
        });
        set({ secondsLeft: (get().phase === "focus" ? preset.focus : breakMinutes) * 60, lastTickAt: Date.now() });
      }
      persistSnapshot(get());
    },
    runCustom: (input, savedPresetId) => {
      stopInterval();
      logPartialFocus("switch");
      const normalized = clampPomodoroCustomDurations(input);
      set({
        presetId: "custom",
        phase: "focus",
        secondsLeft: normalized.focus * 60,
        running: false,
        customFocus: normalized.focus,
        customBreak: normalized.break,
        customLongBreak: normalized.longBreak,
        customCycles: normalized.cyclesBeforeLongBreak,
        activeSavedPresetId: savedPresetId,
        focusRunStarted: false, focusRunId: undefined, focusSegments: [], focusSegmentStart: undefined,
        intention: input.intention?.trim().slice(0, 240) ?? get().intention,
        lastTickAt: Date.now(),
      });
      // Deliberately snapshot only the active timer. Run-once values do not
      // mutate the profile or its saved-preset collection.
      persistSnapshot(get());
    },
    setTarget: (target) => {
      set({
        targetKind: target.kind,
        targetId: target.id,
        targetLabel: target.label,
      });
      persistSnapshot(get());
    },
    setIntention: (intention) => { set({ intention }); persistSnapshot(get()); },
    _tick: () => {
      const state = get();
      if (!state.running) return;
      const elapsed = Math.floor((Date.now() - state.lastTickAt) / 1000);
      // An early interval fire counts nothing yet; the sub-second remainder carries
      // into the next tick so the clock never drifts slower than wall time.
      if (elapsed < 1) return;
      if (state.secondsLeft <= elapsed) {
        complete(true);
        return;
      }
      set({ secondsLeft: state.secondsLeft - elapsed, lastTickAt: state.lastTickAt + elapsed * 1000 });
      persistSnapshot(get());
    },
  };
});

export function ensurePomodoroClock() {
  const state = usePomodoro.getState();
  if (state.running) startInterval(() => usePomodoro.getState()._tick());
}

/**
 * Reconcile a running timer against wall-clock time and (re)attach the 1s
 * interval. Called at app startup and on visibility/focus/pageshow so a sprint
 * keeps accurate time across route changes, reloads, and backgrounded tabs
 * (where setInterval is throttled). Only forces a catch-up tick when real drift
 * has accumulated, so it never double-counts the normal foreground cadence.
 */
export function reconcilePomodoro() {
  const state = usePomodoro.getState();
  if (state.running && Date.now() - state.lastTickAt >= 1500) state._tick();
  ensurePomodoroClock();
}

/** Full length of the current phase in seconds, matching the Pomodoro dial. */
export function pomodoroPhaseSeconds(state: { presetId: string; phase: PomodoroPhase; sessionsToday: number } & CustomDurations): number {
  const preset = effectivePreset(state);
  if (state.phase === "focus") return preset.focus * 60;
  return getBreakDurationMinutes({
    sessionsToday: state.sessionsToday,
    cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
    shortBreak: preset.break,
    longBreak: preset.longBreak,
  }) * 60;
}

export function pomodoroPreset(id: string): PomodoroPreset {
  return presetById(id);
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
