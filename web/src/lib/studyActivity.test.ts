// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordObservedActivity, studyActivityTotals, type StudyActivity } from "./studyActivity";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { summarizeTracker } from "./trackerStats";
import { dayTotals } from "./scoring";
import { localDateKey } from "./dailyRollover";
import { usePomodoro } from "./pomodoro";
const timestamp = (hour: number, minute = 0) => new Date(2026, 8, 28, hour, minute).toISOString();
const today = localDateKey(new Date(timestamp(12)));
const event = (patch: Partial<StudyActivity> = {}): StudyActivity => ({ eventId: "review-a", kind: "flashcards", source: "axom", endedAt: timestamp(12), durationSeconds: 60, quantity: 1, ...patch });
beforeEach(() => { useStore.setState(makeSeed()); });
afterEach(() => { usePomodoro.getState().pause(); vi.useRealTimers(); });

describe("observed study ledger", () => {
  it("applies signed card and question corrections before clamping daily totals", () => {
    const logs = [
      ...recordObservedActivity([], event({ quantity: 10 })),
      { id: "correction", dayKey: today, ts: timestamp(12), type: "Correction", minutes: 0, cards: -4 },
      { id: "questions", dayKey: today, ts: timestamp(12), type: "Questions", minutes: 0, cards: 0, quantity: 8, quantityKind: "questions" as const },
      { id: "question-correction", dayKey: today, ts: timestamp(12), type: "Correction", minutes: 0, cards: 0, quantity: -3, quantityKind: "questions" as const },
    ];
    expect(studyActivityTotals(logs, today)).toMatchObject({ cards: 6, questions: 5 });
    expect(studyActivityTotals([logs[1], logs[3]], today)).toMatchObject({ cards: 0, questions: 0 });
  });
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
  it.each(["reset", "skip", "setPreset", "runCustom"] as const)("accounts for wall time before %s after a delayed tick", (action) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
    usePomodoro.getState().runCustom({ focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 });
    usePomodoro.getState().start();
    vi.setSystemTime(Date.now() + 125000);
    if (action === "setPreset") usePomodoro.getState().setPreset("50-10");
    else if (action === "runCustom") usePomodoro.getState().runCustom({ focus: 30, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 });
    else usePomodoro.getState()[action]();
    expect(dayTotals(useStore.getState().logs, today).minutes).toBe(2);
    expect(useStore.getState().logs[0].activity?.durationSeconds).toBe(125);
  });
  it("keeps subminute partial focus sessions so they can accumulate", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
    usePomodoro.getState().runCustom({ focus: 25, break: 5, longBreak: 15, cyclesBeforeLongBreak: 4 });
    for (let i = 0; i < 2; i++) {
      usePomodoro.getState().start();
      vi.setSystemTime(Date.now() + 30000);
      usePomodoro.getState().reset();
    }
    expect(useStore.getState().logs).toHaveLength(2);
    expect(dayTotals(useStore.getState().logs, today).minutes).toBe(1);
  });
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

it("keeps Study and its linked habit aligned with automatic card time and replacements", () => {
  useStore.setState({ activeDayKey: today });
  useStore.getState().updateProductivityTracker("tracker-study", { dailyTarget: 2, contributesToHabitTracking: true });
  const tracker = useStore.getState().productivityTrackers.find((item) => item.id === "tracker-study")!;
  const activity = event({ durationSeconds: 120 });
  useStore.getState().recordStudyActivity(activity);
  expect(useStore.getState().logs[0].trackerId).toBe(tracker.id);
  expect(summarizeTracker(tracker, useStore.getState().logs, today).today).toBe(2);
  expect(useStore.getState().habitEntries.find((entry) => entry.habitId === tracker.linkedHabitId && entry.date === today)?.status).toBe("done");
  useStore.getState().recordStudyActivity({ ...activity, durationSeconds: 0 }, true);
  expect(useStore.getState().habitEntries.find((entry) => entry.habitId === tracker.linkedHabitId && entry.date === today)).toBeUndefined();
});

it("does not reschedule or recount a replayed card after the recent-review list is compacted", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
  useStore.getState().addAnkiCards([{ type: "basic", front: "Front", back: "Back" }]);
  const card = useStore.getState().ankiCards[0];
  useStore.getState().reviewAnkiCard(card.id, "good", 60000, "durable-review");
  const schedule = useStore.getState().ankiCards[0].schedule;
  useStore.setState({ cardReviews: [] });
  useStore.getState().reviewAnkiCard(card.id, "good", 60000, "durable-review");
  expect(useStore.getState().ankiCards[0].schedule).toEqual(schedule);
  expect(studyActivityTotals(useStore.getState().logs, today).cards).toBe(1);
});

it("commits subminute free-focus sessions and their activity atomically", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(timestamp(12)));
  useStore.setState({ activeDayKey: today });
  for (let i = 0; i < 2; i++) {
    const id = useStore.getState().startSession({ title: "Read", link: { kind: "free", label: "Read" }, source: "manual" });
    vi.setSystemTime(Date.now() + 30_000);
    const changes: Array<{ status: string | undefined; events: number }> = [];
    const stop = useStore.subscribe((state) => changes.push({ status: state.sessions.find((session) => session.id === id)?.status, events: state.logs.filter((log) => log.activity?.eventId === `session:${id}`).length }));
    useStore.getState().completeSession(id, { outcome: "completed" });
    stop();
    expect(changes).toEqual([{ status: "completed", events: 1 }]);
    useStore.getState().completeSession(id, { outcome: "completed" });
  }
  expect(dayTotals(useStore.getState().logs, today).minutes).toBe(1);
});
