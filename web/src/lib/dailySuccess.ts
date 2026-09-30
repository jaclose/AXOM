import type {
  DailySuccessConfig,
  DailySuccessManualContribution,
  DailySuccessRequirement,
  DailySuccessSchedule,
  DailySuccessSource,
  Habit,
  NoctyriumState,
  ProductivityTracker,
} from "./types";
import { addLocalDays, localDateKey } from "./dailyRollover";
import { buildTargetContributionLedger, type TargetContribution } from "./targetContributions";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REQUIREMENT_WEIGHT = 0.1;
const MAX_REQUIREMENT_WEIGHT = 5;

export type DailyRequirementStatus =
  | "not-eligible"
  | "awaiting"
  | "in-progress"
  | "met"
  | "missed"
  | "unavailable";

export interface DailyRequirementResult {
  requirement: DailySuccessRequirement;
  eligible: boolean;
  current: number;
  target: number;
  ratio: number;
  status: DailyRequirementStatus;
  sourceLabel: string;
  sourceRecordIds: string[];
  contributions: TargetContribution[];
  calculation: string;
}

export interface DailySuccessResult {
  mode: "configured" | "legacy";
  dayKey: string;
  requirements: DailyRequirementResult[];
  eligibleCount: number;
  metCount: number;
  progress: number;
  status: "neutral" | "in-progress" | "met" | "missed";
  statusLabel: string;
}

export type DailySuccessState = Pick<
  NoctyriumState,
  "profile" | "logs" | "productivityTrackers" | "habits" | "habitEntries" | "closeouts" | "activeDayKey"
>;

/**
 * One canonical daily-success selector for Productivity, Dashboard, and Reports.
 * It reads existing records; it never writes a parallel completion ledger.
 */
export function evaluateDailySuccess(
  state: DailySuccessState,
  dayKey: string = state.activeDayKey,
  today: string = state.activeDayKey,
): DailySuccessResult {
  const configured = state.profile.dailySuccess;
  const requirements = configured
    ? configured.requirements
    : legacyRequirements(state);
  const mode = configured ? "configured" : "legacy";
  const results = requirements.map((requirement) => evaluateRequirement(requirement, state, dayKey, today));
  const eligible = results.filter((result) => result.eligible && result.status !== "unavailable");
  const totalWeight = eligible.reduce((sum, result) => sum + normalizeWeight(result.requirement.weight), 0);
  const progress = eligible.length && totalWeight > 0
    ? Math.round((eligible.reduce((sum, result) => sum + result.ratio * normalizeWeight(result.requirement.weight), 0) / totalWeight) * 100)
    : 0;
  const metCount = eligible.filter((result) => result.status === "met").length;
  const anyActivity = eligible.some((result) => result.current > 0);
  const anyMissed = eligible.some((result) => result.status === "missed");
  const allMet = eligible.length > 0 && metCount === eligible.length;
  const enabledCount = requirements.filter((requirement) => requirement.enabled).length;
  const unavailableCount = results.filter((result) => result.status === "unavailable").length;
  const status = eligible.length === 0 || (!anyActivity && dayKey >= today)
    ? "neutral"
    : allMet
      ? "met"
      : anyMissed
        ? "missed"
        : "in-progress";

  return {
    mode,
    dayKey,
    requirements: results,
    eligibleCount: eligible.length,
    metCount,
    progress,
    status,
    statusLabel: status === "neutral"
      ? eligible.length
        ? "Awaiting first activity"
        : requirements.length === 0
          ? "No requirements selected"
          : unavailableCount > 0
            ? `${unavailableCount === 1 ? "Requirement source" : "Requirement sources"} unavailable`
            : enabledCount > 0
              ? "No requirements scheduled today"
              : "No requirements enabled"
      : status === "met"
        ? "Daily requirements met"
        : status === "missed"
          ? "Requirements not completed"
          : "In progress",
  };
}

export function evaluateRequirement(
  requirement: DailySuccessRequirement,
  state: DailySuccessState,
  dayKey: string,
  today: string,
): DailyRequirementResult {
  const target = safePositive(requirement.target, 1);
  const base = {
    requirement,
    current: 0,
    target,
    ratio: 0,
    sourceLabel: sourceLabel(requirement.source),
    sourceRecordIds: [] as string[],
    contributions: [] as TargetContribution[],
    calculation: "Not eligible on this date.",
  };
  if (!requirement.enabled || dayKey < requirement.trackingStartsAt) {
    return { ...base, eligible: false, status: "not-eligible" };
  }

  const sourceExists = hasSource(requirement.source, state.productivityTrackers, state.habits);
  if (!sourceExists) {
    return {
      ...base,
      eligible: true,
      status: "unavailable",
      calculation: "The linked source is no longer available. Existing activity history was not removed.",
    };
  }

  if (requirement.schedule.kind === "weekdays" && !requirement.schedule.weekdays.includes(weekday(dayKey))) {
    return { ...base, eligible: false, status: "not-eligible" };
  }

  if (requirement.schedule.kind === "times-per-week" || requirement.schedule.kind === "weekly-total") {
    return evaluateWeeklyRequirement(requirement, state, dayKey, today, base);
  }

  const observed = observedValue(requirement, state, dayKey);
  const current = observed.value;
  const ratio = clampRatio(current / target);
  const met = current >= target;
  const isTodayOrFuture = dayKey >= today;
  const status: DailyRequirementStatus = met
    ? "met"
    : current > 0
      ? "in-progress"
      : isTodayOrFuture
        ? "awaiting"
        : "missed";
  return {
    ...base,
    eligible: true,
    current,
    ratio,
    status,
    sourceRecordIds: observed.ids,
    contributions: observed.contributions,
    calculation: `${formatNumber(current)} of ${formatNumber(target)} ${requirement.unit}`,
  };
}

function evaluateWeeklyRequirement(
  requirement: DailySuccessRequirement,
  state: DailySuccessState,
  dayKey: string,
  today: string,
  base: Omit<DailyRequirementResult, "eligible" | "status">,
): DailyRequirementResult {
  const schedule = requirement.schedule as Extract<DailySuccessSchedule, { kind: "times-per-week" | "weekly-total" }>;
  const weekStartsOn = schedule.weekStartsOn === 1 ? 1 : 0;
  const start = weekStart(dayKey, weekStartsOn);
  const end = addLocalDays(start, 6);
  // A weekly quota contributes one historical result per week (on that week's
  // final day), not seven repeated daily failures/successes. The current day
  // remains eligible so the live dashboard can show progress during the week.
  if (dayKey < today && dayKey !== end) {
    return { ...base, eligible: false, status: "not-eligible" };
  }
  const availableDays: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    if (cursor >= requirement.trackingStartsAt) availableDays.push(cursor);
  }
  const cutoff = dayKey < today ? end : today;
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    if (cursor >= requirement.trackingStartsAt && cursor <= cutoff) days.push(cursor);
  }
  const observedDays: Array<{ value: number; ids: string[]; contributions: TargetContribution[] }> = [];
  const matching: Array<{ value: number; ids: string[]; contributions: TargetContribution[] }> = [];
  for (const date of days) {
    const observed = observedValue(requirement, state, date);
    observedDays.push(observed);
    if (observed.value >= base.target) matching.push(observed);
  }
  if (schedule.kind === "weekly-total") {
    const current = observedDays.reduce((total, day) => total + day.value, 0);
    const met = current >= base.target;
    return { ...base, eligible: true, current, ratio: clampRatio(current / base.target),
      status: met ? "met" : dayKey < today && dayKey === end ? "missed" : current > 0 ? "in-progress" : "awaiting",
      sourceRecordIds: [...new Set(observedDays.flatMap((result) => result.ids))],
      contributions: observedDays.flatMap((result) => result.contributions),
      calculation: `${formatNumber(current)} of ${formatNumber(base.target)} ${requirement.unit} this week`,
    };
  }
  // A requirement created late in its first week can never demand more
  // occurrences than calendar opportunities that remained in that week.
  const targetOccurrences = Math.max(1, Math.min(
    availableDays.length || 1,
    Math.min(7, Math.round(safePositive(schedule.times, 1))),
  ));
  const current = matching.length;
  const met = current >= targetOccurrences;
  const closed = dayKey < today && dayKey === end;
  return {
    ...base,
    eligible: true,
    current,
    target: targetOccurrences,
    ratio: clampRatio(current / targetOccurrences),
    status: met ? "met" : closed ? "missed" : current ? "in-progress" : "awaiting",
    sourceRecordIds: [...new Set(observedDays.flatMap((result) => result.ids))],
    contributions: observedDays.flatMap((result) => result.contributions),
    calculation: `${current} of ${targetOccurrences} scheduled completions for ${start}–${end}`,
  };
}

function observedValue(
  requirement: DailySuccessRequirement,
  state: DailySuccessState,
  dayKey: string,
): { value: number; ids: string[]; contributions: TargetContribution[] } {
  const ledger = buildTargetContributionLedger({
    requirement,
    dayKey,
    logs: state.logs,
    productivityTrackers: state.productivityTrackers,
    habits: state.habits,
    habitEntries: state.habitEntries,
    closeouts: state.closeouts,
  });
  return { value: ledger.value, ids: ledger.sourceRecordIds, contributions: ledger.contributions };
}

function hasSource(source: DailySuccessSource, trackers: ProductivityTracker[], habits: Habit[]): boolean {
  if (source.kind === "productivity-tracker") {
    return trackers.some((tracker) => tracker.id === source.trackerId && !tracker.archived);
  }
  if (source.kind === "habit") return habits.some((habit) => habit.id === source.habitId && !habit.archived);
  return true;
}

export function makeDailyRequirement(
  input: Pick<DailySuccessRequirement, "id" | "label" | "source" | "target" | "unit"> &
    Partial<Pick<DailySuccessRequirement, "enabled" | "aliases" | "excludedSourceRecordIds" | "includedSourceRecordIds" | "manualContributions" | "weight" | "schedule" | "trackingStartsAt" | "createdAt" | "updatedAt">>,
  today: string = localDateKey(),
): DailySuccessRequirement {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    label: input.label.trim() || sourceLabel(input.source),
    source: input.source,
    enabled: input.enabled ?? true,
    aliases: normalizeAliases(input.aliases),
    excludedSourceRecordIds: normalizeRecordIds(input.excludedSourceRecordIds),
    includedSourceRecordIds: normalizeRecordIds(input.includedSourceRecordIds),
    manualContributions: normalizeManualContributions(input.manualContributions, input.id),
    weight: normalizeWeight(input.weight),
    target: safePositive(input.target, 1),
    unit: input.unit.trim() || "times",
    schedule: normalizeSchedule(input.schedule),
    trackingStartsAt: validDate(input.trackingStartsAt) ?? today,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

/** Boundary normalizer shared by IndexedDB hydration and portable imports. */
export function normalizeDailySuccessConfig(value: unknown): DailySuccessConfig | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.requirements)) return undefined;
  const configuredAt = validDate(value.configuredAt) ?? localDateKey();
  const requirements: DailySuccessRequirement[] = [];
  const seen = new Set<string>();
  for (const candidate of value.requirements) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 160) : "";
    const source = normalizeSource(candidate.source);
    if (!id || seen.has(id) || !source) continue;
    seen.add(id);
    const createdAt = safeTimestamp(candidate.createdAt);
    const updatedAt = safeTimestamp(candidate.updatedAt, createdAt);
    requirements.push({
      id,
      label: typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim().slice(0, 120)
        : sourceLabel(source),
      enabled: candidate.enabled !== false,
      source,
      aliases: normalizeAliases(candidate.aliases),
      excludedSourceRecordIds: normalizeRecordIds(candidate.excludedSourceRecordIds),
      includedSourceRecordIds: normalizeRecordIds(candidate.includedSourceRecordIds),
      manualContributions: normalizeManualContributions(candidate.manualContributions, id),
      weight: normalizeWeight(candidate.weight),
      target: safePositive(candidate.target, 1),
      unit: typeof candidate.unit === "string" && candidate.unit.trim() ? candidate.unit.trim().slice(0, 40) : "times",
      schedule: normalizeSchedule(candidate.schedule),
      trackingStartsAt: validDate(candidate.trackingStartsAt) ?? configuredAt,
      createdAt,
      updatedAt,
    });
  }
  return { version: 1, configuredAt, requirements };
}

function legacyRequirements(state: DailySuccessState): DailySuccessRequirement[] {
  const firstLog = [...state.logs].sort((a, b) => a.dayKey.localeCompare(b.dayKey))[0]?.dayKey;
  const trackingStartsAt = validDate(firstLog) ?? state.activeDayKey;
  const createdAt = `${trackingStartsAt}T12:00:00.000Z`;
  return [
    makeDailyRequirement({
      id: "legacy-study-minutes",
      label: "Study minutes",
      source: { kind: "study-minutes" },
      target: safePositive(state.profile.dailyMinuteTarget, 240),
      unit: "minutes",
      trackingStartsAt,
      createdAt,
      updatedAt: createdAt,
    }, trackingStartsAt),
    makeDailyRequirement({
      id: "legacy-cards-reviewed",
      label: "Cards reviewed",
      source: { kind: "cards-reviewed" },
      target: safePositive(state.profile.dailyCardTarget, 120),
      unit: "cards",
      trackingStartsAt,
      createdAt,
      updatedAt: createdAt,
    }, trackingStartsAt),
  ];
}

function normalizeSource(value: unknown): DailySuccessSource | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (["study-minutes", "cards-reviewed", "practice-questions", "journal-closeout", "activity-alias", "manual"].includes(value.kind)) {
    return { kind: value.kind } as DailySuccessSource;
  }
  if (value.kind === "productivity-tracker" && typeof value.trackerId === "string" && value.trackerId.trim()) {
    return { kind: value.kind, trackerId: value.trackerId.trim() };
  }
  if (value.kind === "habit" && typeof value.habitId === "string" && value.habitId.trim()) {
    return { kind: value.kind, habitId: value.habitId.trim() };
  }
  return undefined;
}

function normalizeSchedule(value: unknown): DailySuccessSchedule {
  if (!isRecord(value)) return { kind: "daily" };
  if (value.kind === "weekdays") {
    const weekdays = Array.isArray(value.weekdays)
      ? [...new Set(value.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    return weekdays.length ? { kind: "weekdays", weekdays } : { kind: "daily" };
  }
  if (value.kind === "weekly-total") return { kind: "weekly-total", weekStartsOn: value.weekStartsOn === 0 ? 0 : 1 };
  if (value.kind === "times-per-week") {
    return {
      kind: "times-per-week",
      times: Math.max(1, Math.min(7, Math.round(safePositive(value.times, 1)))),
      weekStartsOn: value.weekStartsOn === 1 ? 1 : 0,
    };
  }
  return { kind: "daily" };
}

function normalizeAliases(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const alias = candidate.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = alias.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!alias || !key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
    if (aliases.length >= 20) break;
  }
  return aliases.length ? aliases : undefined;
}

function normalizeRecordIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim().slice(0, 160))
    .filter(Boolean))].slice(0, 200);
  return ids.length ? ids : undefined;
}

function normalizeManualContributions(
  value: unknown,
  requirementId: string,
): DailySuccessManualContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = new Map<string, DailySuccessManualContribution>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 160) : "";
    const dayKey = validDate(candidate.dayKey);
    const numericValue = Number(candidate.value);
    if (!id || !dayKey || !Number.isFinite(numericValue)) continue;
    const createdAt = safeTimestamp(candidate.createdAt, `${dayKey}T12:00:00.000Z`);
    const mode = candidate.mode === "add" ? "add" : "override";
    const record: DailySuccessManualContribution = {
      id,
      requirementId,
      dayKey,
      value: mode === "override" ? Math.max(0, numericValue) : numericValue,
      unit: typeof candidate.unit === "string" && candidate.unit.trim()
        ? candidate.unit.trim().slice(0, 40)
        : undefined,
      note: typeof candidate.note === "string" && candidate.note.trim()
        ? candidate.note.trim().slice(0, 240)
        : undefined,
      mode,
      createdAt,
      updatedAt: safeTimestamp(candidate.updatedAt, createdAt),
    };
    const current = records.get(id);
    if (!current || compareManualContribution(current, record) < 0) records.set(id, record);
  }
  const normalized = [...records.values()].sort(compareManualContribution);
  return normalized.length ? normalized : undefined;
}

function compareManualContribution(a: DailySuccessManualContribution, b: DailySuccessManualContribution): number {
  return a.updatedAt.localeCompare(b.updatedAt)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id)
    || a.mode.localeCompare(b.mode)
    || (a.note ?? "").localeCompare(b.note ?? "")
    || a.value - b.value;
}

function sourceLabel(source: DailySuccessSource): string {
  if (source.kind === "study-minutes") return "Study activity";
  if (source.kind === "cards-reviewed") return "Card reviews";
  if (source.kind === "practice-questions") return "Practice questions";
  if (source.kind === "journal-closeout") return "Daily closeout";
  if (source.kind === "activity-alias") return "Matched activity";
  if (source.kind === "manual") return "Manual check-in";
  if (source.kind === "habit") return "Habit activity";
  return "Productivity activity";
}

function weekStart(dayKey: string, weekStartsOn: 0 | 1): string {
  const day = weekday(dayKey);
  const offset = (day - weekStartsOn + 7) % 7;
  return addLocalDays(dayKey, -offset);
}

function weekday(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00`).getDay();
}

function validDate(value: unknown): string | undefined {
  return typeof value === "string" && DATE_KEY.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
    ? value
    : undefined;
}

function positive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safePositive(value: unknown, fallback: number): number {
  return positive(value) || fallback;
}

function normalizeWeight(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.max(MIN_REQUIREMENT_WEIGHT, Math.min(MAX_REQUIREMENT_WEIGHT, number));
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function safeTimestamp(value: unknown, fallback: string = new Date().toISOString()): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
