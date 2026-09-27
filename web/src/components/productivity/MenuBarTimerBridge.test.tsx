// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { usePomodoro } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { effectivePomodoroPreferences } from "../../lib/pomodoroPreferences";
import { MenuBarTimerBridge } from "./MenuBarTimerBridge";

type ActionHandler = (event: { payload: unknown }) => void;

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  // Every live listener, as Tauri would dispatch to each registered handler.
  handlers: new Set<(event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => value });
  Object.defineProperty(window.navigator, "platform", { configurable: true, get: () => (value === MAC_UA ? "MacIntel" : "Win32") });
}

function setDesktopShell(present: boolean) {
  const target = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (present) target.__TAURI_INTERNALS__ = {};
  else delete target.__TAURI_INTERNALS__;
}

function updateCalls() {
  return tauri.invoke.mock.calls.filter(([command]) => command === "menu_bar_timer_update");
}

function lastSnapshot() {
  const calls = updateCalls();
  return (calls[calls.length - 1]?.[1] as { snapshot: Record<string, unknown> } | undefined)?.snapshot;
}

async function flushBridge() {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function mountBridge() {
  const view = render(<MenuBarTimerBridge />);
  await flushBridge();
  return view;
}

function emitAction(payload: unknown) {
  act(() => { tauri.handlers.forEach((handler) => handler({ payload })); });
}

/** Registers the handler at once (as Tauri does) and returns its unlisten. */
function register(handler: ActionHandler) {
  tauri.handlers.add(handler);
  return () => {
    tauri.unlisten();
    tauri.handlers.delete(handler);
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  usePomodoro.getState().pause();
  useStore.setState(makeSeed());
  usePomodoro.setState({
    presetId: "25-5",
    phase: "focus",
    secondsLeft: 25 * 60,
    running: false,
    autoLog: false,
    anchorDay: useStore.getState().activeDayKey,
    sessionsToday: 0,
    loggedMinutesToday: 0,
    customFocus: 25,
    customBreak: 5,
    customLongBreak: 15,
    customCycles: 4,
    targetKind: "free",
    targetId: undefined,
    targetLabel: undefined,
    activeSavedPresetId: undefined,
    focusRunStarted: false,
    intention: "",
    lastTickAt: Date.now(),
    completedAt: null,
    completedMinutes: 0,
  });
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(undefined);
  tauri.unlisten.mockReset();
  tauri.handlers.clear();
  tauri.listen.mockReset();
  tauri.listen.mockImplementation(async (_event: string, handler: ActionHandler) => register(handler));
  setDesktopShell(true);
  setUserAgent(MAC_UA);
});

afterEach(() => {
  cleanup();
  usePomodoro.getState().pause();
  setDesktopShell(false);
  delete (window.navigator as { userAgent?: string }).userAgent;
  delete (window.navigator as { platform?: string }).platform;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MenuBarTimerBridge", () => {
  it("sends the idle timer on connect and listens for menu actions", async () => {
    await mountBridge();
    expect(tauri.listen).toHaveBeenCalledWith("menu-bar-timer://action", expect.any(Function));
    expect(updateCalls()).toHaveLength(1);
    expect(lastSnapshot()).toEqual({ enabled: true, phase: "focus", running: false, secondsLeft: 1500, idle: true });
  });

  it("sends start, pause, and phase changes but not every tick", async () => {
    await mountBridge();

    act(() => { usePomodoro.getState().start(); });
    expect(updateCalls()).toHaveLength(2);
    expect(lastSnapshot()).toMatchObject({ running: true, idle: false, secondsLeft: 1500 });

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(usePomodoro.getState().secondsLeft).toBe(1470);
    expect(updateCalls()).toHaveLength(2);

    act(() => { usePomodoro.getState().pause(); });
    expect(updateCalls()).toHaveLength(3);
    expect(lastSnapshot()).toMatchObject({ running: false, secondsLeft: 1470, idle: false });

    act(() => { usePomodoro.getState().skip(); });
    expect(updateCalls()).toHaveLength(4);
    expect(lastSnapshot()).toMatchObject({ phase: "break", running: false, secondsLeft: 300, idle: true });

    act(() => { usePomodoro.getState().reset(); });
    expect(updateCalls()).toHaveLength(5);
    expect(lastSnapshot()).toMatchObject({ phase: "focus", running: false, secondsLeft: 1500, idle: true });
  });

  it("sends the break when a running sprint finishes on its own", async () => {
    await mountBridge();
    act(() => { usePomodoro.getState().start(); });
    act(() => { vi.advanceTimersByTime(25 * 60_000); });
    expect(usePomodoro.getState()).toMatchObject({ phase: "break", running: true, sessionsToday: 1 });
    // Idle snapshot, start, then the phase change: no per-second traffic.
    expect(updateCalls()).toHaveLength(3);
    expect(lastSnapshot()).toMatchObject({ phase: "break", running: true, secondsLeft: 300, idle: false });
  });

  it("includes the sprint label and re-sends when it changes", async () => {
    await mountBridge();
    act(() => { usePomodoro.getState().setIntention("Renal physiology questions"); });
    expect(lastSnapshot()).toMatchObject({ label: "Renal physiology questions" });
    act(() => { usePomodoro.getState().setTarget({ kind: "tracker", id: "t1", label: "Cardiology · Heart failure" }); });
    expect(lastSnapshot()).toMatchObject({ label: "Cardiology · Heart failure" });
  });

  it("drives the Pomodoro store from menu bar actions", async () => {
    await mountBridge();
    emitAction("start");
    expect(usePomodoro.getState().running).toBe(true);
    emitAction("start");
    expect(usePomodoro.getState().running).toBe(true);
    emitAction("pause");
    expect(usePomodoro.getState().running).toBe(false);
    emitAction("toggle");
    expect(usePomodoro.getState().running).toBe(true);
    emitAction("skip");
    expect(usePomodoro.getState().phase).toBe("break");
    emitAction("reset");
    expect(usePomodoro.getState()).toMatchObject({ phase: "focus", running: false, secondsLeft: 1500 });
    emitAction("quit");
    emitAction({ action: "start" });
    expect(usePomodoro.getState().running).toBe(false);
  });

  it("catches a hidden window's clock up to wall time before a menu action", async () => {
    await mountBridge();
    act(() => { usePomodoro.getState().start(); });
    // The window is hidden and its interval has not fired for ten minutes.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(usePomodoro.getState().secondsLeft).toBe(1500);
    emitAction("pause");
    expect(usePomodoro.getState()).toMatchObject({ running: false, secondsLeft: 900 });
    expect(lastSnapshot()).toMatchObject({ running: false, secondsLeft: 900 });
  });

  it("completes an already finished sprint instead of skipping past its break", async () => {
    usePomodoro.setState({ autoLog: true });
    await mountBridge();
    act(() => { usePomodoro.getState().start(); });
    // The menu bar showed 0:00 while the hidden page had not ticked.
    vi.setSystemTime(Date.now() + 26 * 60_000);
    emitAction("skip");
    expect(usePomodoro.getState()).toMatchObject({ phase: "break", sessionsToday: 1, loggedMinutesToday: 25 });
    expect(usePomodoro.getState().completedAt).not.toBeNull();
  });

  it("sends enabled:false when the learner turns the menu bar timer off", async () => {
    await mountBridge();
    const preferences = effectivePomodoroPreferences(useStore.getState().profile.pomodoroPreferences);
    // Block bodies: the persisted store's setter returns a promise, which act() would await.
    act(() => { useStore.getState().updateProfile({ pomodoroPreferences: { ...preferences, showInMenuBar: false } }); });
    expect(lastSnapshot()).toMatchObject({ enabled: false });
    const sent = updateCalls().length;
    act(() => { usePomodoro.getState().start(); });
    expect(updateCalls()).toHaveLength(sent);
    act(() => { useStore.getState().updateProfile({ pomodoroPreferences: { ...preferences, showInMenuBar: true } }); });
    expect(lastSnapshot()).toMatchObject({ enabled: true, running: true });
  });

  it("starts disabled when the preference is already off", async () => {
    useStore.getState().updateProfile({ pomodoroPreferences: { autoStartBreak: true, autoStartFocus: false, savedPresets: [], showInMenuBar: false } });
    await mountBridge();
    expect(updateCalls()).toHaveLength(1);
    expect(lastSnapshot()).toMatchObject({ enabled: false });
  });

  it("clears the menu bar and stops listening on unmount", async () => {
    const view = await mountBridge();
    view.unmount();
    await flushBridge();
    expect(tauri.invoke).toHaveBeenCalledWith("menu_bar_timer_clear");
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
    const calls = tauri.invoke.mock.calls.length;
    act(() => { usePomodoro.getState().start(); });
    expect(tauri.invoke.mock.calls).toHaveLength(calls);
  });

  it("never connects when unmounted before the Tauri modules load", async () => {
    const view = render(<MenuBarTimerBridge />);
    view.unmount();
    await flushBridge();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.listen).not.toHaveBeenCalled();
    act(() => { usePomodoro.getState().start(); });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("releases a listener that resolves after unmount", async () => {
    let resolveListen: (stop: () => void) => void = () => {};
    tauri.listen.mockImplementationOnce((_event: string, handler: ActionHandler) => {
      const stop = register(handler);
      return new Promise<() => void>((resolve) => { resolveListen = () => resolve(stop); });
    });
    const view = await mountBridge();
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    view.unmount();
    resolveListen(() => {});
    await flushBridge();
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
    emitAction("start");
    expect(usePomodoro.getState().running).toBe(false);
  });

  it("keeps a single listener under StrictMode", async () => {
    render(<StrictMode><MenuBarTimerBridge /></StrictMode>);
    await flushBridge();
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    expect(tauri.handlers.size).toBe(1);
    emitAction("skip");
    // One skip: focus -> break, not focus -> break -> focus.
    expect(usePomodoro.getState().phase).toBe("break");
  });

  it("warns instead of crashing when the native side rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    tauri.invoke.mockRejectedValue(new Error("command not found"));
    await mountBridge();
    await flushBridge();
    expect(warn).toHaveBeenCalledWith("[AXOM] menu bar timer update failed", expect.any(Error));
    // A failed send is retried on the next change.
    act(() => { usePomodoro.getState().start(); });
    await flushBridge();
    expect(updateCalls()).toHaveLength(2);
  });

  it("does nothing in a browser tab", async () => {
    setDesktopShell(false);
    await mountBridge();
    act(() => { usePomodoro.getState().start(); });
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.listen).not.toHaveBeenCalled();
  });

  it("does nothing in the desktop app on other platforms", async () => {
    setUserAgent(WINDOWS_UA);
    await mountBridge();
    act(() => { usePomodoro.getState().start(); });
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.listen).not.toHaveBeenCalled();
  });
});
