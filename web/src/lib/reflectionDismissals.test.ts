// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissReflectionDays, readDismissedReflectionDays, reflectionDismissalKey } from "./reflectionDismissals";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exact-day reflection dismissals", () => {
  it("persists only distinct valid dates and isolates workspace preferences", () => {
    const result = dismissReflectionDays("workspace:a", ["2026-10-18", "2026-10-18", "private journal text"]);
    expect(result.dismissedDays).toEqual(["2026-10-18"]);
    expect(result.failedDays).toEqual([]);
    expect([...values.keys()]).toEqual([reflectionDismissalKey("workspace:a", "2026-10-18")]);
    expect(readDismissedReflectionDays("workspace:a", ["2026-10-18", "2026-10-19"])).toEqual(["2026-10-18"]);
    expect(readDismissedReflectionDays("workspace:b", ["2026-10-18"])).toEqual([]);
  });

  it("adds independent dates without replacing an earlier dismissal", () => {
    dismissReflectionDays("local", ["2026-10-17"]);
    dismissReflectionDays("local", ["2026-10-18"]);
    expect(readDismissedReflectionDays("local", ["2026-10-17", "2026-10-18", "2026-10-19"]))
      .toEqual(["2026-10-17", "2026-10-18"]);
  });

  it("undo restores just this action and preserves newer actions from another tab", () => {
    const first = dismissReflectionDays("local", ["2026-10-17", "2026-10-18"]);
    dismissReflectionDays("local", ["2026-10-18", "2026-10-19"]);
    expect(first.undo()).toEqual([]);
    expect(readDismissedReflectionDays("local", ["2026-10-17", "2026-10-18", "2026-10-19"]))
      .toEqual(["2026-10-18", "2026-10-19"]);
  });

  it("cannot erase a newer dismissal interleaved with the Undo write", () => {
    const first = dismissReflectionDays("local", ["2026-10-18"]);
    const dayKey = reflectionDismissalKey("local", "2026-10-18");
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(`${dayKey}:undo:`)) values.set(dayKey, "newer-tab-action");
      values.set(key, value);
    });
    expect(first.undo()).toEqual([]);
    expect(values.get(dayKey)).toBe("newer-tab-action");
    expect(readDismissedReflectionDays("local", ["2026-10-18"])).toEqual(["2026-10-18"]);
  });

  it("reports blocked writes without falsely dismissing days", () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const result = dismissReflectionDays("local", ["2026-10-18"]);
    expect(result.dismissedDays).toEqual([]);
    expect(result.failedDays).toEqual(["2026-10-18"]);
    expect(readDismissedReflectionDays("local", ["2026-10-18"])).toEqual([]);
  });

  it("reports partial writes and preserves the successful dates", () => {
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key.endsWith("2026-10-18")) throw new Error("QuotaExceededError");
      values.set(key, value);
    });
    const result = dismissReflectionDays("local", ["2026-10-17", "2026-10-18"]);
    expect(result.dismissedDays).toEqual(["2026-10-17"]);
    expect(result.failedDays).toEqual(["2026-10-18"]);
  });

  it("requires readback instead of claiming a discarded write was saved", () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => undefined);
    const result = dismissReflectionDays("local", ["2026-10-18"]);
    expect(result.dismissedDays).toEqual([]);
    expect(result.failedDays).toEqual(["2026-10-18"]);
  });

  it("reports blocked Undo without falsely restoring the reminders", () => {
    const result = dismissReflectionDays("local", ["2026-10-18"]);
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(result.undo()).toEqual(["2026-10-18"]);
    expect(readDismissedReflectionDays("local", ["2026-10-18"])).toEqual(["2026-10-18"]);
  });

  it("tolerates unavailable reads without hiding unknown dates", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readDismissedReflectionDays("local", ["2026-10-18"])).toEqual([]);
  });
});
