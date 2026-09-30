// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTourProgress, readTourStep, TOUR_PROGRESS_KEY, writeTourStep } from "./onboardingProgress";

const values = new Map<string, string>();
const memorySession = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

describe("guided tour session progress", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memorySession);
    sessionStorage.clear();
  });

  it("round-trips and clears tour progress", () => {
    writeTourStep(4, sessionStorage);
    expect(readTourStep(7, sessionStorage)).toBe(4);
    expect(sessionStorage.getItem(TOUR_PROGRESS_KEY)).toBe("4");

    clearTourProgress(sessionStorage);
    expect(readTourStep(7, sessionStorage)).toBe(0);
  });

  it("rejects stale or out-of-range tour steps", () => {
    sessionStorage.setItem(TOUR_PROGRESS_KEY, "7");
    expect(readTourStep(7, sessionStorage)).toBe(0);
    sessionStorage.setItem(TOUR_PROGRESS_KEY, "NaN");
    expect(readTourStep(7, sessionStorage)).toBe(0);
  });
});
