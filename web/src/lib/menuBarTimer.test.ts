import { describe, expect, it } from "vitest";
import {
  MENU_BAR_LABEL_MAX,
  MENU_BAR_MAX_SECONDS,
  isMenuBarTimerEnabled,
  menuBarLabel,
  menuBarSnapshot,
  parseMenuBarAction,
  shouldSendSnapshot,
  type MenuBarTimerSnapshot,
} from "./menuBarTimer";

const T0 = 1_750_000_000_000;

function snapshot(patch: Partial<MenuBarTimerSnapshot> = {}): MenuBarTimerSnapshot {
  return { enabled: true, phase: "focus", running: true, secondsLeft: 1500, idle: false, ...patch };
}

describe("menuBarSnapshot", () => {
  it("derives the native snapshot from Pomodoro state", () => {
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: 1453, targetLabel: "Renal physiology", intention: "" }, true, 1500)).toEqual({
      enabled: true,
      phase: "focus",
      running: true,
      secondsLeft: 1453,
      idle: false,
      label: "Renal physiology",
    });
  });

  it("carries the preference as enabled and omits an empty label", () => {
    const result = menuBarSnapshot({ phase: "break", running: false, secondsLeft: 120, intention: "   " }, false, 300);
    expect(result).toEqual({ enabled: false, phase: "break", running: false, secondsLeft: 120, idle: false });
    expect("label" in result).toBe(false);
  });

  it("marks a paused clock at the full phase length as idle", () => {
    expect(menuBarSnapshot({ phase: "focus", running: false, secondsLeft: 1500 }, true, 1500).idle).toBe(true);
    expect(menuBarSnapshot({ phase: "focus", running: false, secondsLeft: 1499 }, true, 1500).idle).toBe(false);
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: 1500 }, true, 1500).idle).toBe(false);
    expect(menuBarSnapshot({ phase: "focus", running: false, secondsLeft: 1500 }, true).idle).toBe(false);
  });

  it("clamps seconds to whole, non-negative values within 24 hours", () => {
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: 12.6 }, true).secondsLeft).toBe(13);
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: -4 }, true).secondsLeft).toBe(0);
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: Number.NaN }, true).secondsLeft).toBe(0);
    expect(menuBarSnapshot({ phase: "focus", running: true, secondsLeft: 10 * MENU_BAR_MAX_SECONDS }, true).secondsLeft).toBe(MENU_BAR_MAX_SECONDS);
  });
});

describe("menuBarLabel", () => {
  it("prefers the sprint target and falls back to the intention", () => {
    expect(menuBarLabel({ targetLabel: "Cardio · Step 1", intention: "No notes" })).toBe("Cardio · Step 1");
    expect(menuBarLabel({ targetLabel: "  ", intention: "  finish renal Qs  " })).toBe("finish renal Qs");
    expect(menuBarLabel({ targetLabel: undefined, intention: "" })).toBeUndefined();
  });

  it("collapses whitespace and strips control characters", () => {
    expect(menuBarLabel({ intention: "Renal\n\tblock\u0007 review" })).toBe("Renal block review");
  });

  it("truncates long labels to 40 characters with an ellipsis", () => {
    const label = menuBarLabel({ targetLabel: "Pharmacology autonomic drugs, receptors, and toxicities" })!;
    expect(Array.from(label)).toHaveLength(MENU_BAR_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
    expect(label.startsWith("Pharmacology autonomic drugs")).toBe(true);
    const exact = "x".repeat(MENU_BAR_LABEL_MAX);
    expect(menuBarLabel({ targetLabel: exact })).toBe(exact);
  });

  it("counts emoji and accents as single characters", () => {
    const label = menuBarLabel({ intention: "🧠".repeat(MENU_BAR_LABEL_MAX + 5) })!;
    expect(Array.from(label)).toHaveLength(MENU_BAR_LABEL_MAX);
    expect(label.startsWith("🧠🧠")).toBe(true);
  });
});

describe("shouldSendSnapshot", () => {
  it("always sends the first snapshot", () => {
    expect(shouldSendSnapshot(null, snapshot(), 0, T0)).toBe(true);
  });

  it("does not resend while a running clock follows the expected countdown", () => {
    const sent = snapshot({ secondsLeft: 1500 });
    for (let tick = 1; tick <= 120; tick += 1) {
      expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 1500 - tick }), T0, T0 + tick * 1000 + 40)).toBe(false);
    }
  });

  it("re-syncs a running clock once it drifts by two seconds", () => {
    const sent = snapshot({ secondsLeft: 1500 });
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 1490 }), T0, T0 + 10_000)).toBe(false);
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 1491 }), T0, T0 + 10_000)).toBe(false);
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 1492 }), T0, T0 + 10_000)).toBe(true);
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 1488 }), T0, T0 + 10_000)).toBe(true);
  });

  it("sends clock jumps such as reset, skip, or a new preset", () => {
    const sent = snapshot({ secondsLeft: 600 });
    // Reset back to the full length while paused.
    expect(shouldSendSnapshot(snapshot({ running: false, secondsLeft: 600 }), snapshot({ running: false, secondsLeft: 1500, idle: true }), T0, T0 + 5000)).toBe(true);
    // Skip into a break.
    expect(shouldSendSnapshot(sent, snapshot({ phase: "break", secondsLeft: 300 }), T0, T0 + 1000)).toBe(true);
    // A new preset while running (clock jump without any flag change).
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 3000 }), T0, T0 + 1000)).toBe(true);
  });

  it("sends pause, resume, idle, and label changes", () => {
    const sent = snapshot({ secondsLeft: 900 });
    expect(shouldSendSnapshot(sent, snapshot({ running: false, secondsLeft: 900 }), T0, T0 + 200)).toBe(true);
    expect(shouldSendSnapshot(snapshot({ running: false, secondsLeft: 900 }), snapshot({ secondsLeft: 900 }), T0, T0 + 60_000)).toBe(true);
    expect(shouldSendSnapshot(snapshot({ running: false, idle: true }), snapshot({ running: false, idle: false }), T0, T0)).toBe(true);
    expect(shouldSendSnapshot(sent, snapshot({ secondsLeft: 900, label: "Renal" }), T0, T0)).toBe(true);
  });

  it("treats any change to a paused clock as visible but ignores a paused clock at rest", () => {
    const paused = snapshot({ running: false, secondsLeft: 1499 });
    expect(shouldSendSnapshot(paused, snapshot({ running: false, secondsLeft: 1499 }), T0, T0 + 600_000)).toBe(false);
    expect(shouldSendSnapshot(paused, snapshot({ running: false, secondsLeft: 1500 }), T0, T0 + 1000)).toBe(true);
  });

  it("sends disabling and re-enabling, and nothing while disabled", () => {
    const sent = snapshot();
    expect(shouldSendSnapshot(sent, snapshot({ enabled: false }), T0, T0)).toBe(true);
    const disabled = snapshot({ enabled: false });
    expect(shouldSendSnapshot(disabled, snapshot({ enabled: false, phase: "break", running: false, secondsLeft: 20 }), T0, T0 + 5000)).toBe(false);
    expect(shouldSendSnapshot(disabled, snapshot({ secondsLeft: 20 }), T0, T0 + 5000)).toBe(true);
  });
});

describe("menu bar preference and actions", () => {
  it("is on unless explicitly switched off", () => {
    expect(isMenuBarTimerEnabled(undefined)).toBe(true);
    expect(isMenuBarTimerEnabled({})).toBe(true);
    expect(isMenuBarTimerEnabled({ showInMenuBar: true })).toBe(true);
    expect(isMenuBarTimerEnabled({ showInMenuBar: false })).toBe(false);
  });

  it("accepts only known menu actions", () => {
    for (const action of ["toggle", "start", "pause", "skip", "reset"]) expect(parseMenuBarAction(action)).toBe(action);
    expect(parseMenuBarAction("quit")).toBeNull();
    expect(parseMenuBarAction(undefined)).toBeNull();
    expect(parseMenuBarAction({ action: "skip" })).toBeNull();
  });
});
