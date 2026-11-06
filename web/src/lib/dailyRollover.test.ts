import { describe, expect, it } from "vitest";
import {
  buildDailyArchive,
  carryOpenTasksForward,
  daysBetweenLocalDates,
  lastRolloverDone,
  markRolloverDone,
  mergeRolloverEvent,
  shouldRollover,
} from "./dailyRollover";
import type { DailyRolloverEvent, AxomState } from "./types";

function state(patch: Partial<AxomState> = {}): AxomState {
  return {
    profile: {} as AxomState["profile"],
    terms: [],
    courses: [],
    tracker: [],
    productivityTrackers: [],
    resources: [],
    tasks: [],
    journal: [],
    premedExperiences: [],
    prompts: [],
    folders: [],
    logs: [],
    integrations: [],
    boardPrep: {} as AxomState["boardPrep"],
    dayPlans: [],
    blueprintInstalls: [],
    activeDayKey: "2026-06-23",
    lastActiveLocalDate: "2026-06-23",
    lastTimezoneOffset: 240,
    dailyArchives: [],
    dailyRolloverEvents: [],
    energyFactors: [],
    habits: [],
    habitEntries: [],
    sessions: [],
    closeouts: [],
    recoveryPlans: [],
    questions: [],
    quizSessions: [],
    documents: [],
    questionSets: [],
    savedQuestionFilters: [],
    quizBlocks: [],
    ankiCards: [],
    cardReviews: [],
    dailyWordPuzzles: [],
    schemaVersion: 30,
    ...patch,
  };
}

function dateWithOffset(value: string, offset: number): Date {
  const date = new Date(value);
  date.getTimezoneOffset = () => offset;
  return date;
}

describe("daily rollover helpers", () => {
  it("detects an app opened after midnight", () => {
    const decision = shouldRollover(state(), dateWithOffset("2026-06-24T08:00:00", 240));
    expect(decision.due).toBe(true);
    expect(decision.today).toBe("2026-06-24");
    expect(decision.daysAway).toBe(1);
  });

  it("detects a user returning after three days", () => {
    expect(daysBetweenLocalDates("2026-06-21", "2026-06-24")).toBe(3);
    const decision = shouldRollover(state({ lastActiveLocalDate: "2026-06-21", activeDayKey: "2026-06-21" }), dateWithOffset("2026-06-24T09:00:00", 240));
    expect(decision.daysAway).toBe(3);
  });

  it("detects a timezone change even when the local date did not advance", () => {
    const decision = shouldRollover(state({ lastActiveLocalDate: "2026-06-24", activeDayKey: "2026-06-24", lastTimezoneOffset: 240 }), dateWithOffset("2026-06-24T12:00:00", 180));
    expect(decision.due).toBe(true);
    expect(decision.timezoneChanged).toBe(true);
    expect(decision.daysAway).toBe(0);
  });

  it("carries unfinished due tasks forward without touching completed or undated tasks", () => {
    const carried = carryOpenTasksForward([
      { id: "a", title: "Due yesterday", due: "2026-06-23", done: false, archived: false, created: "x" },
      { id: "b", title: "Done", due: "2026-06-23", done: true, archived: false, created: "x" },
      { id: "c", title: "No date", done: false, archived: false, created: "x" },
    ], "2026-06-23", "2026-06-24", "2026-06-24T08:00:00.000Z");
    expect(carried.carriedTaskIds).toEqual(["a"]);
    expect(carried.tasks.find((task) => task.id === "a")?.due).toBe("2026-06-24");
    expect(carried.tasks.find((task) => task.id === "b")?.due).toBe("2026-06-23");
  });

  it("builds an archive from preserved dated data", () => {
    const archived = buildDailyArchive(state({
      logs: [{ id: "log", dayKey: "2026-06-23", ts: "x", type: "Study", minutes: 50, cards: 20 }],
      tasks: [{ id: "task", title: "Task", due: "2026-06-23", done: false, archived: false, created: "x" }],
      journal: [{ id: "j", date: "2026-06-23T20:00:00", today: "A", tomorrow: "B", blockers: "", energy: "High", rating: "Useful" }],
      dayPlans: [{ dayKey: "2026-06-23", intention: "Win", wins: [], createdAt: "x", outcome: "partial" }],
      energyFactors: [{ id: "energy", date: "2026-06-23", source: "manual", label: "Poor sleep", category: "sleep", delta: -10, confidence: 1, carryoverDays: 2, decayPerDay: 0.4, userConfirmed: true }],
    }), "2026-06-23", ["task"], "2026-06-24T08:00:00.000Z");
    expect(archived.studyMinutes).toBe(50);
    expect(archived.ankiCards).toBe(20);
    expect(archived.journalEntryIds).toEqual(["j"]);
    expect(archived.energyFactorIds).toEqual(["energy"]);
    expect(archived.dayPlanOutcome).toBe("partial");
  });

  it("prevents duplicate rollover events for the same target date", () => {
    const base: DailyRolloverEvent = {
      id: "1",
      fromDate: "2026-06-23",
      toDate: "2026-06-24",
      processedAt: "2026-06-24T08:00:00.000Z",
      reason: "app-load",
      daysAway: 1,
      timezoneOffset: 240,
      carriedTaskIds: [],
    };
    const duplicate = { ...base, id: "2", reason: "focus" as const };
    expect(mergeRolloverEvent(mergeRolloverEvent([], base), duplicate)).toHaveLength(1);
  });

  it("does not throw when storage is unavailable", () => {
    expect(() => markRolloverDone(undefined, "2026-06-24")).not.toThrow();
    expect(lastRolloverDone(undefined)).toBe("");
  });
});
