// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePomodoro, ensurePomodoroClock, reconcilePomodoro, effectivePreset, getBreakDurationMinutes, POMODORO_PRESETS, PRIMARY_POMODORO_PRESET_IDS } from "./pomodoro";
import { useStore } from "./store";

let logSpy: ReturnType<typeof vi.spyOn>;
const originalLogStudy = useStore.getState().logStudy;

function resetPomo(patch: Partial<ReturnType<typeof usePomodoro.getState>> = {}) {
  usePomodoro.getState().pause(); // stops any running interval
  usePomodoro.setState({
    presetId: "custom", phase: "focus", secondsLeft: 25 * 60, running: false,
    autoLog: true, anchorDay: useStore.getState().activeDayKey, sessionsToday: 0, loggedMinutesToday: 0,
    targetKind: "free", targetId: undefined, targetLabel: undefined, intention: "",
    activeSavedPresetId: undefined, focusRunStarted: false,
    customFocus: 25, customBreak: 5, customLongBreak: 15, customCycles: 4,
    lastTickAt: Date.now(), completedAt: null, completedMinutes: 0,
    ...patch,
  });
}

/** Drive a natural focus-phase completion via the real tick path. */
function completeFocusNaturally() {
  usePomodoro.setState({ phase: "focus", secondsLeft: 1, running: true, lastTickAt: Date.now() });
  vi.setSystemTime(Date.now() + 2000);
  usePomodoro.getState()._tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  // updateProfile() replaces the Zustand state object while preserving action
  // references, so explicitly restore this action before installing each spy.
  useStore.setState({
    logStudy: originalLogStudy,
    activeDayKey: "2026-07-11",
    profile: {
      ...useStore.getState().profile,
      pomodoroCustom: { focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 },
      pomodoroPreferences: undefined,
    },
  });
  logSpy = vi.spyOn(useStore.getState(), "logStudy").mockImplementation(() => {});
  resetPomo();
});

afterEach(() => {
  usePomodoro.getState().pause();
  vi.restoreAllMocks();
  useStore.setState({ logStudy: originalLogStudy });
  vi.useRealTimers();
});

describe("pomodoro long-break cadence", () => {
  it("uses the short break for cycles before the boundary", () => {
    resetPomo({ sessionsToday: 0 });
    completeFocusNaturally();
    expect(usePomodoro.getState().phase).toBe("break");
    expect(usePomodoro.getState().sessionsToday).toBe(1);
    expect(usePomodoro.getState().secondsLeft).toBe(5 * 60); // short
  });

  it("uses the long break exactly on the four-cycle boundary", () => {
    resetPomo({ sessionsToday: 3, customCycles: 4, customBreak: 5, customLongBreak: 15 });
    completeFocusNaturally();
    expect(usePomodoro.getState().sessionsToday).toBe(4);
    expect(usePomodoro.getState().secondsLeft).toBe(15 * 60); // long
  });

  it("continues with short breaks after a long break", () => {
    resetPomo({ sessionsToday: 4, customCycles: 4 });
    completeFocusNaturally();
    expect(usePomodoro.getState().sessionsToday).toBe(5);
    expect(usePomodoro.getState().secondsLeft).toBe(5 * 60); // short
  });

  it("honors a custom cycles-before-long value of 2", () => {
    resetPomo({ sessionsToday: 1, customCycles: 2, customLongBreak: 12 });
    completeFocusNaturally();
    expect(usePomodoro.getState().sessionsToday).toBe(2);
    expect(usePomodoro.getState().secondsLeft).toBe(12 * 60);
  });

  it("preserves the cycle position across a snapshot reload", () => {
    resetPomo({ sessionsToday: 3 });
    // A reload restores sessionsToday from the persisted snapshot; the next
    // completion must still land on the long break.
    completeFocusNaturally();
    expect(usePomodoro.getState().secondsLeft).toBe(15 * 60);
  });
});

describe("paused break custom edits", () => {
  it("keeps a paused long break on the long duration when the short break changes", () => {
    resetPomo({
      phase: "break", running: false, sessionsToday: 4, secondsLeft: 15 * 60,
      customBreak: 5, customLongBreak: 15, customCycles: 4,
    });
    usePomodoro.getState().setCustom({ break: 7 });
    expect(usePomodoro.getState().customBreak).toBe(7);
    expect(usePomodoro.getState().secondsLeft).toBe(15 * 60);
  });

  it("re-fits a paused short break when the short duration changes", () => {
    resetPomo({
      phase: "break", running: false, sessionsToday: 3, secondsLeft: 5 * 60,
      customBreak: 5, customLongBreak: 15, customCycles: 4,
    });
    usePomodoro.getState().setCustom({ break: 7 });
    expect(usePomodoro.getState().secondsLeft).toBe(7 * 60);
  });

  it("re-fits a paused long break when the long duration changes", () => {
    resetPomo({
      phase: "break", running: false, sessionsToday: 4, secondsLeft: 15 * 60,
      customBreak: 5, customLongBreak: 15, customCycles: 4,
    });
    usePomodoro.getState().setCustom({ longBreak: 20 });
    expect(usePomodoro.getState().secondsLeft).toBe(20 * 60);
  });

  it("uses the fallback cadence for invalid values without producing invalid time", () => {
    expect(getBreakDurationMinutes({
      sessionsToday: 4, cyclesBeforeLongBreak: 0, shortBreak: 5, longBreak: 15,
    })).toBe(15);
    expect(getBreakDurationMinutes({
      sessionsToday: 3, cyclesBeforeLongBreak: Number.NaN, shortBreak: 5, longBreak: 15,
    })).toBe(5);

    resetPomo({ phase: "break", running: false, sessionsToday: 4, secondsLeft: 15 * 60 });
    usePomodoro.getState().setCustom({
      break: -10,
      longBreak: Number.POSITIVE_INFINITY,
      cyclesBeforeLongBreak: 0,
    });
    const state = usePomodoro.getState();
    expect(state.customCycles).toBe(4);
    expect(Number.isFinite(state.secondsLeft)).toBe(true);
    expect(state.secondsLeft).toBeGreaterThanOrEqual(0);
  });

  it("matches store refits to the shared break-duration selector used by the ring", () => {
    resetPomo({
      phase: "break", running: false, sessionsToday: 6, secondsLeft: 15 * 60,
      customBreak: 5, customLongBreak: 18, customCycles: 3,
    });
    usePomodoro.getState().setCustom({ break: 8 });
    const state = usePomodoro.getState();
    const preset = effectivePreset(state);
    const ringMinutes = getBreakDurationMinutes({
      sessionsToday: state.sessionsToday,
      cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
      shortBreak: preset.break,
      longBreak: preset.longBreak,
    });
    expect(state.secondsLeft).toBe(ringMinutes * 60);
    expect(ringMinutes).toBe(18);
  });
});

describe("pomodoro completion accounting", () => {
  it("logs a completed focus sprint exactly once", () => {
    resetPomo({ sessionsToday: 0, autoLog: true });
    completeFocusNaturally();
    expect(logSpy).toHaveBeenCalledTimes(1);
    // A redundant tick after completion (now in the break phase) never re-logs.
    usePomodoro.getState()._tick();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("emits a zero-minute completion signal when auto-log is off", () => {
    resetPomo({
      autoLog: false,
      completedAt: "2026-07-10T12:00:00.000Z",
      completedMinutes: 25,
    });
    completeFocusNaturally();
    expect(logSpy).not.toHaveBeenCalled();
    expect(usePomodoro.getState().completedAt).not.toBe("2026-07-10T12:00:00.000Z");
    expect(usePomodoro.getState().completedMinutes).toBe(0);
  });

  it.each(["reset", "skip"] as const)("logs a partial %s without emitting another natural-completion signal", (action) => {
    const priorCompletion = "2026-07-10T12:00:00.000Z";
    resetPomo({
      phase: "focus",
      secondsLeft: 20 * 60,
      running: false,
      completedAt: priorCompletion,
      completedMinutes: 25,
    });
    usePomodoro.getState()[action]();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ minutes: 5 }));
    expect(usePomodoro.getState()).toMatchObject({
      completedAt: priorCompletion,
      completedMinutes: 25,
    });
  });

  it("does not advance the cycle when a focus sprint is cancelled (reset)", () => {
    resetPomo({ phase: "focus", secondsLeft: 100, running: true, sessionsToday: 2 });
    usePomodoro.getState().reset();
    expect(usePomodoro.getState().sessionsToday).toBe(2); // unchanged
    expect(usePomodoro.getState().phase).toBe("focus");
  });

  it("does not advance the cycle when a focus sprint is skipped", () => {
    resetPomo({ phase: "focus", secondsLeft: 100, running: true, sessionsToday: 2 });
    usePomodoro.getState().skip();
    expect(usePomodoro.getState().sessionsToday).toBe(2); // skip is not a completion
    expect(usePomodoro.getState().phase).toBe("break");
  });
});

describe("pomodoro clock lifecycle (root-owned, page-independent)", () => {
  it("does not start a second interval when re-ensured while running", () => {
    resetPomo({ phase: "focus", secondsLeft: 600, running: true, lastTickAt: Date.now() });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    ensurePomodoroClock();
    ensurePomodoroClock();
    ensurePomodoroClock();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("reconciles elapsed wall-clock time after a backgrounded gap", () => {
    resetPomo({ phase: "focus", secondsLeft: 600, running: true, lastTickAt: Date.now() });
    vi.setSystemTime(Date.now() + 300 * 1000); // 5 minutes pass while hidden
    reconcilePomodoro();
    expect(usePomodoro.getState().secondsLeft).toBe(300);
  });

  it("carries sub-second remainders so ticks never drift slower than wall time", () => {
    resetPomo({ phase: "focus", secondsLeft: 600, running: true, lastTickAt: Date.now() });
    const start = Date.now();
    for (const at of [1004, 2008, 3012, 4016, 5020]) {
      vi.setSystemTime(start + at);
      usePomodoro.getState()._tick();
    }
    expect(usePomodoro.getState().secondsLeft).toBe(595);
    vi.setSystemTime(start + 5500);
    usePomodoro.getState()._tick(); // an early fire counts nothing yet
    expect(usePomodoro.getState().secondsLeft).toBe(595);
    vi.setSystemTime(start + 60_000);
    usePomodoro.getState()._tick();
    expect(usePomodoro.getState().secondsLeft).toBe(540);
  });

  it("completes a sprint that elapsed entirely while backgrounded, logging once", () => {
    resetPomo({ phase: "focus", secondsLeft: 120, running: true, lastTickAt: Date.now(), sessionsToday: 0 });
    vi.setSystemTime(Date.now() + 200 * 1000);
    reconcilePomodoro();
    expect(usePomodoro.getState().phase).toBe("break");
    expect(usePomodoro.getState().sessionsToday).toBe(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the timer progressing on reconcile without the Productivity page", () => {
    // No Pomodoro.tsx mounted — only the store + root reconcile drive the clock.
    resetPomo({ phase: "focus", secondsLeft: 90, running: true, lastTickAt: Date.now() });
    vi.setSystemTime(Date.now() + 30 * 1000);
    reconcilePomodoro();
    expect(usePomodoro.getState().secondsLeft).toBe(60);
    expect(usePomodoro.getState().running).toBe(true);
  });

  it("does not touch an idle timer on reconcile", () => {
    resetPomo({ phase: "focus", secondsLeft: 1500, running: false, lastTickAt: Date.now() });
    vi.setSystemTime(Date.now() + 300 * 1000);
    reconcilePomodoro();
    expect(usePomodoro.getState().secondsLeft).toBe(1500);
    expect(usePomodoro.getState().running).toBe(false);
  });

  it("resolves the effective custom preset used for break selection", () => {
    resetPomo({ presetId: "custom", customFocus: 30, customBreak: 6, customLongBreak: 20, customCycles: 3 });
    const preset = effectivePreset(usePomodoro.getState());
    expect(preset).toMatchObject({ focus: 30, break: 6, longBreak: 20, cyclesBeforeLongBreak: 3 });
  });
});

describe("pomodoro snapshot restore", () => {
  it("does not truncate a long break to short-break length on reload", async () => {
    // Seed a persisted snapshot representing a PAUSED long break with 14 minutes
    // left (long=15m, short=5m), then re-import the module so readPersisted runs.
    const backing = new Map<string, string>();
    backing.set("noctyrium-pomodoro-session", JSON.stringify({
      presetId: "custom", phase: "break", secondsLeft: 14 * 60, running: false,
      autoLog: true, anchorDay: useStore.getState().activeDayKey, sessionsToday: 4, loggedMinutesToday: 100,
      targetKind: "free", intention: "",
      customFocus: 25, customBreak: 5, customLongBreak: 15, customCycles: 4,
      updatedAt: Date.now(),
    }));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, String(v)); },
      removeItem: (k: string) => { backing.delete(k); },
      clear: () => backing.clear(),
    });
    try {
      vi.resetModules();
      const fresh = await import("./pomodoro");
      const state = fresh.usePomodoro.getState();
      expect(state.phase).toBe("break");
      expect(state.secondsLeft).toBe(14 * 60); // not clamped down to 5*60
      expect(state.sessionsToday).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("preset and custom workflow", () => {
  it("exposes the restrained primary defaults and keeps 25 / 5 secondary", () => {
    expect(PRIMARY_POMODORO_PRESET_IDS).toEqual(["90-20", "50-10", "120-25", "custom"]);
    expect(PRIMARY_POMODORO_PRESET_IDS.map((id) => POMODORO_PRESETS.find((preset) => preset.id === id)?.label)).toEqual([
      "90 / 20", "50 / 10", "120 / 25", "Custom",
    ]);
    expect(POMODORO_PRESETS.find((preset) => preset.id === "25-5")?.label).toBe("25 / 5");
  });

  it("runs a custom snapshot once without saving it to the profile", () => {
    const originalProfile = useStore.getState().profile;
    useStore.setState({ profile: { ...originalProfile, pomodoroCustom: { focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 } } });
    usePomodoro.getState().runCustom({ focus: 90, break: 20, longBreak: 35, cyclesBeforeLongBreak: 3, intention: "Renal questions" });
    expect(usePomodoro.getState()).toMatchObject({
      presetId: "custom",
      secondsLeft: 90 * 60,
      customFocus: 90,
      customBreak: 20,
      customLongBreak: 35,
      customCycles: 3,
      intention: "Renal questions",
    });
    expect(useStore.getState().profile.pomodoroCustom).toEqual({ focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 });
  });

  it("uses the store active day instead of the legacy shifted calendar key", () => {
    useStore.setState({ activeDayKey: "2026-07-12" });
    resetPomo({ anchorDay: "2026-07-11", sessionsToday: 3, loggedMinutesToday: 75 });
    usePomodoro.getState().start();
    expect(usePomodoro.getState()).toMatchObject({
      anchorDay: "2026-07-12",
      sessionsToday: 0,
      loggedMinutesToday: 0,
    });
  });

  it("logs elapsed paused focus before changing a preset", () => {
    const priorCompletion = "2026-07-10T12:00:00.000Z";
    resetPomo({
      customFocus: 25,
      secondsLeft: 18 * 60,
      completedAt: priorCompletion,
      completedMinutes: 25,
    });
    usePomodoro.getState().setPreset("50-10");
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      minutes: 7,
      note: expect.stringContaining("preset change"),
    }));
    expect(usePomodoro.getState()).toMatchObject({
      presetId: "50-10",
      secondsLeft: 50 * 60,
      completedAt: priorCompletion,
      completedMinutes: 25,
    });
  });

  it("logs elapsed paused focus before running a custom snapshot", () => {
    resetPomo({ customFocus: 25, secondsLeft: 19 * 60 });
    usePomodoro.getState().runCustom({
      focus: 75,
      break: 15,
      longBreak: 30,
      cyclesBeforeLongBreak: 3,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      minutes: 6,
      note: expect.stringContaining("preset change"),
    }));
    expect(usePomodoro.getState()).toMatchObject({
      presetId: "custom",
      secondsLeft: 75 * 60,
      customFocus: 75,
      focusRunStarted: false,
    });
  });

  it("honors both auto-start directions without changing cadence", () => {
    const profile = useStore.getState().profile;
    useStore.setState({ profile: { ...profile, pomodoroPreferences: { autoStartBreak: false, autoStartFocus: true, savedPresets: [] } } });
    resetPomo({ sessionsToday: 3, customCycles: 4, customLongBreak: 15 });
    completeFocusNaturally();
    expect(usePomodoro.getState()).toMatchObject({ phase: "break", running: false, secondsLeft: 15 * 60 });

    usePomodoro.setState({ phase: "break", secondsLeft: 1, running: true, lastTickAt: Date.now() });
    vi.setSystemTime(Date.now() + 2000);
    usePomodoro.getState()._tick();
    expect(usePomodoro.getState()).toMatchObject({ phase: "focus", running: true, focusRunStarted: true });
  });

  it("counts a saved preset only when its focus run actually starts", () => {
    const timestamp = new Date().toISOString();
    const profile = useStore.getState().profile;
    useStore.setState({
      profile: {
        ...profile,
        pomodoroPreferences: {
          autoStartBreak: true,
          autoStartFocus: false,
          savedPresets: [{
            id: "saved-1", label: "Boards", focus: 50, break: 10, longBreak: 25,
            cyclesBeforeLongBreak: 4, createdAt: timestamp, updatedAt: timestamp, useCount: 0,
          }],
        },
      },
    });
    usePomodoro.getState().runCustom({ focus: 50, break: 10, longBreak: 25, cyclesBeforeLongBreak: 4 }, "saved-1");
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets[0].useCount).toBe(0);
    usePomodoro.getState().start();
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets[0].useCount).toBe(1);
    usePomodoro.getState().pause();
    usePomodoro.getState().start();
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets[0].useCount).toBe(1);
  });
});
