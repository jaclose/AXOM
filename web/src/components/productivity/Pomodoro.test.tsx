// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../../lib/seed";
import { usePomodoro } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { Pomodoro } from "./Pomodoro";

beforeEach(() => {
  usePomodoro.getState().pause();
  useStore.setState(makeSeed());
  usePomodoro.setState({
    presetId: "25-5",
    phase: "focus",
    secondsLeft: 25 * 60,
    running: false,
    autoLog: true,
    anchorDay: useStore.getState().activeDayKey,
    sessionsToday: 0,
    loggedMinutesToday: 0,
    customFocus: 25,
    customBreak: 5,
    customLongBreak: 15,
    customCycles: 4,
    activeSavedPresetId: undefined,
    focusRunStarted: false,
    intention: "",
    completedAt: null,
    completedMinutes: 0,
  });
});

afterEach(() => {
  usePomodoro.getState().pause();
  cleanup();
});

describe("Pomodoro custom presets", () => {
  it("shows the primary defaults, keeps 25 / 5 secondary, and runs once without profile persistence", () => {
    render(<Pomodoro />);
    for (const label of ["90 / 20", "50 / 10", "120 / 25", "Custom"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "25 / 5" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Custom focus minutes"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Run once" }));
    expect(usePomodoro.getState()).toMatchObject({ customFocus: 75, secondsLeft: 75 * 60 });
    expect(useStore.getState().profile.pomodoroCustom).toBeUndefined();
  });

  it("saves a preset and presents a safe override after the recommended three", () => {
    const timestamp = new Date().toISOString();
    useStore.getState().updateProfile({
      pomodoroPreferences: {
        autoStartBreak: true,
        autoStartFocus: false,
        savedPresets: [1, 2, 3].map((number) => ({
          id: `saved-${number}`,
          label: `Saved ${number}`,
          focus: 50,
          break: 10,
          longBreak: 25,
          cyclesBeforeLongBreak: 4,
          createdAt: timestamp,
          updatedAt: timestamp,
          useCount: number,
        })),
      },
    });
    render(<Pomodoro />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Custom preset name"), { target: { value: "Renal block" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(screen.getByText("AXOM usually keeps three quick presets to reduce clutter. You can continue and keep more.")).toBeTruthy();
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Continue and save" }));
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets).toHaveLength(4);
  });

  it("clamps custom durations before a saved preset reaches profile storage", () => {
    render(<Pomodoro />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Custom focus minutes"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Custom short break minutes"), { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText("Custom long break minutes"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Cycles before long break"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets[0]).toMatchObject({
      label: "180 / 1",
      focus: 180,
      break: 1,
      longBreak: 120,
      cyclesBeforeLongBreak: 4,
    });
  });

  it("exposes saved presets beyond the quick top three in an expandable library", () => {
    const timestamp = new Date().toISOString();
    useStore.getState().updateProfile({
      pomodoroPreferences: {
        autoStartBreak: true,
        autoStartFocus: false,
        savedPresets: [1, 2, 3, 4, 5].map((number) => ({
          id: `library-${number}`,
          label: `Library ${number}`,
          focus: 50,
          break: 10,
          longBreak: 25,
          cyclesBeforeLongBreak: 4,
          createdAt: timestamp,
          updatedAt: timestamp,
          useCount: number,
        })),
      },
    });
    render(<Pomodoro />);
    const summary = screen.getByText("More saved presets (2)");
    const library = summary.closest("details");
    expect(library?.open).toBe(false);
    fireEvent.click(summary);
    expect(library?.open).toBe(true);
    expect(screen.getByRole("button", { name: /^Library 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Library 1/ })).toBeTruthy();
  });

  it("deleting a saved preset never removes actual study logs", () => {
    const timestamp = new Date().toISOString();
    useStore.setState({ logs: [] });
    useStore.getState().logStudy({ type: "Pomodoro", minutes: 25, note: "Completed focus sprint" });
    const logs = useStore.getState().logs;
    expect(logs).toHaveLength(1);
    useStore.getState().updateProfile({
      pomodoroPreferences: {
        autoStartBreak: true,
        autoStartFocus: false,
        savedPresets: [{
          id: "saved-history", label: "Keep history", focus: 50, break: 10, longBreak: 25,
          cyclesBeforeLongBreak: 4, createdAt: timestamp, updatedAt: timestamp, useCount: 1,
        }],
      },
    });
    render(<Pomodoro />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Keep history preset" }));
    expect(useStore.getState().profile.pomodoroPreferences?.savedPresets).toEqual([]);
    expect(useStore.getState().logs).toEqual(logs);
  });
});

describe("Pomodoro menu bar toggle", () => {
  const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

  function enterMacDesktopShell() {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => MAC_UA });
  }

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window.navigator as { userAgent?: string }).userAgent;
  });

  it("is hidden in a browser, where there is no menu bar to draw in", () => {
    render(<Pomodoro />);
    expect(screen.queryByLabelText("Show timer in the Mac menu bar")).toBeNull();
  });

  it("is hidden in the desktop app on other platforms", () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    render(<Pomodoro />);
    expect(screen.queryByLabelText("Show timer in the Mac menu bar")).toBeNull();
  });

  it("defaults on in the Mac desktop app and persists the learner's choice", () => {
    enterMacDesktopShell();
    render(<Pomodoro />);
    const toggle = screen.getByLabelText("Show timer in the Mac menu bar") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(useStore.getState().profile.pomodoroPreferences?.showInMenuBar).toBe(false);
    expect((screen.getByLabelText("Show timer in the Mac menu bar") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Show timer in the Mac menu bar"));
    expect(useStore.getState().profile.pomodoroPreferences?.showInMenuBar).toBe(true);
  });

  it("stays out of the compact dashboard widget", () => {
    enterMacDesktopShell();
    render(<Pomodoro compact />);
    expect(screen.queryByLabelText("Show timer in the Mac menu bar")).toBeNull();
  });
});
