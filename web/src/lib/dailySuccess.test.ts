import { describe, expect, it } from "vitest";
import { evaluateDailySuccess, makeDailyRequirement, normalizeDailySuccessConfig, type DailySuccessState } from "./dailySuccess";
import type { DailySuccessRequirement, Habit, HabitEntry, StudyLog } from "./types";

const TODAY = "2026-07-12";

function requirement(partial: Partial<DailySuccessRequirement> = {}): DailySuccessRequirement {
  const base = makeDailyRequirement({
    id: "minutes",
    label: "Focused study",
    source: { kind: "study-minutes" },
    target: 60,
    unit: "minutes",
    trackingStartsAt: TODAY,
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
  }, TODAY);
  return { ...base, ...partial };
}

function state(requirements: DailySuccessRequirement[] | undefined, logs: StudyLog[] = []): DailySuccessState {
  return {
    profile: {
      name: "Test",
      userId: "test",
      versionLabel: "test",
      tagline: "",
      dailyCardTarget: 120,
      dailyMinuteTarget: 240,
      onboarded: true,
      focusSubscriptions: [],
      ...(requirements === undefined ? {} : {
        dailySuccess: { version: 1, configuredAt: TODAY, requirements },
      }),
    },
    logs,
    productivityTrackers: [],
    habits: [],
    habitEntries: [],
    closeouts: [],
    activeDayKey: TODAY,
  };
}

function log(partial: Partial<StudyLog>): StudyLog {
  return {
    id: partial.id ?? crypto.randomUUID(),
    dayKey: TODAY,
    ts: "2026-07-12T12:00:00.000Z",
    type: "Study",
    minutes: 0,
    cards: 0,
    ...partial,
  };
}

describe("mixed daily and weekly cadence boundaries", () => {
  it("never lowers a daily academic score because a flexible weekly gym quota is still open", () => {
    const dailyStudy = requirement({ id: "study", source: { kind: "study-minutes" }, target: 60 });
    const gym = requirement({
      id: "gym", label: "Gym", source: { kind: "habit", habitId: "gym1" },
      target: 1, unit: "visit", schedule: { kind: "times-per-week", times: 4, weekStartsOn: 1 },
      trackingStartsAt: "2026-07-06",
    });
    const snapshot = state([dailyStudy, gym], [log({ minutes: 60 })]);
    snapshot.habits = [{ id: "gym1", name: "Gym", type: "weekly", weeklyTarget: 4,
      createdAt: "2026-07-06T12:00:00.000Z", updatedAt: "2026-07-06T12:00:00.000Z" }];
    expect(evaluateDailySuccess(snapshot)).toMatchObject({ eligibleCount: 1, progress: 100, status: "met" });
    expect(evaluateDailySuccess(state([gym])).eligibleCount).toBe(0);
  });
});

describe("daily success", () => {
  it("keeps a configured day neutral when no requirement is selected", () => {
    const result = evaluateDailySuccess(state([]));
    expect(result.mode).toBe("configured");
    expect(result.status).toBe("neutral");
    expect(result.statusLabel).toBe("No requirements selected");
  });

  it("does not call a blank current day a failure", () => {
    const result = evaluateDailySuccess(state([requirement()]));
    expect(result.status).toBe("neutral");
    expect(result.requirements[0].status).toBe("awaiting");
    expect(result.statusLabel).toBe("Awaiting first activity");
  });

  it("evaluates only enabled, eligible requirements", () => {
    const future = requirement({ id: "future", trackingStartsAt: "2026-07-13" });
    const disabled = requirement({ id: "disabled", enabled: false });
    const active = requirement({ id: "active", target: 30 });
    const result = evaluateDailySuccess(state([future, disabled, active], [log({ minutes: 15 })]));
    expect(result.eligibleCount).toBe(1);
    expect(result.progress).toBe(50);
    expect(result.requirements.map((item) => item.status)).toEqual(["not-eligible", "not-eligible", "in-progress"]);
  });

  it("weights aggregate progress while preserving each target's native ratio", () => {
    const primary = requirement({ id: "primary", target: 30, weight: 3 });
    const secondary = requirement({ id: "secondary", target: 30, weight: 1, source: { kind: "practice-questions" }, unit: "questions" });
    const result = evaluateDailySuccess(state([primary, secondary], [log({ minutes: 30 })]));
    expect(result.progress).toBe(75);
    expect(result.requirements.map((item) => ({ ratio: item.ratio, weight: item.requirement.weight }))).toEqual([
      { ratio: 1, weight: 3 },
      { ratio: 0, weight: 1 },
    ]);
  });

  it("evaluates a manual-only target without requiring a habit or tracker", () => {
    const manual = requirement({
      id: "manual-target",
      source: { kind: "manual" },
      target: 1,
      unit: "check-in",
      manualContributions: [{
        id: "manual-complete",
        requirementId: "manual-target",
        dayKey: TODAY,
        value: 1,
        mode: "override",
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
      }],
    });
    const result = evaluateDailySuccess(state([manual]));
    expect(result.requirements[0]).toMatchObject({ current: 1, ratio: 1, status: "met" });
    expect(result.requirements[0].sourceLabel).toBe("Manual check-in");
  });

  it("keeps an alias-only activity target available and neutral until an exact alias contributes", () => {
    const activity = requirement({
      id: "reading-pages",
      source: { kind: "activity-alias" },
      target: 10,
      unit: "pages",
      aliases: [],
    });
    const empty = evaluateDailySuccess(state([activity], [log({ type: "Reading", quantity: 10, quantityLabel: "Pages" })]));
    expect(empty.requirements[0]).toMatchObject({ status: "awaiting", current: 0 });
    expect(empty.requirements[0].sourceLabel).toBe("Matched activity");

    const matched = evaluateDailySuccess(state([{ ...activity, aliases: ["Reading"] }], [
      log({ id: "reading-log", type: "reading", quantity: 10, quantityLabel: "Pages" }),
    ]));
    expect(matched.requirements[0]).toMatchObject({ status: "met", current: 10 });
    expect(matched.requirements[0].sourceRecordIds).toEqual(["reading-log"]);
  });

  it("supports selected weekdays without creating off-day misses", () => {
    const weekdays = requirement({ schedule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } });
    const result = evaluateDailySuccess(state([weekdays])); // Sunday
    expect(result.eligibleCount).toBe(0);
    expect(result.requirements[0].status).toBe("not-eligible");
    expect(result.statusLabel).toBe("No requirements scheduled today");
  });

  it("distinguishes an unavailable selected source from an explicit empty configuration", () => {
    const linked = requirement({ source: { kind: "habit", habitId: "removed" } });
    expect(evaluateDailySuccess(state([linked])).statusLabel).toBe("Requirement source unavailable");
    expect(evaluateDailySuccess(state([])).statusLabel).toBe("No requirements selected");
  });

  it("counts practice-question quantities independently from cards", () => {
    const questions = requirement({
      id: "questions",
      label: "Practice questions",
      source: { kind: "practice-questions" },
      target: 30,
      unit: "questions",
    });
    const result = evaluateDailySuccess(state([questions], [
      log({ quantityKind: "questions", quantity: 20, type: "Question block" }),
      log({ cards: 100, quantityKind: "cards", quantity: 100, type: "Anki" }),
    ]));
    expect(result.requirements[0].current).toBe(20);
    expect(result.progress).toBe(67);
  });

  it("nets signed minute and card corrections before clamping observations", () => {
    const cards = requirement({
      id: "cards",
      source: { kind: "cards-reviewed" },
      target: 100,
      unit: "cards",
    });
    const current = state([requirement(), cards], [
      log({ id: "minutes-add", minutes: 60 }),
      log({ id: "minutes-correction", minutes: -30 }),
      log({ id: "cards-add", cards: 100, type: "Cards" }),
      log({ id: "cards-correction", cards: -60, type: "Cards correction" }),
    ]);
    const result = evaluateDailySuccess(current);
    expect(result.requirements[0]).toMatchObject({ current: 30, status: "in-progress" });
    expect(result.requirements[0].sourceRecordIds).toEqual(["minutes-add", "minutes-correction"]);
    expect(result.requirements[1]).toMatchObject({ current: 40, status: "in-progress" });
    expect(result.requirements[1].sourceRecordIds).toEqual(["cards-add", "cards-correction"]);
  });

  it("nets modern card quantities while retaining legacy card fallback", () => {
    const cards = requirement({
      id: "cards",
      source: { kind: "cards-reviewed" },
      target: 100,
      unit: "cards",
    });
    const result = evaluateDailySuccess(state([cards], [
      log({ id: "modern-add", cards: 80, quantity: 80, quantityKind: "cards" }),
      log({ id: "modern-correction", cards: -25, quantity: -25, quantityKind: "cards" }),
      log({ id: "legacy-add", cards: 20 }),
    ]));
    expect(result.requirements[0]).toMatchObject({ current: 75, status: "in-progress" });
    expect(result.requirements[0].sourceRecordIds).toEqual(["modern-add", "modern-correction", "legacy-add"]);
  });

  it("evaluates exact activity aliases through the canonical contribution ledger", () => {
    const questions = requirement({
      id: "questions",
      label: "Practice questions",
      source: { kind: "practice-questions" },
      target: 20,
      unit: "questions",
      aliases: ["UWorld block"],
    });
    const result = evaluateDailySuccess(state([questions], [
      log({ id: "alias-log", type: "uworld—BLOCK", quantity: 20, quantityKind: "count" }),
      log({ id: "weak-match", type: "UWorld block notes", quantity: 50, quantityKind: "count" }),
    ]));
    expect(result.requirements[0]).toMatchObject({ current: 20, status: "met" });
    expect(result.requirements[0].sourceRecordIds).toEqual(["alias-log"]);
    expect(result.requirements[0].contributions[0]).toMatchObject({ matchedBy: "alias", unit: "questions" });
  });

  it("honors an explicit per-day manual override while retaining source provenance", () => {
    const minutes = requirement({
      manualContributions: [{
        id: "manual-value",
        requirementId: "minutes",
        dayKey: TODAY,
        value: 25,
        unit: "minutes",
        mode: "override",
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
      }],
    });
    const result = evaluateDailySuccess(state([minutes], [log({ id: "derived", minutes: 60 })]));
    expect(result.requirements[0]).toMatchObject({ current: 25, status: "in-progress" });
    expect(result.requirements[0].sourceRecordIds).toEqual(["derived", "manual-value"]);
    expect(result.requirements[0].contributions.find((row) => row.manualOverride)).toMatchObject({
      sourceRecordId: "manual-value",
      value: 25,
    });
  });

  it("counts linked and aliased activity once per eligible day for a weekly schedule", () => {
    const weekly = requirement({
      id: "weekly-questions",
      label: "Question blocks",
      source: { kind: "practice-questions" },
      target: 10,
      unit: "questions",
      aliases: ["Amboss block"],
      schedule: { kind: "times-per-week", times: 3, weekStartsOn: 1 },
      trackingStartsAt: "2026-07-06",
    });
    const result = evaluateDailySuccess(state([weekly], [
      log({ id: "monday", dayKey: "2026-07-06", quantity: 10, quantityKind: "questions" }),
      log({ id: "tuesday", dayKey: "2026-07-07", type: "Amboss block", quantity: 10, quantityKind: "count" }),
      log({ id: "wednesday", dayKey: "2026-07-08", quantity: 10, quantityKind: "questions" }),
    ]));
    expect(result.requirements[0]).toMatchObject({ current: 3, target: 3, status: "met" });
    expect(result.requirements[0].sourceRecordIds).toEqual(["monday", "tuesday", "wednesday"]);
    expect(new Set(result.requirements[0].contributions.map((row) => row.dayKey))).toEqual(new Set([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]));
  });

  it("handles a weekly habit fairly and never backfills before creation", () => {
    const weekly = requirement({
      id: "gym",
      label: "Gym",
      source: { kind: "habit", habitId: "gym-habit" },
      target: 1,
      unit: "visit",
      schedule: { kind: "times-per-week", times: 4, weekStartsOn: 1 },
      trackingStartsAt: "2026-07-08",
    });
    const habit: Habit = {
      id: "gym-habit",
      name: "Gym",
      type: "weekly",
      weeklyTarget: 4,
      createdAt: "2026-07-08T12:00:00.000Z",
      updatedAt: "2026-07-08T12:00:00.000Z",
    };
    const entries: HabitEntry[] = ["2026-07-08", "2026-07-09", "2026-07-11"].map((date, index) => ({
      id: `entry-${index}`,
      habitId: habit.id,
      date,
      status: "done",
      createdAt: `${date}T12:00:00.000Z`,
    }));
    const current = state([weekly]);
    current.habits = [habit];
    current.habitEntries = entries;
    expect(evaluateDailySuccess(current).requirements[0]).toMatchObject({ current: 3, target: 4, status: "in-progress" });
    expect(evaluateDailySuccess(current, "2026-07-07").requirements[0].status).toBe("not-eligible");
  });

  it("prorates a newly-created weekly quota to the opportunities left in its first week", () => {
    const weekly = requirement({
      id: "new-gym",
      source: { kind: "habit", habitId: "new-gym-habit" },
      target: 1,
      unit: "visit",
      schedule: { kind: "times-per-week", times: 4, weekStartsOn: 1 },
      trackingStartsAt: "2026-07-11", // Saturday, two days remain in a Mon–Sun week
    });
    const current = state([weekly]);
    current.habits = [{
      id: "new-gym-habit", name: "Gym", type: "weekly", weeklyTarget: 4,
      createdAt: "2026-07-11T12:00:00.000Z", updatedAt: "2026-07-11T12:00:00.000Z",
    }];
    current.habitEntries = ["2026-07-11", TODAY].map((date, index) => ({
      id: `new-entry-${index}`, habitId: "new-gym-habit", date, status: "done", createdAt: `${date}T12:00:00.000Z`,
    }));
    expect(evaluateDailySuccess(current).requirements[0]).toMatchObject({ current: 2, target: 2, status: "met" });
  });

  it("scores a weekly quota once at the historical week boundary, not on every prior day", () => {
    const weekly = requirement({
      id: "weekly-reading",
      source: { kind: "habit", habitId: "reading-habit" },
      target: 1,
      unit: "session",
      schedule: { kind: "times-per-week", times: 2, weekStartsOn: 1 },
      trackingStartsAt: "2026-06-29",
    });
    const current = state([weekly]);
    current.habits = [{ id: "reading-habit", name: "Reading", type: "weekly", weeklyTarget: 2, createdAt: "2026-06-29T12:00:00.000Z", updatedAt: "2026-06-29T12:00:00.000Z" }];
    current.habitEntries = ["2026-06-30", "2026-07-03"].map((date, index) => ({ id: `read-${index}`, habitId: "reading-habit", date, status: "done", createdAt: `${date}T12:00:00.000Z` }));

    expect(evaluateDailySuccess(current, "2026-07-01", TODAY).requirements[0].status).toBe("not-eligible");
    expect(evaluateDailySuccess(current, "2026-07-05", TODAY).requirements[0]).toMatchObject({ eligible: true, current: 2, target: 2, status: "met" });
  });

  it("reports removed linked sources as unavailable without deleting history", () => {
    const linked = requirement({ source: { kind: "habit", habitId: "removed" } });
    const current = state([linked]);
    current.habitEntries = [{
      id: "preserved",
      habitId: "removed",
      date: TODAY,
      status: "done",
      createdAt: "2026-07-12T12:00:00.000Z",
    }];
    const result = evaluateDailySuccess(current);
    expect(result.requirements[0].status).toBe("unavailable");
    expect(current.habitEntries).toHaveLength(1);
  });

  it("preserves the legacy adapter when configuration is absent", () => {
    const result = evaluateDailySuccess(state(undefined, [log({ minutes: 240 })]));
    expect(result.mode).toBe("legacy");
    expect(result.requirements.map((item) => item.requirement.id)).toEqual([
      "legacy-study-minutes",
      "legacy-cards-reviewed",
    ]);
    expect(result.progress).toBe(50);
  });

  it("does not invent a legacy miss when a no-log workspace views a historical day", () => {
    const result = evaluateDailySuccess(state(undefined), "2026-07-11", TODAY);
    expect(result.mode).toBe("legacy");
    expect(result.status).toBe("neutral");
    expect(result.eligibleCount).toBe(0);
    expect(result.requirements.every((item) => item.status === "not-eligible")).toBe(true);
  });

  it("normalizes malformed values without NaN, negatives, or duplicate IDs", () => {
    const normalized = normalizeDailySuccessConfig({
      version: 1,
      configuredAt: TODAY,
      requirements: [
        { ...requirement(), target: Number.NaN },
        { ...requirement(), target: -10 },
      ],
    });
    expect(normalized?.requirements).toHaveLength(1);
    expect(normalized?.requirements[0].target).toBe(1);
    expect(Number.isFinite(normalized?.requirements[0].target)).toBe(true);
  });

  it("normalizes additive aliases and manual corrections without a schema bump", () => {
    const normalized = normalizeDailySuccessConfig({
      version: 1,
      configuredAt: TODAY,
      requirements: [{
        ...requirement(),
        weight: 99,
        aliases: [" UWorld  block ", "uworld-block", "", 10],
        manualContributions: [
          { id: "manual", requirementId: "wrong-target", dayKey: TODAY, value: -5, unit: " minutes ", mode: "add", createdAt: "bad", updatedAt: "2026-07-12T13:00:00.000Z" },
          { id: "manual", requirementId: "minutes", dayKey: TODAY, value: 50, mode: "override" },
          { id: "invalid", requirementId: "minutes", dayKey: "not-a-day", value: Number.NaN, mode: "override" },
        ],
      }],
    });
    expect(normalized?.version).toBe(1);
    expect(normalized?.requirements[0].weight).toBe(5);
    expect(normalized?.requirements[0].aliases).toEqual(["UWorld block"]);
    expect(normalized?.requirements[0].manualContributions).toHaveLength(1);
    expect(normalized?.requirements[0].manualContributions?.[0]).toMatchObject({
      id: "manual",
      requirementId: "minutes",
      dayKey: TODAY,
      value: -5,
      unit: "minutes",
      mode: "add",
    });
  });

  it("defaults invalid weights to one and preserves the manual source", () => {
    const normalized = normalizeDailySuccessConfig({
      version: 1,
      configuredAt: TODAY,
      requirements: [
        { ...requirement({ id: "negative", weight: undefined }), weight: -4 },
        { ...requirement({ id: "not-finite", weight: undefined }), weight: Number.NaN },
        { ...requirement({ id: "manual-source", source: { kind: "manual" }, weight: undefined }), weight: 0.01 },
        { ...requirement({ id: "activity-source", source: { kind: "activity-alias" }, aliases: ["Reading"], weight: undefined }), weight: 1 },
      ],
    });
    expect(normalized?.requirements.map((item) => item.weight)).toEqual([1, 1, 0.1, 1]);
    expect(normalized?.requirements[2].source).toEqual({ kind: "manual" });
    expect(normalized?.requirements[3].source).toEqual({ kind: "activity-alias" });
  });
});
