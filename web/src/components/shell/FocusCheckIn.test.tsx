// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { STORAGE_KEYS } from "../../lib/brand";
import { FOCUS_CHECKIN_TEST_EVENT, FocusCheckIn } from "./FocusCheckIn";

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
  vi.unstubAllGlobals();
});

describe("FocusCheckIn", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /I drifted/ }));
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
