// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordObservedActivity, studyActivityTotals, type StudyActivity } from "./studyActivity";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { makeDailyRequirement, evaluateDailySuccess, normalizeDailySuccessConfig } from "./dailySuccess";
import { dayTotals } from "./scoring";
import { localDateKey } from "./dailyRollover";
import { usePomodoro } from "./pomodoro";
const timestamp = (hour: number, minute = 0) => new Date(2026, 8, 28, hour, minute).toISOString();
const today = localDateKey(new Date(timestamp(12)));
const event = (patch: Partial<StudyActivity> = {}): StudyActivity => ({ eventId: "review-a", kind: "flashcards", source: "axom", endedAt: timestamp(12), durationSeconds: 60, quantity: 1, ...patch });
beforeEach(() => { useStore.setState(makeSeed()); });
afterEach(() => { usePomodoro.getState().pause(); vi.useRealTimers(); });

describe("observed study ledger", () => {
  it("replays the same native event without duplicate counts after serialization", () => {
    const logs = JSON.parse(JSON.stringify(recordObservedActivity([], event())));
    expect(recordObservedActivity(logs, event())).toBe(logs);
    expect(studyActivityTotals(logs, today).cards).toBe(1);
  });
  it("replaces an aggregate imported snapshot, preserving native reviews", () => {
    let logs = recordObservedActivity([], event());
    const imported = event({ eventId: "anki:today", source: "anki", quantity: 23, durationSeconds: undefined });
    logs = recordObservedActivity(logs, imported, true);
    logs = recordObservedActivity(logs, { ...imported, quantity: 29 }, true);
    expect(studyActivityTotals(logs, today).cards).toBe(30);
    expect(logs.filter((log) => log.activity?.source === "anki")).toHaveLength(1);
  });
  it("credits timer overlap once and preserves activity quantities", () => {
    let logs = recordObservedActivity([], event({ durationSeconds: 120 }));
    logs = recordObservedActivity(logs, event({ eventId: "timer", kind: "pomodoro", quantity: undefined, durationSeconds: 1500, completed: true }));
    expect(dayTotals(logs, today)).toEqual({ minutes: 25, cards: 1 });
    expect(studyActivityTotals(logs, today).pomodoros).toBe(1);
    expect(logs.find((log) => log.activity?.kind === "flashcards")?.activity?.durationSeconds).toBe(120);
  });
  it("recomputes the old day when a replaced event moves across midnight", () => {
    let logs = recordObservedActivity([], event({ durationSeconds: 120 }));
    logs = recordObservedActivity(logs, event({ eventId: "timer", kind: "pomodoro", durationSeconds: 120 }));
    expect(logs.find((log) => log.activity?.eventId === "review-a")?.minutes).toBe(0);
    logs = recordObservedActivity(logs, event({ eventId: "timer", kind: "pomodoro", durationSeconds: 120, endedAt: new Date(2026, 8, 29, 12).toISOString() }), true);
    expect(logs.find((log) => log.activity?.eventId === "review-a")?.minutes).toBe(2);
  });
  it("accumulates subminute reviews", () => {
    let logs = recordObservedActivity([], event({ durationSeconds: 30 }));
    logs = recordObservedActivity(logs, event({ eventId: "b", durationSeconds: 30, endedAt: new Date(Date.parse(timestamp(12)) + 30000).toISOString() }));
    expect(dayTotals(logs, today)).toEqual({ minutes: 1, cards: 2 });
  });
  it("splits time at local midnight and attributes counts to completion", () => {
    const end = new Date(2026, 8, 29, 0, 10);
    const logs = recordObservedActivity([], event({ endedAt: end.toISOString(), durationSeconds: 1200 }));
    expect(dayTotals(logs, today)).toEqual({ minutes: 10, cards: 0 });
    expect(dayTotals(logs, localDateKey(end))).toEqual({ minutes: 10, cards: 1 });
  });
  it("excludes paused intervals and invents no import time", () => {
    const logs = recordObservedActivity([], event({ durationSeconds: undefined, intervals: [{ startedAt: timestamp(10), endedAt: timestamp(10, 10) }, { startedAt: timestamp(11), endedAt: timestamp(11, 10) }] }));
    expect(dayTotals(logs, today).minutes).toBe(20);
    expect(recordObservedActivity([], event({ durationSeconds: undefined }))[0].minutes).toBe(0);
  });
  it("rejects invalid timestamps and nonfinite quantities", () => {
    expect(recordObservedActivity([], event({ endedAt: "bad" }))).toEqual([]);
    expect(dayTotals(recordObservedActivity([], event({ quantity: NaN, durationSeconds: Infinity })), today)).toEqual({ minutes: 0, cards: 0 });
  });
});

describe("native study actions", () => {
  it("atomically saves an answer and one productivity event", () => {
    const added = useStore.getState().addQuestion({ stem: "Observed question", options: [{ key: "A", text: "Yes" }, { key: "B", text: "No" }], correctKey: "A", category: "Renal" });
    expect(added.ok).toBe(true);
    const attempt = { eventId: "attempt-one", answerKey: "A", status: "correct" as const, timeSpentSeconds: 90, endedAt: timestamp(12) };
    useStore.getState().recordQuestionAttempt(added.id!, attempt);
    useStore.getState().recordQuestionAttempt(added.id!, attempt);
    expect(useStore.getState().questions.find((question) => question.id === added.id)?.attempts).toHaveLength(1);
    expect(studyActivityTotals(useStore.getState().logs, today)).toMatchObject({ questions: 1, correct: 1, incorrect: 0, skipped: 0 });
  });
  it("keeps skipped questions distinct from completed and incorrect", () => {
    const added = useStore.getState().addQuestion({ stem: "Skipped question", options: [{ key: "A", text: "Yes" }, { key: "B", text: "No" }], correctKey: "A" });
    useStore.getState().recordQuestionAttempt(added.id!, { eventId: "skip", status: "incorrect", endedAt: timestamp(12) });
    expect(studyActivityTotals(useStore.getState().logs, today)).toMatchObject({ questions: 0, incorrect: 0, skipped: 1 });
  });
  it("saves a card rating and review count once", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
    useStore.getState().addAnkiCards([{ type: "basic", front: "Front", back: "Back" }]);
    const card = useStore.getState().ankiCards[0];
    useStore.getState().reviewAnkiCard(card.id, "good", 60000, "review-1");
    useStore.getState().reviewAnkiCard(card.id, "good", 60000, "review-1");
    expect(useStore.getState().cardReviews).toHaveLength(1);
    expect(dayTotals(useStore.getState().logs, today)).toEqual({ minutes: 1, cards: 1 });
  });
  it("protects Study automation while allowing icon and amount edits", () => {
    useStore.getState().updateProductivityTracker("tracker-study", { name: "Gym", unitType: "count", archived: true, contributesToAcademicStudy: false, icon: "Brain", dailyTarget: 90 });
    expect(useStore.getState().productivityTrackers.find((tracker) => tracker.id === "tracker-study")).toMatchObject({ name: "Study", unitType: "minutes", archived: false, contributesToAcademicStudy: true, icon: "Brain", dailyTarget: 90 });
  });
  it("logs paused/resumed Pomodoro time once", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
    useStore.setState({ activeDayKey: today });
    usePomodoro.getState().runCustom({ focus: 2, break: 1, longBreak: 2, cyclesBeforeLongBreak: 4 });
    usePomodoro.getState().start();
    vi.setSystemTime(Date.now() + 60000); usePomodoro.getState().pause();
    vi.setSystemTime(Date.now() + 600000); usePomodoro.getState().start();
    vi.setSystemTime(Date.now() + 61000); usePomodoro.getState()._tick();
    expect(dayTotals(useStore.getState().logs, today).minutes).toBe(2);
    expect(useStore.getState().logs[0].activity?.intervals).toHaveLength(2);
    const saved = JSON.parse(JSON.stringify(useStore.getState().logs));
    useStore.getState().recordStudyActivity(saved[0].activity);
    expect(useStore.getState().logs).toHaveLength(1);
  });
});

it("sums weekly hours without requiring daily completions", () => {
  const state = makeSeed(); state.activeDayKey = today;
  const requirement = makeDailyRequirement({ id: "weekly-study", label: "Study", source: { kind: "study-minutes" }, target: 5, unit: "hours", schedule: { kind: "weekly-total", weekStartsOn: 1 }, trackingStartsAt: today });
  state.profile.dailySuccess = normalizeDailySuccessConfig({ version: 1, configuredAt: today, requirements: [requirement] });
  state.logs = recordObservedActivity([], event({ kind: "pomodoro", durationSeconds: 7200, quantity: undefined }));
  const result = evaluateDailySuccess(state).requirements[0];
  expect(result).toMatchObject({ current: 2, target: 5, ratio: 0.4, status: "in-progress" });
  expect(result.calculation).toContain("this week");
});
