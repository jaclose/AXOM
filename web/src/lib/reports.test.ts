import { describe, expect, it } from "vitest";
import { makeDailyRequirement } from "./dailySuccess";
import { buildCanonicalReportSummary, buildCanonicalReportTrends, compareReportPeriods, reportDateKeys, buildCalendarWeeks, summarizeActivityWeek, buildActivityRhythm } from "./reports";
import { makeSeed } from "./seed";
import type { StudyLog } from "./types";

const TODAY = "2026-07-12";

function log(id: string, dayKey: string, minutes: number): StudyLog {
  return { id, dayKey, ts: `${dayKey}T12:00:00.000Z`, type: "Study", minutes, cards: 0, academic: true, productive: true };
}

describe("canonical reports", () => {
  it("anchors ranges to the active day and never includes future dates", () => {
    expect(reportDateKeys(TODAY, 3)).toEqual(["2026-07-10", "2026-07-11", TODAY]);
  });

  it("does not create pre-creation failures or denominator days", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-11",
      requirements: [makeDailyRequirement({
        id: "minutes", label: "Study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", trackingStartsAt: "2026-07-11",
      }, "2026-07-11")],
    };
    state.logs = [log("old", "2026-07-01", 60), log("current", TODAY, 15)];
    const summary = buildCanonicalReportSummary(state, 14);
    expect(summary.observedDates).toEqual(["2026-07-11", TODAY]);
    expect(summary.eligibleDates).toEqual(["2026-07-11", TODAY]);
    expect(summary.scoredDates).toEqual(["2026-07-11"]);
    expect(summary.metrics.consistency.denominator).toBe(1);
    expect(summary.metrics["daily-success"].denominator).toBe(1);
    expect(summary.metrics.study.sourceRecordIds).toEqual(["current"]);
  });

  it("exposes useful denominators and source record provenance", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-10",
      requirements: [makeDailyRequirement({
        id: "minutes", label: "Study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", trackingStartsAt: "2026-07-10",
      }, "2026-07-10")],
    };
    state.logs = [log("a", "2026-07-10", 30), log("b", "2026-07-11", 45)];
    const summary = buildCanonicalReportSummary(state, 14);
    expect(summary.metrics.consistency).toMatchObject({ numerator: 2, denominator: 2, value: "100%" });
    expect(summary.metrics["daily-success"]).toMatchObject({ numerator: 2, denominator: 2, value: "100%" });
    expect(summary.metrics["daily-success"].sourceRecordIds).toEqual(["a", "b"]);
    expect(summary.metrics.consistency.calculation).toContain("eligible days");
  });

  it("keeps an unconfigured new workspace neutral instead of claiming failures", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = { version: 1, configuredAt: TODAY, requirements: [] };
    state.logs = [];
    const summary = buildCanonicalReportSummary(state, 30);
    expect(summary.eligibleDates).toEqual([]);
    expect(summary.scoredDates).toEqual([]);
    expect(summary.metrics.consistency).toMatchObject({ state: "neutral", denominator: 0, note: "0/0 completed eligible days had activity" });
    expect(summary.metrics["daily-success"]).toMatchObject({ state: "neutral", value: "Not configured", denominator: 0 });
    expect(summary.metrics.streak.value).toBe("Building");
  });

  it("excludes off-schedule weekdays from eligible denominators", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY; // Sunday
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-06",
      requirements: [makeDailyRequirement({
        id: "weekday-minutes", label: "Weekday study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", schedule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] }, trackingStartsAt: "2026-07-06",
      }, "2026-07-06")],
    };
    state.logs = [log("mon", "2026-07-06", 30), log("tue", "2026-07-07", 30), log("sun", TODAY, 90)];
    const summary = buildCanonicalReportSummary(state, 7);
    expect(summary.eligibleDates).toEqual(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]);
    expect(summary.scoredDates).toEqual(summary.eligibleDates);
    expect(summary.metrics.consistency).toMatchObject({ numerator: 2, denominator: 5, value: "40%" });
    expect(summary.metrics["daily-success"]).toMatchObject({ numerator: 2, denominator: 5, value: "40%" });
  });

  it("nets signed study corrections per day while retaining source provenance", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = { version: 1, configuredAt: TODAY, requirements: [] };
    state.logs = [log("add", TODAY, 60), log("correction", TODAY, -20)];
    const summary = buildCanonicalReportSummary(state, 14);
    expect(summary.metrics.study).toMatchObject({ numerator: 40, note: expect.stringContaining("40 minutes") });
    expect(summary.metrics.study.calculation).toContain("signed corrections");
    expect(summary.metrics.study.sourceRecordIds).toEqual(["add", "correction"]);
  });

  it("uses each tracker kind's canonical completion target for mastery", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = { version: 1, configuredAt: TODAY, requirements: [] };
    state.tracker = [
      { id: "pq", path: "Course", label: "Questions", kind: "PQ", passes: 3, ankiPasses: 0, yield: "none", updated: "" },
      { id: "requirement", path: "Course", label: "Requirement", kind: "Requirement", passes: 1, ankiPasses: 0, yield: "none", updated: "" },
      { id: "reading", path: "Course", label: "Reading", kind: "Reading", passes: 2, ankiPasses: 0, yield: "low", updated: "" },
      { id: "lecture", path: "Course", label: "Lecture", kind: "Lecture", passes: 4, ankiPasses: 0, yield: "high", updated: "" },
    ];
    const mastery = buildCanonicalReportSummary(state, 14).metrics["tracker-mastery"];
    expect(mastery).toMatchObject({ numerator: 4, denominator: 4, value: "100%", note: "4 completed · 0 active" });
  });

  it("separates mastery, review, Anki linkage, and in-period task states", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.logs = [];
    state.profile.dailySuccess = { version: 1, configuredAt: TODAY, requirements: [] };
    state.tracker = [
      { id: "done", path: "Course", label: "Done", kind: "Lecture", passes: 4, ankiPasses: 1, yield: "none", updated: "" },
      { id: "active", path: "Course", label: "Active", kind: "Lecture", passes: 1, ankiPasses: 0, yield: "review", updated: "" },
    ];
    state.tasks = [
      { id: "complete", title: "Done", done: true, created: "", completedAt: `${TODAY}T10:00:00.000Z` },
      { id: "due", title: "Due", done: false, created: "", due: "2026-07-11" },
      { id: "archived", title: "Archived", done: false, archived: true, created: "", due: "2026-07-11" },
    ];
    const summary = buildCanonicalReportSummary(state, 14);
    expect(summary.metrics["tracker-mastery"].calculation).toContain("2 reviewed; 1 Anki-linked");
    expect(summary.metrics.tasks).toMatchObject({ value: "1/2", note: "1 completed · 1 due · 1 overdue" });
    expect(summary.metrics.tasks.sourceRecordIds).toEqual(["complete", "due"]);
  });
});

describe("canonical report trends", () => {
  it("builds current and prior seven-eligible-day periods with grounded comparison", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    const dates = reportDateKeys(TODAY, 14);
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: dates[0],
      requirements: [makeDailyRequirement({
        id: "minutes", label: "Study", source: { kind: "study-minutes" }, target: 1,
        unit: "minutes", trackingStartsAt: dates[0],
      }, dates[0])],
    };
    state.logs = dates.flatMap((dayKey, index) => [
      log(`minutes-${index}`, dayKey, index < 7 ? 10 : 20),
      {
        ...log(`questions-${index}`, dayKey, 0),
        quantity: index < 7 ? 1 : 5,
        quantityKind: "questions" as const,
      },
    ]);
    const trends = buildCanonicalReportTrends(state);
    expect(trends.currentWeek).toHaveLength(7);
    expect(trends.previousWeek).toHaveLength(7);
    const comparison = compareReportPeriods(trends.currentWeek, trends.previousWeek, "minutes");
    expect(comparison).toMatchObject({
      sufficient: true,
      currentValue: 140,
      previousValue: 70,
      percentChange: 100,
      strongestContributor: "Practice questions",
      quietEligibleDays: 0,
    });
  });

  it("keeps off-schedule month dates neutral and a pending current day unscored", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY; // Sunday
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-01",
      requirements: [makeDailyRequirement({
        id: "weekdays", label: "Weekday study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", schedule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] }, trackingStartsAt: "2026-07-01",
      }, "2026-07-01")],
    };
    state.logs = [];
    const trends = buildCanonicalReportTrends(state);
    const sunday = trends.month.find((day) => day.dayKey === TODAY)!;
    expect(sunday).toMatchObject({ eligible: false, scored: false, status: "neutral" });
    expect(trends.currentWeek.every((day) => day.eligible)).toBe(true);
    expect(trends.currentWeek.at(-1)).toMatchObject({ scored: true, status: "missed" });
  });

  it("stays neutral when a prior eligible comparison is incomplete", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-10",
      requirements: [makeDailyRequirement({
        id: "minutes", label: "Study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", trackingStartsAt: "2026-07-10",
      }, "2026-07-10")],
    };
    state.logs = [log("today", TODAY, 40)];
    const trends = buildCanonicalReportTrends(state);
    expect(compareReportPeriods(trends.currentWeek, trends.previousWeek, "minutes")).toMatchObject({
      sufficient: false,
      interpretation: "Not enough data yet for a reliable prior-week comparison.",
    });
  });

  it("does not let an eligible but pending current day unlock a weekly claim", () => {
    const state = makeSeed();
    state.activeDayKey = TODAY;
    const dates = reportDateKeys(TODAY, 14);
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: dates[0],
      requirements: [makeDailyRequirement({
        id: "minutes", label: "Study", source: { kind: "study-minutes" }, target: 30,
        unit: "minutes", trackingStartsAt: dates[0],
      }, dates[0])],
    };
    state.logs = dates.slice(0, -1).map((dayKey, index) => log(`log-${index}`, dayKey, 30));
    const trends = buildCanonicalReportTrends(state);
    expect(trends.currentWeek.at(-1)).toMatchObject({ dayKey: TODAY, eligible: true, scored: false, status: "pending" });
    expect(compareReportPeriods(trends.currentWeek, trends.previousWeek, "minutes").sufficient).toBe(false);
  });
});

describe("activity-based report trends", () => {
  function stateWithLogs(minutesByOffset: Record<number, number>) {
    const state = makeSeed();
    state.activeDayKey = "2026-09-26";
    state.profile.dailySuccess = undefined;
    state.logs = Object.entries(minutesByOffset).map(([offset, minutes]) => {
      const date = new Date(2026, 8, 26 - Number(offset), 12);
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { id: `log-${offset}`, dayKey, ts: `${dayKey}T12:00:00.000Z`, type: "Study", minutes, cards: 0, academic: true, productive: true };
    });
    return state;
  }

  it("splits the last 14 calendar days into this week and last week", () => {
    const weeks = buildCalendarWeeks(stateWithLogs({ 0: 30, 7: 60 }));
    expect(weeks.current.map((day) => day.dayKey)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(weeks.previous[6].dayKey).toBe("2026-09-19");
    expect(weeks.current[6].minutes).toBe(30);
    expect(weeks.previous[6].minutes).toBe(60);
  });

  it("summarizes the week against the previous seven days", () => {
    const weeks = buildCalendarWeeks(stateWithLogs({ 0: 60, 1: 60, 7: 40, 8: 40 }));
    const summary = summarizeActivityWeek(weeks.current, weeks.previous, "minutes");
    expect(summary).toMatchObject({ total: 120, previousTotal: 80, activeDays: 2, percentChange: 50, bestDayKey: "2026-09-25" });
    expect(summary.interpretation).toMatch(/up 50%/);
    expect(summarizeActivityWeek(weeks.current, weeks.current.map((day) => ({ ...day, minutes: 0 })), "minutes").percentChange).toBeNull();
  });

  it("counts an activity streak without letting an empty today break it", () => {
    const rhythm = buildActivityRhythm(stateWithLogs({ 1: 30, 2: 30, 3: 30, 5: 30, 9: 30 }), 14);
    expect(rhythm.streak.value).toBe("3");
    expect(rhythm.consistency.note).toBe("5 of 9 days had logged activity");
    const withToday = buildActivityRhythm(stateWithLogs({ 0: 10, 1: 30 }), 14);
    expect(withToday.streak.value).toBe("2");
  });
});
