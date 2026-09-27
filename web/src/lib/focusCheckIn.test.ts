import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS_CHECKIN,
  effectiveIntervalMinutes,
  emptyFocusLedger,
  evaluateFocusCheckIn,
  formatMinutes,
  lockedInRate,
  markPrompted,
  normalizeFocusCheckInPreferences,
  parseFocusLedger,
  recordResponse,
  responseLine,
  snooze,
} from "./focusCheckIn";

const enabled = normalizeFocusCheckInPreferences({ enabled: true, intervalMinutes: 30 });
const at = (hh: number, mm: number) => new Date(2026, 8, 26, hh, mm);

describe("focus check-in preferences", () => {
  it("is opt-in with safe, bounded defaults", () => {
    expect(normalizeFocusCheckInPreferences(undefined)).toEqual(DEFAULT_FOCUS_CHECKIN);
    expect(normalizeFocusCheckInPreferences({ enabled: "yes" }).enabled).toBe(false);
    expect(normalizeFocusCheckInPreferences({ intervalMinutes: 1 }).intervalMinutes).toBe(5);
    expect(normalizeFocusCheckInPreferences({ intervalMinutes: 9999 }).intervalMinutes).toBe(240);
    expect(normalizeFocusCheckInPreferences({ scope: "anytime", tone: "intense" })).toMatchObject({ scope: "anytime", tone: "intense" });
    expect(normalizeFocusCheckInPreferences({ scope: "weird", tone: "weird" })).toMatchObject({ scope: "focus", tone: "coach" });
  });
});

describe("focus check-in scheduling", () => {
  it("never prompts while disabled or, in focus scope, while no sprint is running", () => {
    const ledger = emptyFocusLedger("2026-09-26");
    expect(evaluateFocusCheckIn({ now: at(10, 0), preferences: DEFAULT_FOCUS_CHECKIN, ledger, focusActive: true }).kind).toBe("idle");
    const idle = evaluateFocusCheckIn({ now: at(10, 0), preferences: enabled, ledger, focusActive: false });
    expect(idle).toMatchObject({ kind: "idle", reason: "not-focused" });
    expect(idle.ledger.armedAt).toBeUndefined();
  });

  it("arms when focus starts and prompts once the interval has passed", () => {
    const first = evaluateFocusCheckIn({ now: at(10, 0), preferences: enabled, ledger: emptyFocusLedger("2026-09-26"), focusActive: true });
    expect(first).toMatchObject({ kind: "idle", reason: "waiting" });
    expect(first.ledger.armedAt).toBe(at(10, 0).toISOString());
    expect(evaluateFocusCheckIn({ now: at(10, 29), preferences: enabled, ledger: first.ledger, focusActive: true }).kind).toBe("idle");
    const due = evaluateFocusCheckIn({ now: at(10, 30), preferences: enabled, ledger: first.ledger, focusActive: true });
    expect(due.kind).toBe("prompt");

    const prompted = markPrompted(due.ledger, at(10, 30));
    expect(prompted.prompts).toBe(1);
    expect(evaluateFocusCheckIn({ now: at(10, 45), preferences: enabled, ledger: prompted, focusActive: true }).kind).toBe("idle");
    expect(evaluateFocusCheckIn({ now: at(11, 0), preferences: enabled, ledger: prompted, focusActive: true }).kind).toBe("prompt");
  });

  it("honors snooze, quiet hours, and resets on a new day", () => {
    const armed = { ...emptyFocusLedger("2026-09-26"), armedAt: at(9, 0).toISOString() };
    const snoozed = snooze(armed, 15, at(9, 40));
    expect(evaluateFocusCheckIn({ now: at(9, 50), preferences: enabled, ledger: snoozed, focusActive: true })).toMatchObject({ reason: "snoozed" });
    expect(evaluateFocusCheckIn({ now: at(10, 25), preferences: enabled, ledger: snoozed, focusActive: true }).kind).toBe("prompt");

    const quiet = { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" };
    const lateLedger = { ...emptyFocusLedger("2026-09-26"), armedAt: at(21, 0).toISOString() };
    expect(evaluateFocusCheckIn({ now: at(23, 0), preferences: enabled, ledger: lateLedger, focusActive: true, quietHours: quiet }))
      .toMatchObject({ kind: "idle", reason: "quiet-hours" });

    const yesterday = { ...emptyFocusLedger("2026-09-25"), prompts: 9, armedAt: new Date(2026, 8, 25, 8).toISOString() };
    const fresh = evaluateFocusCheckIn({ now: at(8, 0), preferences: enabled, ledger: yesterday, focusActive: true });
    expect(fresh.ledger.day).toBe("2026-09-26");
    expect(fresh.ledger.prompts).toBe(0);
  });

  it("anytime scope prompts without a running sprint", () => {
    const anytime = normalizeFocusCheckInPreferences({ enabled: true, intervalMinutes: 10, scope: "anytime" });
    const armed = evaluateFocusCheckIn({ now: at(14, 0), preferences: anytime, ledger: emptyFocusLedger("2026-09-26"), focusActive: false });
    expect(evaluateFocusCheckIn({ now: at(14, 10), preferences: anytime, ledger: armed.ledger, focusActive: false }).kind).toBe("prompt");
  });
});

describe("focus check-in ledger and copy", () => {
  it("counts responses and keeps a locked-in streak", () => {
    let ledger = emptyFocusLedger("2026-09-26");
    ledger = recordResponse(ledger, "locked-in", at(10, 0));
    ledger = recordResponse(ledger, "locked-in", at(10, 30));
    ledger = recordResponse(ledger, "break", at(11, 0));
    expect(ledger).toMatchObject({ lockedIn: 2, breaks: 1, streak: 2 });
    ledger = recordResponse(ledger, "drifted", at(11, 30));
    expect(ledger).toMatchObject({ drifted: 1, streak: 0 });
    expect(lockedInRate(ledger)).toBe(67);
  });

  it("round-trips through storage and rejects malformed entries", () => {
    const ledger = recordResponse(markPrompted(emptyFocusLedger("2026-09-26"), at(9, 0)), "locked-in", at(9, 1));
    expect(parseFocusLedger(JSON.stringify(ledger), "2026-09-26")).toEqual(ledger);
    expect(parseFocusLedger("{bad", "2026-09-26")).toEqual(emptyFocusLedger("2026-09-26"));
    expect(parseFocusLedger(JSON.stringify({ day: "2026-09-26", prompts: -4, lastPromptAt: "nope" }), "2026-09-26"))
      .toMatchObject({ prompts: 0, lastPromptAt: undefined });
    expect(JSON.stringify(ledger)).not.toMatch(/note|journal|question/i);
  });

  it("uses what is left when it knows it, and stays kind after a drift", () => {
    const withTarget = Array.from({ length: 12 }, (_, seed) => responseLine("locked-in", "coach", seed, { target: "42 min to go on Study time" }));
    expect(withTarget).toContain("Just 42 min to go on Study time.");
    expect(responseLine("drifted", "coach", 0)).toMatch(/No shame|Noticing/);
    expect(responseLine("break", "coach", 1)).toBeTruthy();
    expect(formatMinutes(42)).toBe("42 min");
    expect(formatMinutes(135)).toBe("2 h 15 min");
  });
});

describe("varied check-in timing", () => {
  it("stays within ±30%, is stable per prompt, and differs across prompts", () => {
    const varied = normalizeFocusCheckInPreferences({ enabled: true, intervalMinutes: 30, varyTiming: true });
    const values = Array.from({ length: 20 }, (_, prompts) => effectiveIntervalMinutes(varied, { day: "2026-09-26", prompts }));
    expect(values.every((value) => value >= 21 && value <= 39)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(5);
    expect(effectiveIntervalMinutes(varied, { day: "2026-09-26", prompts: 3 })).toBe(values[3]);
    expect(effectiveIntervalMinutes({ ...varied, varyTiming: false }, { day: "2026-09-26", prompts: 3 })).toBe(30);
    expect(effectiveIntervalMinutes({ ...varied, intervalMinutes: 5 }, { day: "2026-09-26", prompts: 1 })).toBeGreaterThanOrEqual(5);
  });
});
