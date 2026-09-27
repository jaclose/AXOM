import { describe, expect, it } from "vitest";
import { DEFAULT_POMODORO_PREFERENCES, effectivePomodoroPreferences, normalizePomodoroPreferences } from "./pomodoroPreferences";

describe("normalizePomodoroPreferences showInMenuBar", () => {
  it("preserves an explicit choice in both directions", () => {
    expect(normalizePomodoroPreferences({ showInMenuBar: false })?.showInMenuBar).toBe(false);
    expect(normalizePomodoroPreferences({ showInMenuBar: true })?.showInMenuBar).toBe(true);
  });

  it("leaves an unset or invalid value unset so the default (on) applies", () => {
    for (const value of [{}, { showInMenuBar: "no" }, { showInMenuBar: 0 }, { showInMenuBar: null }]) {
      const normalized = normalizePomodoroPreferences(value);
      expect(normalized).toBeDefined();
      expect("showInMenuBar" in normalized!).toBe(false);
    }
    expect("showInMenuBar" in DEFAULT_POMODORO_PREFERENCES).toBe(false);
    expect(effectivePomodoroPreferences(undefined).showInMenuBar).toBeUndefined();
  });

  it("round-trips through JSON alongside the other preferences", () => {
    const stored = normalizePomodoroPreferences({ autoStartBreak: false, autoStartFocus: true, savedPresets: [], showInMenuBar: false });
    const restored = normalizePomodoroPreferences(JSON.parse(JSON.stringify(stored)));
    expect(restored).toEqual({ autoStartBreak: false, autoStartFocus: true, savedPresets: [], showInMenuBar: false });
    expect(normalizePomodoroPreferences(restored)).toEqual(restored);
  });

  it("keeps undefined input undefined", () => {
    expect(normalizePomodoroPreferences(undefined)).toBeUndefined();
  });
});
