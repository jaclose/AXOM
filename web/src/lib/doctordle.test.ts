// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DOCTORDLE_ASK_AFTER_MS, EMPTY_DOCTORDLE_LOG, doctordleCaseNumber, doctordleStreak, normalizeDoctordleLog,
  shouldAskResult, shouldRemind, useDoctordle, type DoctordleLog,
} from "./doctordle";

const NOON = Date.parse("2026-09-29T16:00:00Z"); // 12:00 in Grenada
const log = (patch: Partial<DoctordleLog>): DoctordleLog => ({ ...EMPTY_DOCTORDLE_LOG, ...patch });

beforeEach(() => {
  localStorage.clear();
  useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG } });
});

describe("doctordleCaseNumber", () => {
  it("matches doctordle.org's own numbering (#440 on 2026-09-29) and turns over at 05:00 UTC", () => {
    expect(doctordleCaseNumber(NOON)).toBe(440);
    expect(doctordleCaseNumber(Date.parse("2026-09-30T04:59:00Z"))).toBe(440);
    expect(doctordleCaseNumber(Date.parse("2026-09-30T05:00:00Z"))).toBe(441);
  });
});

describe("doctordleStreak", () => {
  it("counts solved cases in a row, including yesterday before today is logged", () => {
    const history = log({ results: { 437: "solved", 438: "solved", 439: "solved" } });
    expect(doctordleStreak(history, 440)).toBe(3);
    expect(doctordleStreak({ ...history, results: { ...history.results, 440: "missed" } }, 440)).toBe(0);
    expect(doctordleStreak(log({ results: { 438: "solved" } }), 440)).toBe(0);
  });
});

describe("asking how it went", () => {
  const opened = log({ opened: [440], lastOpenedAt: NOON });
  it("waits a moment after opening, then asks once", () => {
    expect(shouldAskResult(opened, 440, NOON + 1_000)).toBe(false);
    expect(shouldAskResult(opened, 440, NOON + DOCTORDLE_ASK_AFTER_MS)).toBe(true);
    expect(shouldAskResult({ ...opened, results: { 440: "solved" } }, 440, NOON + 60_000)).toBe(false);
    expect(shouldAskResult({ ...opened, snoozedUntil: NOON + 120_000 }, 440, NOON + 60_000)).toBe(false);
  });
});

describe("dashboard reminder", () => {
  it("only nudges a regular who hasn't touched today's case", () => {
    expect(shouldRemind(log({ opened: [438] }), 440, NOON)).toBe(false);
    const regular = log({ opened: [436], results: { 438: "solved" } });
    expect(shouldRemind(regular, 440, NOON)).toBe(true);
    expect(shouldRemind({ ...regular, opened: [436, 440] }, 440, NOON)).toBe(false);
    expect(shouldRemind({ ...regular, skipped: [440] }, 440, NOON)).toBe(false);
    expect(shouldRemind({ ...regular, remindersOff: true }, 440, NOON)).toBe(false);
    expect(shouldRemind({ ...regular, snoozedUntil: NOON + 1 }, 440, NOON)).toBe(false);
    expect(shouldRemind(log({ opened: [400, 401] }), 440, NOON)).toBe(false);
  });
});

describe("store", () => {
  it("records an open, then a result, and persists both", () => {
    useDoctordle.getState().recordOpen(NOON);
    useDoctordle.getState().recordResult("solved", NOON + 60_000);
    const saved = normalizeDoctordleLog(JSON.parse(localStorage.getItem("axom.doctordle.v1")!));
    expect(saved.opened).toEqual([440]);
    expect(saved.results).toEqual({ 440: "solved" });
    expect(normalizeDoctordleLog({ results: { x: "solved", 3: "won" }, opened: ["a", 5] })).toMatchObject({ opened: [5], results: {} });
  });
});
