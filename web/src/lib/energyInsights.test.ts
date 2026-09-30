import { describe, expect, it } from "vitest";
import { collectEnergySamples, dayRhythm, energyDrivers, peakWindow, todaysCapacity, type EnergyInputs } from "./energyInsights";
import type { StudyLog } from "./types";

const TODAY = "2026-09-26";
const NOW = new Date(2026, 8, 26, 18, 0);
const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0).toISOString();
const dayKey = (day: number) => `2026-09-${String(day).padStart(2, "0")}`;
const log = (day: number, minutes: number, hour = 10, extra: Partial<StudyLog> = {}): StudyLog =>
  ({ id: `log-${day}-${hour}-${minutes}`, dayKey: dayKey(day), ts: at(day, hour), type: "Study", minutes, cards: 0, academic: true, productive: true, ...extra } as StudyLog);

describe("energy samples", () => {
  it("puts every self-report on one 0–100 scale", () => {
    const samples = collectEnergySamples({
      energyChecks: [{ at: at(20, 9), score: 75 }],
      journal: [{ id: "j", date: `${dayKey(20)}T12:00:00`, today: "", tomorrow: "", blockers: "", energy: "Low", rating: "" }],
      closeouts: [{ id: "c", dayKey: dayKey(20), completedSummary: "", energyNow: 40, tomorrowMode: "auto", createdAt: at(20, 21), updatedAt: at(20, 21) }],
      sessions: [{ id: "s", title: "x", link: { kind: "free", label: "" }, segments: [], status: "completed", quickLogs: [], source: "manual", dayKey: dayKey(20), createdAt: at(20, 14), endedAt: at(20, 15), capture: { outcome: "completed", energyAfter: "High" } }],
    });
    expect(samples.map((item) => [item.source, item.score])).toEqual([["check", 75], ["journal", 30], ["session", 85], ["closeout", 40]]);
  });
});

describe("day rhythm and peak window", () => {
  it("counts late-night study (00:00-04:59) instead of dropping it", () => {
    const rhythm = dayRhythm({ logs: [log(24, 45, 2), log(24, 30, 23)] }, NOW);
    expect(rhythm.at(-1)).toMatchObject({ label: "Late night", startHour: 0, endHour: 5, minutes: 45 });
    expect(rhythm.reduce((sum, band) => sum + band.minutes, 0)).toBe(75);
  });

  it("finds the sharpest band by accuracy once there are enough answers", () => {
    const attempts = [
      ...Array.from({ length: 12 }, (_, i) => ({ at: at(20, 9), status: i < 10 ? "correct" : "incorrect" })),
      ...Array.from({ length: 12 }, (_, i) => ({ at: at(21, 21), status: i < 6 ? "correct" : "incorrect" })),
    ];
    const rhythm = dayRhythm({ attempts, logs: [log(20, 60, 9), log(21, 30, 21)] }, NOW);
    const morning = rhythm.find((band) => band.label === "Morning")!;
    expect(morning).toMatchObject({ accuracy: 83, answered: 12, minutes: 60 });
    expect(peakWindow(rhythm)).toMatchObject({ basis: "accuracy", band: { label: "Morning" } });
  });

  it("says nothing without enough evidence", () => {
    const rhythm = dayRhythm({ energyChecks: [{ at: at(25, 9), score: 80 }] }, NOW);
    expect(rhythm.every((band) => band.energy === null && band.accuracy === null)).toBe(true);
    expect(peakWindow(rhythm)).toBeNull();
  });
});

describe("energy drivers", () => {
  it("compares energy on days with and without a driver, with sample sizes", () => {
    const input: EnergyInputs = {
      energyChecks: [10, 11, 12, 13, 14, 15, 16, 17].map((day) => ({ at: at(day, 9), score: day % 2 === 0 ? 80 : 50 })),
      rests: [10, 12, 14, 16].map((day) => ({ startedAt: at(day, 14) })),
    };
    const drivers = energyDrivers(input, NOW);
    const rest = drivers.find((driver) => driver.id === "rest")!;
    expect(rest).toMatchObject({ withAverage: 80, withoutAverage: 50, withDays: 4, withoutDays: 4, difference: 30 });
  });

  it("needs at least three days on each side", () => {
    expect(energyDrivers({ energyChecks: [{ at: at(20, 9), score: 80 }], rests: [{ startedAt: at(20, 10) }] }, NOW)).toEqual([]);
  });
});

describe("today's capacity", () => {
  it("goes lighter after a long day and a low check, and suggests fewer minutes", () => {
    const logs = [log(18, 120), log(19, 120), log(20, 120), log(21, 120), log(22, 120), log(23, 120), log(24, 110), log(25, 260)];
    const energyChecks = [18, 19, 20, 21, 22].map((day) => ({ at: at(day, 9), score: 70 })).concat([{ at: at(26, 8), score: 35 }]);
    const capacity = todaysCapacity({ logs, energyChecks }, TODAY, NOW);
    expect(capacity).toMatchObject({ level: "lighter", typicalMinutes: 120, suggestedMinutes: 90, hasEvidence: true });
    expect(capacity.reasons.join(" ")).toMatch(/below your usual/);
    expect(capacity.reasons.join(" ")).toMatch(/Yesterday ran long \(260 min vs a typical 120\)/);
  });

  it("admits when there is no signal instead of guessing", () => {
    const capacity = todaysCapacity({}, TODAY, NOW);
    expect(capacity).toMatchObject({ hasEvidence: false, label: "No signal yet", suggestedMinutes: 0 });
  });
});
