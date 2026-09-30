import { describe, expect, it } from "vitest";
import { formatClock, tabTitle } from "./TabPresence";

describe("tab presence", () => {
  it("names the page when idle", () => {
    expect(tabTitle("Course Tracker", { running: false, phase: "focus", secondsLeft: 1500 })).toBe("Course Tracker · AXOM");
    expect(tabTitle("", { running: false, phase: "focus", secondsLeft: 0 })).toBe("AXOM");
  });
  it("shows the live countdown and phase while a session runs", () => {
    expect(tabTitle("Dashboard", { running: true, phase: "focus", secondsLeft: 1453 })).toBe("24:13 · Focus · AXOM");
    expect(tabTitle("Dashboard", { running: true, phase: "break", secondsLeft: 299 })).toBe("4:59 · Break · AXOM");
  });
  it("formats long sessions with hours", () => {
    expect(formatClock(5400)).toBe("1:30:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});
