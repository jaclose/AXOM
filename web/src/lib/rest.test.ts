// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async () => true);
vi.mock("./notify", () => ({ notify }));

const { LATE_RING_LIMIT_MS, alarmLevel, formatRestClock, readRestLog, useRest } = await import("./rest");
const { usePomodoro } = await import("./pomodoro");
const { useStore } = await import("./store");
const { makeSeed } = await import("./seed");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T14:00:00Z"));
  localStorage.clear();
  notify.mockClear();
  useStore.setState(makeSeed());
  usePomodoro.getState().reset();
  useRest.setState({ status: "idle", startedAt: undefined, endsAt: undefined, paused: undefined, overlayOpen: false, withSound: false });
});
afterEach(() => {
  useRest.getState().wakeNow();
  usePomodoro.getState().pause();
  vi.useRealTimers();
});

describe("put my head down", () => {
  it("pauses the running sprint, rings at the end, and resumes on request", () => {
    usePomodoro.getState().start();
    useRest.getState().start(15);
    expect(usePomodoro.getState().running).toBe(false);
    expect(useRest.getState()).toMatchObject({ status: "resting", overlayOpen: true, paused: { pomodoro: true } });

    vi.advanceTimersByTime(14 * 60_000);
    expect(useRest.getState().status).toBe("resting");
    vi.advanceTimersByTime(60_000 + 1000);
    expect(useRest.getState().status).toBe("ringing");
    expect(notify).toHaveBeenCalledWith("Time to lift your head", expect.any(String), { tag: "axom-rest" });

    useRest.getState().dismiss({ resume: true });
    expect(useRest.getState().status).toBe("idle");
    expect(usePomodoro.getState().running).toBe(true);
    expect(readRestLog()).toEqual([expect.objectContaining({ plannedMinutes: 15, completed: true })]);
  });

  it("pauses a live study session too", () => {
    const id = useStore.getState().startSession({ title: "Renal", link: { kind: "free", label: "Free" }, source: "manual" });
    useRest.getState().start();
    expect(useStore.getState().sessions.find((session) => session.id === id)?.status).toBe("paused");
    expect(useRest.getState().paused).toEqual({ sessionId: id });
  });

  it("snoozes for five more minutes and extends while resting", () => {
    useRest.getState().start(15);
    useRest.getState().extend(5);
    expect(useRest.getState().endsAt).toBe(Date.now() + 20 * 60_000);
    vi.advanceTimersByTime(20 * 60_000 + 1000);
    expect(useRest.getState().status).toBe("ringing");
    useRest.getState().snooze(5);
    expect(useRest.getState().status).toBe("resting");
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    expect(useRest.getState().status).toBe("ringing");
  });

  it("closes quietly instead of ringing late after AXOM was closed", () => {
    useRest.getState().start(15);
    const endsAt = useRest.getState().endsAt!;
    useRest.getState().check(endsAt + LATE_RING_LIMIT_MS + 1);
    expect(useRest.getState().status).toBe("idle");
    expect(notify).not.toHaveBeenCalled();
  });

  it("waking early records an incomplete rest", () => {
    useRest.getState().start(15);
    vi.advanceTimersByTime(4 * 60_000);
    useRest.getState().wakeNow();
    expect(readRestLog()).toEqual([expect.objectContaining({ completed: false })]);
  });

  it("formats the countdown and ramps the alarm from a whisper", () => {
    expect(formatRestClock(15 * 60_000)).toBe("15:00");
    expect(formatRestClock(61_500)).toBe("1:02");
    expect(alarmLevel(0)).toBeLessThan(0.05);
    expect(alarmLevel(20_000)).toBeLessThan(alarmLevel(40_000));
    expect(alarmLevel(120_000)).toBeCloseTo(0.26);
  });
});
