// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { STORAGE_KEYS } from "../../lib/brand";
import { FOCUS_CHECKIN_TEST_EVENT, FocusCheckIn, focusProgressHint } from "./FocusCheckIn";
import { makeDailyRequirement, normalizeDailySuccessConfig } from "../../lib/dailySuccess";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

let now = new Date(2026, 8, 26, 10, 0);
const clock = () => now;

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
  now = new Date(2026, 8, 26, 10, 0);
  const seed = makeSeed();
  seed.profile.focusCheckIn = { enabled: true, intervalMinutes: 15, scope: "anytime", tone: "coach" };
  useStore.setState(seed);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FocusCheckIn", () => {
  it("keeps an unanswered prompt, restores it after remount, and fades after answering", () => {
    vi.useFakeTimers();
    let view = render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    now = new Date(2026, 8, 26, 10, 16);
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByText("Are you locked in?")).toBeTruthy();
    expect(screen.getByRole("dialog").parentElement).toBe(document.body);
    view.unmount();
    view = render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    expect(screen.getByText("Are you locked in?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Locked in" }));
    expect(localStorage.getItem(STORAGE_KEYS.focusCheckInPending)).toBeNull();
    act(() => vi.advanceTimersByTime(2200));
    expect(screen.getByRole("dialog").classList.contains("is-exiting")).toBe(true);
    act(() => vi.advanceTimersByTime(240));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
  });

  it("distinguishes focus time, today's study goal, and no study goal", () => {
    const state = makeSeed();
    state.profile.dailySuccess = normalizeDailySuccessConfig({ version: 1, configuredAt: state.activeDayKey, requirements: [makeDailyRequirement({ id: "study", label: "Study", source: { kind: "study-minutes" }, target: 42, unit: "minutes", trackingStartsAt: state.activeDayKey })] });
    const stopped = { running: false, phase: "focus", secondsLeft: 800 };
    expect(focusProgressHint(state, stopped).target).toBe("42 min remaining toward today's Study goal");
    expect(focusProgressHint(state, { ...stopped, running: true, secondsLeft: 600 })).toEqual({ sprint: "10 min left in this focus session" });
    state.profile.dailySuccess!.requirements = [];
    expect(focusProgressHint(state, stopped)).toEqual({});
  });

  it("groups follow-up actions in a single stacked reply area", () => {
    render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    act(() => { window.dispatchEvent(new CustomEvent(FOCUS_CHECKIN_TEST_EVENT)); });
    fireEvent.click(screen.getByRole("button", { name: "I am locked out" }));

    const actions = screen.getByRole("group", { name: "Follow-up actions" });
    expect(actions).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Restart a focus sprint/ })).toBeTruthy();
  });
  it("leaves the current task focused and restores it after a keyboard answer", () => {
    const view = render(<><button>Current task</button><FocusCheckIn clock={clock} pollIntervalMs={0} /></>);
    const task = screen.getByRole("button", { name: "Current task" });
    task.focus();
    act(() => window.dispatchEvent(new Event(FOCUS_CHECKIN_TEST_EVENT)));
    expect(document.activeElement).toBe(task);
    const answer = screen.getByRole("button", { name: "Locked in" });
    answer.focus();
    fireEvent.click(answer);
    expect(document.activeElement).toBe(task);
    view.unmount();
  });

  it("does not mistake a non-study goal for a completed study goal", () => {
    const state = makeSeed();
    state.profile.dailySuccess = normalizeDailySuccessConfig({ version: 1, configuredAt: state.activeDayKey, requirements: [makeDailyRequirement({ id: "prayer", label: "Prayer", source: { kind: "manual" }, target: 1, unit: "times", trackingStartsAt: state.activeDayKey })] });
    expect(focusProgressHint(state, { running: false, phase: "focus", secondsLeft: 0 }).targetsMet).toBeUndefined();
  });

  it("uses only active segments of a planned focus session, without negative time", () => {
    const state = makeSeed();
    state.sessions = [{ id: "live", title: "Read", link: { kind: "free", label: "Read" }, plannedMinutes: 30, status: "active", source: "manual", dayKey: state.activeDayKey, createdAt: "2026-09-30T10:00:00Z", quickLogs: [], segments: [{ startedAt: "2026-09-30T10:00:00Z", endedAt: "2026-09-30T10:10:00Z" }, { startedAt: "2026-09-30T10:20:00Z" }] }];
    const timer = { running: false, phase: "focus", secondsLeft: 0 };
    expect(focusProgressHint(state, timer, new Date("2026-09-30T10:25:00Z"))).toEqual({ sprint: "15 min left in this focus session" });
    expect(focusProgressHint(state, timer, new Date("2026-09-30T11:00:00Z"))).toEqual({ sprint: "Your planned focus time is complete" });
    state.sessions[0].plannedMinutes = undefined;
    state.profile.dailySuccess = normalizeDailySuccessConfig({ version: 1, configuredAt: state.activeDayKey, requirements: [] });
    expect(focusProgressHint(state, timer)).toEqual({});
  });

  it("asks after the interval, records the answer, and replies", () => {
    const { rerender } = render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    expect(screen.queryByText("Are you locked in?")).toBeNull();

    now = new Date(2026, 8, 26, 10, 16);
    act(() => { window.dispatchEvent(new Event("focus")); });
    rerender(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    expect(screen.getByText("Are you locked in?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Locked in/ }));
    expect(screen.queryByText("Are you locked in?")).toBeNull();
    const ledger = JSON.parse(localStorage.getItem(STORAGE_KEYS.focusCheckIns)!);
    expect(ledger).toMatchObject({ prompts: 1, lockedIn: 1, streak: 1 });
  });

  it("previews without recording and can be turned off from the card", () => {
    render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    act(() => { window.dispatchEvent(new CustomEvent(FOCUS_CHECKIN_TEST_EVENT)); });
    expect(screen.getByText(/Preview — nothing is recorded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I am locked out" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.focusCheckIns) ?? "{}").drifted ?? 0).toBe(0);

    act(() => { window.dispatchEvent(new CustomEvent(FOCUS_CHECKIN_TEST_EVENT)); });
    fireEvent.click(screen.getByRole("button", { name: "Turn off check-ins" }));
    expect(useStore.getState().profile.focusCheckIn?.enabled).toBe(false);
  });

  it("stays silent in focus-only scope when nothing is running", () => {
    useStore.getState().updateProfile({ focusCheckIn: { enabled: true, intervalMinutes: 15, scope: "focus" } });
    render(<FocusCheckIn clock={clock} pollIntervalMs={0} />);
    now = new Date(2026, 8, 26, 12, 0);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByText("Are you locked in?")).toBeNull();
  });
});
