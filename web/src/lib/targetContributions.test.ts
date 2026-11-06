import { describe, expect, it } from "vitest";
import { buildTargetContributionLedger, canonicalStudyLogs, normalizeTargetUnit } from "./targetContributions";
import { makeDailyRequirement } from "./dailySuccess";
import type {
  DailySuccessManualContribution,
  DailySuccessRequirement,
  Habit,
  HabitEntry,
  ProductivityTracker,
  StudyLog,
} from "./types";

const DAY = "2026-07-13";
const CREATED = "2026-07-13T08:00:00.000Z";

function requirement(partial: Partial<DailySuccessRequirement> = {}): DailySuccessRequirement {
  return {
    ...makeDailyRequirement({
      id: "questions",
      label: "Practice questions",
      source: { kind: "practice-questions" },
      target: 20,
      unit: "questions",
      trackingStartsAt: DAY,
      createdAt: CREATED,
      updatedAt: CREATED,
    }, DAY),
    ...partial,
  };
}

function log(partial: Partial<StudyLog>): StudyLog {
  return {
    id: partial.id ?? crypto.randomUUID(),
    dayKey: DAY,
    ts: CREATED,
    type: "Study",
    minutes: 0,
    cards: 0,
    ...partial,
  };
}

function tracker(partial: Partial<ProductivityTracker> = {}): ProductivityTracker {
  return {
    id: "tracker-1",
    name: "Question blocks",
    icon: "ListChecks",
    color: "blue",
    unitType: "count",
    category: "Academic",
    contributesToAcademicStudy: true,
    contributesToTotalProductiveTime: true,
    contributesToEnergy: true,
    contributesToReports: true,
    contributesToHabitTracking: true,
    visible: true,
    archived: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...partial,
  };
}

function ledger(input: {
  requirement?: DailySuccessRequirement;
  logs?: StudyLog[];
  trackers?: ProductivityTracker[];
  habits?: Habit[];
  habitEntries?: HabitEntry[];
}) {
  return buildTargetContributionLedger({
    requirement: input.requirement ?? requirement(),
    dayKey: DAY,
    logs: input.logs ?? [],
    productivityTrackers: input.trackers ?? [],
    habits: input.habits ?? [],
    habitEntries: input.habitEntries ?? [],
    closeouts: [],
  });
}

describe("target contribution ledger", () => {
  it("records event, source, target, native unit, dedupe, confidence, and match provenance", () => {
    const target = requirement({ aliases: ["Q-Bank block"] });
    const result = ledger({
      requirement: target,
      logs: [
        log({ id: "native", type: "Q-Bank block", quantity: 12, quantityKind: "questions" }),
        log({ id: "alias", type: "q bank BLOCK!", quantity: 5, quantityKind: "count" }),
      ],
    });

    expect(result.value).toBe(17);
    expect(result.unit).toBe("questions");
    expect(result.contributions).toHaveLength(2);
    expect(result.contributions.find((row) => row.sourceRecordId === "native")).toMatchObject({
      event: "activity",
      eventId: "native",
      sourceRecord: "study-log",
      targetId: "questions",
      dayKey: DAY,
      matchedBy: "native",
      confidence: 0.99,
      manualOverride: false,
    });
    expect(result.contributions.find((row) => row.sourceRecordId === "alias")).toMatchObject({
      value: 5,
      matchedBy: "alias",
      confidence: 0.8,
    });
    expect(new Set(result.contributions.map((row) => row.dedupeKey)).size).toBe(2);
  });

  it("uses exact normalized aliases without weak substring matches", () => {
    const target = requirement({ source: { kind: "activity-alias" }, aliases: ["UWorld—block"] });
    const result = ledger({
      requirement: target,
      logs: [
        log({ id: "exact", type: "uworld block", quantity: 10, quantityKind: "count" }),
        log({ id: "substring", type: "UWorld block review later", quantity: 99, quantityKind: "count" }),
      ],
    });
    expect(result.value).toBe(10);
    expect(result.sourceRecordIds).toEqual(["exact"]);
    expect(result.contributions[0]).toMatchObject({ matchedBy: "alias", unit: "questions" });
  });

  it("counts a duration-only matched activity once for an occurrence target", () => {
    const target = requirement({
      id: "gym",
      source: { kind: "activity-alias" },
      aliases: ["Gym"],
      target: 1,
      unit: "times",
    });
    const result = ledger({ requirement: target, logs: [log({ id: "gym-log", type: "gym", minutes: 45 })] });
    expect(result.value).toBe(1);
    expect(result.contributions[0]).toMatchObject({ sourceRecordId: "gym-log", value: 1, unit: "count" });
  });

  it("keeps native units separate unless an explicit alias supplies semantics", () => {
    const noAlias = ledger({
      logs: [log({ id: "cards", cards: 40, quantity: 40, quantityKind: "cards", type: "Anki" })],
    });
    expect(noAlias.value).toBe(0);

    const explicitAlias = ledger({
      requirement: requirement({ aliases: ["Amboss set"] }),
      logs: [log({ id: "generic", quantity: 16, quantityKind: "count", type: "AMBOSS SET" })],
    });
    expect(explicitAlias.value).toBe(16);
    expect(explicitAlias.contributions[0]).toMatchObject({ unit: "questions", matchedBy: "alias" });
  });

  it("nets signed question corrections in the question unit", () => {
    const result = ledger({
      logs: [
        log({ id: "questions-add", quantity: 20, quantityKind: "questions" }),
        log({ id: "questions-correction", quantity: -5, quantityKind: "questions" }),
      ],
    });
    expect(result.value).toBe(15);
    expect(result.contributions.find((row) => row.sourceRecordId === "questions-correction")).toMatchObject({
      value: -5,
      unit: "questions",
      correction: true,
    });
  });

  it("deduplicates repeated records and nets signed corrections without negative totals", () => {
    const target = requirement({ source: { kind: "study-minutes" }, unit: "minutes", target: 30 });
    const logs = [
      log({ id: "same", ts: "2026-07-13T08:00:00.000Z", minutes: 30 }),
      log({ id: "same", ts: "2026-07-13T09:00:00.000Z", minutes: 20 }),
      log({ id: "correction", ts: "2026-07-13T10:00:00.000Z", minutes: -25 }),
    ];
    const result = ledger({ requirement: target, logs });
    expect(result.value).toBe(0);
    expect(result.sourceRecordIds).toEqual(["same", "correction"]);
    expect(result.contributions.find((row) => row.sourceRecordId === "correction")?.correction).toBe(true);
    expect(result.contributions.find((row) => row.sourceRecordId === "same")?.value).toBe(20);
    const reordered = buildTargetContributionLedger({
      requirement: target,
      dayKey: DAY,
      logs: [...logs].reverse(),
      productivityTrackers: [],
      habits: [],
      habitEntries: [],
      closeouts: [],
    });
    expect(reordered.value).toBe(result.value);
    expect(reordered.contributions).toEqual(result.contributions);
    expect(new Set(reordered.sourceRecordIds)).toEqual(new Set(result.sourceRecordIds));
  });

  it("prefers a native tracker link over an alias and never double-counts the same event", () => {
    const target = requirement({
      source: { kind: "productivity-tracker", trackerId: "tracker-1" },
      aliases: ["Question blocks"],
      unit: "questions",
    });
    const result = ledger({
      requirement: target,
      trackers: [tracker()],
      logs: [log({ id: "linked", trackerId: "tracker-1", type: "Question blocks", quantity: 18, quantityKind: "count" })],
    });
    expect(result.value).toBe(18);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ matchedBy: "linked", confidence: 1 });
  });

  it("remembers an explicit undo without deleting the source activity", () => {
    const source = log({ id: "workout-log", type: "Workout", quantity: 1, quantityKind: "count" });
    const target = requirement({
      source: { kind: "activity-alias" },
      aliases: ["Workout"],
      unit: "times",
      excludedSourceRecordIds: [source.id],
    });
    const result = ledger({ requirement: target, logs: [source] });
    expect(result.value).toBe(0);
    expect(result.contributions).toHaveLength(0);
    expect(source.type).toBe("Workout");
  });

  it("reassigns a source activity deterministically without double-counting it", () => {
    const source = log({ id: "pages-log", type: "Reading", quantity: 12, quantityKind: "count", quantityLabel: "pages" });
    const target = requirement({
      id: "reading-target",
      source: { kind: "manual" },
      unit: "pages",
      includedSourceRecordIds: [source.id, source.id],
    });
    const result = ledger({ requirement: target, logs: [source, source] });
    expect(result.value).toBe(12);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({
      sourceRecordId: source.id,
      matchedBy: "reassigned",
      confidence: 1,
      value: 12,
      unit: "pages",
    });
  });

  it("treats the latest habit check as a correction instead of summing duplicate day records", () => {
    const target = requirement({
      id: "reading",
      source: { kind: "habit", habitId: "reading-habit" },
      unit: "sessions",
    });
    const habit: Habit = {
      id: "reading-habit",
      name: "Reading",
      type: "binary",
      createdAt: CREATED,
      updatedAt: CREATED,
    };
    const result = ledger({
      requirement: target,
      habits: [habit],
      habitEntries: [
        { id: "done", habitId: habit.id, date: DAY, status: "done", createdAt: "2026-07-13T08:00:00.000Z" },
        { id: "skip", habitId: habit.id, date: DAY, status: "skipped", createdAt: "2026-07-13T09:00:00.000Z" },
      ],
    });
    expect(result.value).toBe(0);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ sourceRecordId: "skip", value: 0, correction: true });
  });

  it("applies signed manual corrections and lets the latest explicit override win", () => {
    const manuals: DailySuccessManualContribution[] = [
      { id: "add", requirementId: "minutes", dayKey: DAY, value: -10, unit: "minutes", mode: "add", createdAt: CREATED, updatedAt: CREATED },
      { id: "older-override", requirementId: "minutes", dayKey: DAY, value: 35, unit: "minutes", mode: "override", createdAt: CREATED, updatedAt: "2026-07-13T09:00:00.000Z" },
      { id: "latest-override", requirementId: "minutes", dayKey: DAY, value: 25, unit: "minutes", mode: "override", createdAt: CREATED, updatedAt: "2026-07-13T10:00:00.000Z" },
      { id: "wrong-unit", requirementId: "minutes", dayKey: DAY, value: 999, unit: "cards", mode: "override", createdAt: CREATED, updatedAt: "2026-07-13T11:00:00.000Z" },
    ];
    const target = requirement({
      id: "minutes",
      source: { kind: "study-minutes" },
      unit: "minutes",
      manualContributions: manuals,
    });
    const result = ledger({ requirement: target, logs: [log({ id: "study", minutes: 60 })] });
    expect(result.value).toBe(25);
    expect(result.manualOverrideId).toBe("latest-override");
    expect(result.contributions.find((row) => row.sourceRecordId === "add")).toMatchObject({
      value: -10,
      correction: true,
      manualOverride: false,
    });
    expect(result.contributions.find((row) => row.sourceRecordId === "latest-override")).toMatchObject({
      value: 25,
      manualOverride: true,
    });
    expect(result.sourceRecordIds).not.toContain("wrong-unit");
    expect(result.sourceRecordIds).not.toContain("older-override");
  });

  it("keeps a manual-only target independent from activity and habit engines", () => {
    const target = requirement({
      id: "manual-target",
      source: { kind: "manual" },
      unit: "pages",
      aliases: ["Reading"],
      manualContributions: [{
        id: "manual-pages",
        requirementId: "manual-target",
        dayKey: DAY,
        value: 12,
        unit: "pages",
        mode: "override",
        createdAt: CREATED,
        updatedAt: CREATED,
      }],
    });
    const result = ledger({
      requirement: target,
      logs: [log({ id: "must-not-link", type: "Reading", quantity: 100, quantityLabel: "Pages" })],
    });
    expect(result.value).toBe(12);
    expect(result.unit).toBe("pages");
    expect(result.sourceRecordIds).toEqual(["manual-pages"]);
    expect(result.contributions[0]).toMatchObject({
      event: "manual-adjustment",
      matchedBy: "manual",
      manualOverride: true,
    });
  });

  it.each([
    ["min", "minutes"],
    ["Practice Questions", "questions"],
    ["visits", "count"],
    ["reps", "repetitions"],
  ])("normalizes %s to its native unit", (input, expected) => {
    expect(normalizeTargetUnit(input)).toBe(expected);
  });
});


describe("canonical study logs", () => {
  it("resolves identities globally before filtering by day and never mutates inputs", () => {
    const old = log({ id: "same", dayKey: DAY, quantity: 20, quantityKind: "questions" });
    const latest = log({ id: "same", dayKey: "2026-07-14", ts: "2026-07-14T08:00:00Z", quantity: 10, quantityKind: "questions" });
    const input = [latest, old];
    expect(ledger({ logs: input }).value).toBe(0);
    expect(canonicalStudyLogs(input)).toEqual([latest]);
    expect(input).toEqual([latest, old]);
  });
  it("orders timestamp offsets by actual time", () => {
    const earlier = log({ id: "same", ts: "2026-07-13T10:00:00-05:00", minutes: 10 });
    const later = log({ id: "same", ts: "2026-07-13T16:00:00Z", minutes: 20 });
    expect(canonicalStudyLogs([later, earlier])).toEqual([later]);
  });
  it("uses deterministic accounting fields including day for equal timestamps", () => {
    const a = log({ id: "same", dayKey: DAY });
    const b = log({ id: "same", dayKey: "2026-07-14" });
    expect(canonicalStudyLogs([a, b])).toEqual(canonicalStudyLogs([b, a]));
    expect(canonicalStudyLogs([a, b])).toEqual([b]);
  });
});
