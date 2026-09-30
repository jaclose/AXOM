import type {
  DailySuccessManualContribution,
  DailySuccessRequirement,
  Habit,
  HabitEntry,
  ProductivityTracker,
  StudyLog,
} from "./types";
import type { DailyCloseout } from "./closeout";

export type TargetContributionEvent = "activity" | "habit-check" | "closeout" | "manual-adjustment";
export type TargetContributionRecord = "study-log" | "habit-entry" | "daily-closeout" | "manual-contribution";
export type TargetContributionMatch = "native" | "linked" | "alias" | "manual" | "reassigned";

/**
 * One inspectable fact used to evaluate a target. The row always points back
 * to its source record, and its dedupe key makes repeated imports idempotent.
 */
export interface TargetContribution {
  event: TargetContributionEvent;
  eventId: string;
  sourceRecord: TargetContributionRecord;
  sourceRecordId: string;
  targetId: string;
  value: number;
  unit: string;
  dayKey: string;
  dedupeKey: string;
  confidence: number;
  manualOverride: boolean;
  correction: boolean;
  matchedBy: TargetContributionMatch;
}

export interface TargetContributionLedger {
  targetId: string;
  dayKey: string;
  unit: string;
  contributions: TargetContribution[];
  value: number;
  sourceRecordIds: string[];
  manualOverrideId?: string;
}

export interface TargetContributionInput {
  requirement: DailySuccessRequirement;
  dayKey: string;
  logs: StudyLog[];
  productivityTrackers: ProductivityTracker[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  closeouts: DailyCloseout[];
}

/**
 * Build the single contribution ledger used by daily and weekly target
 * evaluation. It is pure: source engines remain authoritative and no records
 * are written or repaired here.
 */
export function buildTargetContributionLedger(input: TargetContributionInput): TargetContributionLedger {
  const { requirement, dayKey } = input;
  const unit = targetUnit(requirement, input.productivityTrackers, input.habits);
  const rows = new Map<string, TargetContribution>();
  const logs = canonicalLogs(input.logs.filter((log) => log.dayKey === dayKey));
  const excluded = new Set(requirement.excludedSourceRecordIds ?? []);
  const included = new Set(requirement.includedSourceRecordIds ?? []);

  for (const log of logs) {
    if (excluded.has(log.id)) continue;
    const native = nativeLogValue(requirement, log, unit, input.productivityTrackers);
    if (native !== undefined && native !== 0) {
      put(rows, contribution({
        requirement,
        dayKey,
        unit,
        event: "activity",
        eventId: log.id,
        sourceRecord: "study-log",
        sourceRecordId: log.id,
        value: native,
        matchedBy: requirement.source.kind === "productivity-tracker" ? "linked" : "native",
        confidence: requirement.source.kind === "productivity-tracker" ? 1 : 0.99,
      }));
    }
  }

  const aliases = requirement.source.kind === "manual"
    ? new Set<string>()
    : new Set((requirement.aliases ?? []).map(normalizeLabel).filter(Boolean));
  if (aliases.size) {
    for (const log of logs) {
      if (excluded.has(log.id)) continue;
      if (!logMatchesAlias(log, aliases)) continue;
      const value = valueInUnit(log, unit, true);
      if (value === undefined || value === 0) continue;
      put(rows, contribution({
        requirement,
        dayKey,
        unit,
        event: "activity",
        eventId: log.id,
        sourceRecord: "study-log",
        sourceRecordId: log.id,
        value,
        matchedBy: "alias",
        confidence: 0.8,
      }));
    }
  }

  for (const log of logs) {
    if (!included.has(log.id) || excluded.has(log.id)) continue;
    const value = valueInUnit(log, unit, true);
    if (value === undefined || value === 0) continue;
    put(rows, contribution({
      requirement,
      dayKey,
      unit,
      event: "activity",
      eventId: log.id,
      sourceRecord: "study-log",
      sourceRecordId: log.id,
      value,
      matchedBy: "reassigned",
      confidence: 1,
    }));
  }

  if (requirement.source.kind === "habit") {
    const entry = latestHabitEntry(input.habitEntries, requirement.source.habitId, dayKey);
    if (entry) {
      const value = habitValue(entry);
      put(rows, contribution({
        requirement,
        dayKey,
        unit,
        event: "habit-check",
        eventId: entry.id,
        sourceRecord: "habit-entry",
        sourceRecordId: entry.id,
        value,
        matchedBy: "linked",
        confidence: 1,
        dedupeKey: `${requirement.id}:habit:${requirement.source.habitId}:${dayKey}`,
        correction: entry.status === "skipped" || entry.status === "missed",
      }));
    }
  }

  if (requirement.source.kind === "journal-closeout") {
    const closeout = latestCloseout(input.closeouts, dayKey);
    if (closeout) {
      put(rows, contribution({
        requirement,
        dayKey,
        unit,
        event: "closeout",
        eventId: closeout.id,
        sourceRecord: "daily-closeout",
        sourceRecordId: closeout.id,
        value: 1,
        matchedBy: "linked",
        confidence: 1,
        dedupeKey: `${requirement.id}:closeout:${dayKey}`,
      }));
    }
  }

  addManualContributions(rows, requirement, dayKey, unit);

  const contributions = [...rows.values()].sort(compareContributions);
  const override = contributions.find((row) => row.manualOverride);
  const derived = contributions
    .filter((row) => !row.manualOverride)
    .reduce((sum, row) => sum + row.value, 0);
  const value = Math.max(0, finite(override?.value ?? derived));
  return {
    targetId: requirement.id,
    dayKey,
    unit,
    contributions,
    value,
    sourceRecordIds: sourceRecordIdsInStateOrder(contributions, input),
    manualOverrideId: override?.sourceRecordId,
  };
}

function sourceRecordIdsInStateOrder(
  contributions: TargetContribution[],
  input: TargetContributionInput,
): string[] {
  const included = new Set(contributions.map((row) => row.sourceRecordId));
  const orderedCandidates = [
    ...input.logs.filter((record) => record.dayKey === input.dayKey).map((record) => record.id),
    ...input.habitEntries.filter((record) => record.date === input.dayKey).map((record) => record.id),
    ...input.closeouts.filter((record) => record.dayKey === input.dayKey).map((record) => record.id),
    ...(input.requirement.manualContributions ?? [])
      .filter((record) => record.dayKey === input.dayKey)
      .map((record) => record.id),
    ...contributions.map((row) => row.sourceRecordId),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of orderedCandidates) {
    if (!included.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function normalizeTargetUnit(value: string): string {
  const unit = normalizeLabel(value);
  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) return "hours";
  if (["min", "mins", "minute", "minutes"].includes(unit)) return "minutes";
  if (["card", "cards", "review", "reviews"].includes(unit)) return "cards";
  if (["question", "questions", "practice question", "practice questions"].includes(unit)) return "questions";
  if (["page", "pages"].includes(unit)) return "pages";
  if (["rep", "reps", "repetition", "repetitions"].includes(unit)) return "repetitions";
  if (["closeout", "closeouts", "count", "counts", "day", "days", "session", "sessions", "time", "times", "visit", "visits", "yes", "yes no"].includes(unit)) return "count";
  return unit || "count";
}

function targetUnit(
  requirement: DailySuccessRequirement,
  trackers: ProductivityTracker[],
  habits: Habit[],
): string {
  if (requirement.source.kind === "study-minutes") return normalizeTargetUnit(requirement.unit) === "hours" ? "hours" : "minutes";
  if (requirement.source.kind === "cards-reviewed") return "cards";
  if (requirement.source.kind === "practice-questions") return "questions";
  if (requirement.source.kind === "journal-closeout") return "count";
  if (requirement.source.kind === "activity-alias") return normalizeTargetUnit(requirement.unit);
  if (requirement.source.kind === "manual") return normalizeTargetUnit(requirement.unit);
  if (requirement.source.kind === "productivity-tracker") {
    const trackerId = requirement.source.trackerId;
    const tracker = trackers.find((item) => item.id === trackerId);
    return normalizeTargetUnit(requirement.unit || trackerUnit(tracker));
  }
  const habitId = requirement.source.habitId;
  const habit = habits.find((item) => item.id === habitId);
  return normalizeTargetUnit(requirement.unit || habit?.unit || "count");
}

function trackerUnit(tracker: ProductivityTracker | undefined): string {
  if (!tracker) return "count";
  if (tracker.unitType === "minutes") return "minutes";
  if (tracker.unitType === "custom") return tracker.customUnit || "count";
  return tracker.unitType === "yesno" ? "count" : tracker.unitType;
}

function nativeLogValue(
  requirement: DailySuccessRequirement,
  log: StudyLog,
  unit: string,
  trackers: ProductivityTracker[],
): number | undefined {
  if (requirement.source.kind === "study-minutes") {
    return log.academic === false ? undefined : nonZero(unit === "hours" ? log.minutes / 60 : log.minutes);
  }
  if (requirement.source.kind === "cards-reviewed") {
    if (log.quantityKind !== "cards" && finite(log.cards) === 0) return undefined;
    return nonZero(log.quantityKind === "cards" && finite(log.quantity) !== 0 ? log.quantity : log.cards);
  }
  if (requirement.source.kind === "practice-questions") {
    const semanticQuestions = log.quantityKind === "questions" || normalizeTargetUnit(log.quantityLabel ?? "") === "questions";
    return semanticQuestions ? nonZero(log.quantity) : undefined;
  }
  if (requirement.source.kind !== "productivity-tracker" || log.trackerId !== requirement.source.trackerId) {
    return undefined;
  }
  const trackerId = requirement.source.trackerId;
  const tracker = trackers.find((item) => item.id === trackerId);
  if (tracker?.unitType === "yesno") return nonZero(log.quantity) ?? 1;
  return valueInUnit(log, unit, true);
}

function valueInUnit(log: StudyLog, unit: string, explicitSemanticLink: boolean): number | undefined {
  if (unit === "hours") return nonZero(log.minutes / 60);
  if (unit === "minutes") return nonZero(log.minutes);
  if (unit === "cards") {
    if (log.quantityKind === "cards" && finite(log.quantity) !== 0) return finite(log.quantity);
    if (finite(log.cards) !== 0) return finite(log.cards);
    return explicitSemanticLink ? nonZero(log.quantity) : undefined;
  }
  if (unit === "questions") {
    if (log.quantityKind === "questions" || normalizeTargetUnit(log.quantityLabel ?? "") === "questions") {
      return nonZero(log.quantity);
    }
    return explicitSemanticLink ? nonZero(log.quantity) : undefined;
  }
  if (unit === "pages" || unit === "repetitions") {
    const labelUnit = normalizeTargetUnit(log.quantityLabel ?? "");
    if (labelUnit === unit || explicitSemanticLink) return nonZero(log.quantity);
    return undefined;
  }
  if (unit === "count") {
    if (finite(log.quantity) !== 0) return finite(log.quantity);
    if (explicitSemanticLink && finite(log.minutes) !== 0) return Math.sign(finite(log.minutes));
    if (explicitSemanticLink && finite(log.cards) !== 0) return Math.sign(finite(log.cards));
    if (log.unitType === "yesno") return 1;
    return undefined;
  }
  if (finite(log.quantity) !== 0) return finite(log.quantity);
  if (log.unitType === "yesno") return 1;
  return undefined;
}

function addManualContributions(
  rows: Map<string, TargetContribution>,
  requirement: DailySuccessRequirement,
  dayKey: string,
  unit: string,
) {
  const matching = canonicalManualContributions(requirement.manualContributions ?? [])
    .filter((item) => item.requirementId === requirement.id && item.dayKey === dayKey)
    .map((item) => {
      const sourceUnit = item.unit ? normalizeTargetUnit(item.unit) : unit;
      // Stored adjustments keep their original unit across display-unit changes.
      if (sourceUnit === "minutes" && unit === "hours") return { ...item, value: item.value / 60, unit };
      if (sourceUnit === "hours" && unit === "minutes") return { ...item, value: item.value * 60, unit };
      return item;
    })
    .filter((item) => !item.unit || normalizeTargetUnit(item.unit) === unit);
  const additions = matching.filter((item) => item.mode === "add");
  for (const item of additions) {
    put(rows, contribution({
      requirement,
      dayKey,
      unit,
      event: "manual-adjustment",
      eventId: item.id,
      sourceRecord: "manual-contribution",
      sourceRecordId: item.id,
      value: finite(item.value),
      matchedBy: "manual",
      confidence: 1,
      dedupeKey: `${requirement.id}:manual:add:${item.id}`,
      correction: item.value < 0,
    }));
  }
  const override = matching
    .filter((item) => item.mode === "override")
    .sort(compareManual)
    .at(-1);
  if (!override) return;
  put(rows, contribution({
    requirement,
    dayKey,
    unit,
    event: "manual-adjustment",
    eventId: override.id,
    sourceRecord: "manual-contribution",
    sourceRecordId: override.id,
    value: Math.max(0, finite(override.value)),
    matchedBy: "manual",
    confidence: 1,
    manualOverride: true,
    dedupeKey: `${requirement.id}:manual:override:${dayKey}`,
  }));
}

function contribution(input: {
  requirement: DailySuccessRequirement;
  dayKey: string;
  unit: string;
  event: TargetContributionEvent;
  eventId: string;
  sourceRecord: TargetContributionRecord;
  sourceRecordId: string;
  value: number;
  matchedBy: TargetContributionMatch;
  confidence: number;
  dedupeKey?: string;
  correction?: boolean;
  manualOverride?: boolean;
}): TargetContribution {
  return {
    event: input.event,
    eventId: input.eventId,
    sourceRecord: input.sourceRecord,
    sourceRecordId: input.sourceRecordId,
    targetId: input.requirement.id,
    value: finite(input.value),
    unit: input.unit,
    dayKey: input.dayKey,
    dedupeKey: input.dedupeKey ?? `${input.requirement.id}:${input.sourceRecord}:${input.sourceRecordId}`,
    confidence: Math.max(0, Math.min(1, finite(input.confidence))),
    manualOverride: input.manualOverride === true,
    correction: input.correction ?? input.value < 0,
    matchedBy: input.matchedBy,
  };
}

function put(rows: Map<string, TargetContribution>, row: TargetContribution) {
  const current = rows.get(row.dedupeKey);
  if (!current || row.confidence > current.confidence || row.confidence === current.confidence && compareContributions(current, row) < 0) {
    rows.set(row.dedupeKey, row);
  }
}

function canonicalLogs(logs: StudyLog[]): StudyLog[] {
  const byId = new Map<string, StudyLog>();
  for (const log of [...logs].sort(compareLogs)) byId.set(log.id, log);
  return [...byId.values()].sort(compareLogs);
}

function canonicalManualContributions(records: DailySuccessManualContribution[]): DailySuccessManualContribution[] {
  const byId = new Map<string, DailySuccessManualContribution>();
  for (const record of [...records].sort(compareManual)) byId.set(record.id, record);
  return [...byId.values()].sort(compareManual);
}

function latestHabitEntry(entries: HabitEntry[], habitId: string, dayKey: string): HabitEntry | undefined {
  return entries
    .filter((entry) => entry.habitId === habitId && entry.date === dayKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .at(-1);
}

function latestCloseout(closeouts: DailyCloseout[], dayKey: string): DailyCloseout | undefined {
  return closeouts
    .filter((entry) => entry.dayKey === dayKey)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .at(-1);
}

function habitValue(entry: HabitEntry): number {
  if (entry.status === "done") return positive(entry.value) || 1;
  if (entry.status === "partial") return positive(entry.value) || 0.5;
  return 0;
}

function logMatchesAlias(log: StudyLog, aliases: Set<string>): boolean {
  return aliases.has(normalizeLabel(log.type));
}

function compareLogs(a: StudyLog, b: StudyLog): number {
  return a.ts.localeCompare(b.ts)
    || a.id.localeCompare(b.id)
    || logFingerprint(a).localeCompare(logFingerprint(b));
}

function logFingerprint(log: StudyLog): string {
  return [log.type, log.minutes, log.cards, log.quantity, log.quantityKind, log.quantityLabel, log.trackerId].join("|");
}

function compareManual(a: DailySuccessManualContribution, b: DailySuccessManualContribution): number {
  return a.updatedAt.localeCompare(b.updatedAt)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id)
    || a.value - b.value;
}

function compareContributions(a: TargetContribution, b: TargetContribution): number {
  return a.dedupeKey.localeCompare(b.dedupeKey)
    || a.sourceRecordId.localeCompare(b.sourceRecordId)
    || a.value - b.value;
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nonZero(value: unknown): number | undefined {
  const number = finite(value);
  return number === 0 ? undefined : number;
}

function positive(value: unknown): number {
  const number = finite(value);
  return number > 0 ? number : 0;
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
