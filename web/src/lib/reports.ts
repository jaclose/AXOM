import { addLocalDays } from "./dailyRollover";
import { evaluateDailySuccess } from "./dailySuccess";
import { targetPassesForItem } from "./tracker";
import type { NoctyriumState, StudyLog } from "./types";

export type ReportMetricState = "ready" | "low-data" | "neutral";
export type ReportMetricId = "study" | "streak" | "consistency" | "daily-success" | "readiness" | "performance" | "tracker-mastery" | "tasks";
export type CoreReportMetricId = Exclude<ReportMetricId, "readiness" | "performance">;

export interface ReportMetric {
  id: ReportMetricId;
  label: string;
  value: string;
  note: string;
  numerator: number;
  denominator: number;
  period: string;
  sourceLabel: string;
  sourceRecordIds: string[];
  calculation: string;
  interpretation: string;
  action?: string;
  state: ReportMetricState;
}

export interface CanonicalReportSummary {
  startKey: string;
  endKey: string;
  observedDates: string[];
  eligibleDates: string[];
  scoredDates: string[];
  activeDates: string[];
  successfulDates: string[];
  metrics: Record<CoreReportMetricId, ReportMetric>;
}

export type ReportTrendMetric = "minutes" | "questions" | "cards" | "requirements";

export interface ReportDayDatum {
  dayKey: string;
  tracked: boolean;
  eligible: boolean;
  scored: boolean;
  status: "neutral" | "pending" | "met" | "missed";
  minutes: number;
  questions: number;
  cards: number;
  requirementProgress: number;
  sourceRecordIds: string[];
}

export interface CanonicalReportTrends {
  currentWeek: ReportDayDatum[];
  previousWeek: ReportDayDatum[];
  month: ReportDayDatum[];
}

export interface ReportPeriodComparison {
  sufficient: boolean;
  currentValue: number;
  previousValue: number;
  percentChange?: number;
  interpretation: string;
  strongestContributor?: string;
  quietEligibleDays: number;
}

/** Canonical schedule-aware day series shared by weekly and monthly Reports UI. */
export function buildCanonicalReportTrends(state: NoctyriumState): CanonicalReportTrends {
  const floor = reportTrackingFloor(state);
  const history = reportDateKeys(state.activeDayKey, 366)
    .filter((dayKey) => dayKey >= floor)
    .map((dayKey) => reportDayDatum(state, dayKey, floor));
  const eligible = history.filter((day) => day.eligible);
  const currentWeek = eligible.slice(-7);
  const previousWeek = eligible.slice(-14, -7);
  const monthStart = `${state.activeDayKey.slice(0, 8)}01`;
  const month = reportDateKeys(state.activeDayKey, 31)
    .filter((dayKey) => dayKey >= monthStart)
    .map((dayKey) => reportDayDatum(state, dayKey, floor));
  return { currentWeek, previousWeek, month };
}

export function compareReportPeriods(
  current: readonly ReportDayDatum[],
  previous: readonly ReportDayDatum[],
  metric: ReportTrendMetric,
): ReportPeriodComparison {
  const currentScored = current.filter((day) => day.scored);
  const previousScored = previous.filter((day) => day.scored);
  const currentValue = periodMetric(currentScored, metric);
  const previousValue = periodMetric(previousScored, metric);
  const quietEligibleDays = currentScored.filter((day) => day.minutes === 0 && day.questions === 0 && day.cards === 0).length;
  if (currentScored.length < 7 || previousScored.length < 7 || previousValue <= 0) {
    return {
      sufficient: false,
      currentValue,
      previousValue,
      interpretation: "Not enough data yet for a reliable prior-week comparison.",
      quietEligibleDays,
    };
  }
  const percentChange = Math.round(((currentValue - previousValue) / previousValue) * 100);
  const metricLabel = metric === "minutes" ? "Study time" : metric === "questions" ? "Practice questions" : metric === "cards" ? "Cards" : "Requirement completion";
  const strongestContributor = strongestPositiveContributor(currentScored, previousScored);
  return {
    sufficient: true,
    currentValue,
    previousValue,
    percentChange,
    interpretation: `${metricLabel} ${percentChange >= 0 ? "increased" : "decreased"} ${Math.abs(percentChange)}% from the prior eligible week.`,
    strongestContributor,
    quietEligibleDays,
  };
}

export function reportTrendMetricValue(day: ReportDayDatum, metric: ReportTrendMetric): number {
  if (metric === "minutes") return day.minutes;
  if (metric === "questions") return day.questions;
  if (metric === "cards") return day.cards;
  return day.requirementProgress;
}

/** One canonical denominator/provenance source for the primary report cards. */
export function buildCanonicalReportSummary(state: NoctyriumState, range: number): CanonicalReportSummary {
  const endKey = state.activeDayKey;
  const allDates = reportDateKeys(endKey, range);
  const trackingFloor = reportTrackingFloor(state);
  const observedDates = allDates.filter((date) => date >= trackingFloor && date <= endKey);
  const successResults = observedDates.map((date) => evaluateDailySuccess(state, date, endKey));
  const eligibleResults = successResults.filter((result) => result.eligibleCount > 0);
  const eligibleDates = eligibleResults.map((result) => result.dayKey);
  // The current day remains visible in trends, but it does not become a failed
  // denominator while its selected requirements are still awaiting/in progress.
  const scoredResults = eligibleResults.filter((result) => result.dayKey < endKey || result.status === "met");
  const scoredDates = scoredResults.map((result) => result.dayKey);
  const logs = state.logs.filter((log) => observedDates.includes(log.dayKey));
  const observedActiveDates = observedDates.filter((date) => hasNetActivity(state.logs, date));
  const activeDates = eligibleDates.filter((date) => hasNetActivity(state.logs, date));
  const scoredActiveDates = scoredDates.filter((date) => hasNetActivity(state.logs, date));
  const successfulDates = scoredResults.filter((result) => result.status === "met").map((result) => result.dayKey);
  const totalMinutes = sumDailyNet(logs, (log) => finite(log.minutes));
  const totalQuantities = sumDailyNet(logs, (log) => finite(log.quantity) || finite(log.cards));

  const activeTracker = state.tracker.filter((item) => item.passes < targetPassesForItem(item) || item.yield === "review");
  const completedTracker = state.tracker.filter((item) => item.passes >= targetPassesForItem(item));
  const reviewedTracker = state.tracker.filter((item) => item.passes > 0);
  const ankiTracker = state.tracker.filter((item) => item.ankiPasses > 0);

  const startKey = allDates[0] ?? endKey;
  const inPeriodTasks = state.tasks.filter((task) => !task.archived && (
    task.due && task.due.slice(0, 10) >= startKey && task.due.slice(0, 10) <= endKey
    || task.completedAt && task.completedAt.slice(0, 10) >= startKey && task.completedAt.slice(0, 10) <= endKey
  ));
  const completedTasks = inPeriodTasks.filter((task) => task.done);
  const dueTasks = inPeriodTasks.filter((task) => !task.done && Boolean(task.due));
  const overdueTasks = dueTasks.filter((task) => task.due!.slice(0, 10) < endKey);
  const streak = successStreak(state, trackingFloor);

  const observationPeriod = `${observedDates.length} observed day${observedDates.length === 1 ? "" : "s"}`;
  const scoredPeriod = `${scoredDates.length} scored eligible day${scoredDates.length === 1 ? "" : "s"}`;
  const windowPeriod = `${allDates.length}-day window ending ${endKey}`;
  const consistency = percent(scoredActiveDates.length, scoredDates.length);
  const dailySuccess = percent(successfulDates.length, scoredResults.length);
  const mastery = percent(completedTracker.length, state.tracker.length);
  const hasSelectedRequirements = state.profile.dailySuccess
    ? state.profile.dailySuccess.requirements.some((requirement) => requirement.enabled)
    : true;

  return {
    startKey,
    endKey,
    observedDates,
    eligibleDates,
    scoredDates,
    activeDates,
    successfulDates,
    metrics: {
      study: {
        id: "study",
        label: "Recorded activity",
        value: totalMinutes ? `${Math.round(totalMinutes / 60)}h` : observedActiveDates.length ? `${observedActiveDates.length}` : "No data",
        note: totalMinutes ? `${totalMinutes} minutes${totalQuantities ? ` · ${totalQuantities} recorded units` : ""}` : `${observedActiveDates.length} active day${observedActiveDates.length === 1 ? "" : "s"}`,
        numerator: totalMinutes,
        denominator: observedDates.length,
        period: observationPeriod,
        sourceLabel: "Activity log",
        sourceRecordIds: logs.map((log) => log.id),
        calculation: `${totalMinutes} net minutes across ${logs.length} in-range activity record${logs.length === 1 ? "" : "s"}; signed corrections are applied before each day is clamped at zero.`,
        interpretation: logs.length ? "This is recorded effort, not a judgment of quality." : "AXOM needs a real activity before it can describe effort.",
        action: logs.length ? "Review the activity timeline" : "Log one activity",
        state: logs.length ? "ready" : "neutral",
      },
      streak: {
        id: "streak",
        label: "Current streak",
        value: scoredResults.length ? `${streak}` : "Building",
        note: scoredResults.length ? `${streak === 1 ? "eligible day" : "eligible days"} meeting selected requirements` : "No completed eligible success days yet",
        numerator: streak,
        denominator: scoredResults.length,
        period: scoredPeriod,
        sourceLabel: "Daily-success requirements and their linked records",
        sourceRecordIds: unique(scoredResults.flatMap((result) => result.requirements.flatMap((item) => item.sourceRecordIds))),
        calculation: "Counts consecutive eligible days whose selected requirements were met; today awaiting activity does not break it.",
        interpretation: streak ? "The current eligible rhythm is intact." : "A streak starts only after a selected requirement is met.",
        action: "Review today's remaining requirements",
        state: scoredResults.length ? "ready" : "neutral",
      },
      consistency: {
        id: "consistency",
        label: "Consistency",
        value: scoredDates.length ? `${consistency}%` : "Building",
        note: `${scoredActiveDates.length}/${scoredDates.length} completed eligible days had activity`,
        numerator: scoredActiveDates.length,
        denominator: scoredDates.length,
        period: scoredPeriod,
        sourceLabel: "Positive activity records",
        sourceRecordIds: logs.filter((log) => scoredActiveDates.includes(log.dayKey)).map((log) => log.id),
        calculation: `${scoredActiveDates.length} active completed eligible days ÷ ${scoredDates.length} completed eligible days. Off-schedule dates, dates before tracking began, and a pending current day are excluded.`,
        interpretation: scoredDates.length < 3 ? "More completed eligible days are needed before a pattern is meaningful." : consistency >= 70 ? "Activity is appearing on most eligible days." : "The pattern is still intermittent.",
        action: "Choose the smallest repeatable next action",
        state: scoredDates.length >= 3 ? "ready" : scoredDates.length ? "low-data" : "neutral",
      },
      "daily-success": {
        id: "daily-success",
        label: "Daily success",
        value: scoredResults.length ? `${dailySuccess}%` : hasSelectedRequirements ? "Building" : "Not configured",
        note: scoredResults.length
          ? `${successfulDates.length}/${scoredResults.length} eligible days met selected requirements`
          : hasSelectedRequirements
            ? "No completed eligible requirement day is ready to score"
            : "Choose requirements before this metric is scored",
        numerator: successfulDates.length,
        denominator: scoredResults.length,
        period: scoredPeriod,
        sourceLabel: "Configured daily-success selector",
        sourceRecordIds: unique(scoredResults.flatMap((result) => result.requirements.flatMap((item) => item.sourceRecordIds))),
        calculation: scoredResults.length
          ? `${successfulDates.length} successful eligible days ÷ ${scoredResults.length} scored eligible days.`
          : hasSelectedRequirements
            ? "No completed eligible requirement day produced a denominator; a pending current day is excluded."
            : "No configured eligible requirement produced a denominator.",
        interpretation: scoredResults.length
          ? "Only requirements active on each date are considered."
          : hasSelectedRequirements
            ? "The first result appears after an eligible day is completed or today's requirements are met."
            : "Cards, minutes, and every other supported signal remain optional.",
        action: hasSelectedRequirements ? "Review today's requirements" : "Configure daily requirements",
        state: scoredResults.length >= 3 ? "ready" : scoredResults.length ? "low-data" : "neutral",
      },
      "tracker-mastery": {
        id: "tracker-mastery",
        label: "Tracker mastery",
        value: state.tracker.length ? `${mastery}%` : "No data",
        note: state.tracker.length ? `${completedTracker.length} completed · ${activeTracker.length} active` : "Add or import tracked items",
        numerator: completedTracker.length,
        denominator: state.tracker.length,
        period: "Current tracker state",
        sourceLabel: "Course Tracker items",
        sourceRecordIds: state.tracker.map((item) => item.id),
        calculation: `${completedTracker.length} completed at target ÷ ${state.tracker.length} tracked items. ${reviewedTracker.length} reviewed; ${ankiTracker.length} Anki-linked.`,
        interpretation: "Completion, review progress, and Anki linkage are disclosed separately rather than collapsed into one claim.",
        action: "Open Course Tracker",
        state: state.tracker.length ? "ready" : "neutral",
      },
      tasks: {
        id: "tasks",
        label: "Tasks",
        value: inPeriodTasks.length ? `${completedTasks.length}/${inPeriodTasks.length}` : "No due tasks",
        note: `${completedTasks.length} completed · ${dueTasks.length} due · ${overdueTasks.length} overdue`,
        numerator: completedTasks.length,
        denominator: inPeriodTasks.length,
        period: windowPeriod,
        sourceLabel: "Non-archived tasks due or completed in the period",
        sourceRecordIds: inPeriodTasks.map((task) => task.id),
        calculation: "Counts non-archived tasks whose due or completion date falls inside the selected report window.",
        interpretation: overdueTasks.length ? `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} may need a decision.` : "No overdue in-period task is detected.",
        action: overdueTasks.length ? "Review overdue tasks" : "Review current tasks",
        state: inPeriodTasks.length ? "ready" : "neutral",
      },
    },
  };
}

export function reportDateKeys(endKey: string, range: number): string[] {
  const count = Math.max(1, Math.min(366, Math.floor(Number.isFinite(range) ? range : 1)));
  return Array.from({ length: count }, (_, index) => addLocalDays(endKey, index - count + 1));
}

export function reportTrackingFloor(state: NoctyriumState): string {
  const configuredStarts = state.profile.dailySuccess?.requirements
    .filter((requirement) => requirement.enabled)
    .map((requirement) => requirement.trackingStartsAt)
    .filter(Boolean) ?? [];
  if (configuredStarts.length) return [...configuredStarts].sort()[0];
  const firstActivity = [...state.logs].filter(isActivity).sort((a, b) => a.dayKey.localeCompare(b.dayKey))[0]?.dayKey;
  return firstActivity ?? state.activeDayKey;
}

function reportDayDatum(state: NoctyriumState, dayKey: string, floor: string): ReportDayDatum {
  const tracked = dayKey >= floor;
  const result = evaluateDailySuccess(state, dayKey, state.activeDayKey);
  const logs = state.logs.filter((log) => log.dayKey === dayKey);
  const minutes = net(logs, (log) => finite(log.minutes));
  const questions = net(logs.filter((log) => log.quantityKind === "questions"), (log) => finite(log.quantity));
  const cards = net(logs.filter((log) => finite(log.cards) !== 0 || log.quantityKind === "cards"), (log) =>
    finite(log.quantity) !== 0 ? finite(log.quantity) : finite(log.cards));
  const eligible = tracked && result.eligibleCount > 0;
  const scored = eligible && (dayKey < state.activeDayKey || result.status === "met");
  const status: ReportDayDatum["status"] = !eligible
    ? "neutral"
    : result.status === "met"
      ? "met"
      : dayKey >= state.activeDayKey
        ? "pending"
        : "missed";
  return {
    dayKey,
    tracked,
    eligible,
    scored,
    status,
    minutes,
    questions,
    cards,
    requirementProgress: eligible ? result.progress : 0,
    sourceRecordIds: unique([
      ...logs.map((log) => log.id),
      ...result.requirements.flatMap((requirement) => requirement.sourceRecordIds),
    ]),
  };
}

function periodMetric(days: readonly ReportDayDatum[], metric: ReportTrendMetric): number {
  if (metric === "requirements") {
    const scored = days.filter((day) => day.scored);
    return scored.length ? Math.round(scored.reduce((sum, day) => sum + day.requirementProgress, 0) / scored.length) : 0;
  }
  return days.reduce((sum, day) => sum + reportTrendMetricValue(day, metric), 0);
}

function strongestPositiveContributor(current: readonly ReportDayDatum[], previous: readonly ReportDayDatum[]): string | undefined {
  const candidates: Array<{ label: string; metric: ReportTrendMetric }> = [
    { label: "Practice questions", metric: "questions" },
    { label: "Study time", metric: "minutes" },
    { label: "Cards", metric: "cards" },
  ];
  return candidates
    .map((candidate, index) => {
      const before = periodMetric(previous, candidate.metric);
      const after = periodMetric(current, candidate.metric);
      const growth = before > 0 ? (after - before) / before : after > 0 ? 1 : 0;
      return { ...candidate, growth, index };
    })
    .filter((candidate) => candidate.growth > 0)
    .sort((a, b) => b.growth - a.growth || a.index - b.index)[0]?.label;
}

function net(logs: readonly StudyLog[], value: (log: StudyLog) => number): number {
  return Math.max(0, logs.reduce((sum, log) => sum + finite(value(log)), 0));
}

function successStreak(state: NoctyriumState, floor: string): number {
  let cursor = state.activeDayKey;
  let streak = 0;
  let first = true;
  for (let index = 0; index < 366 && cursor >= floor; index += 1) {
    const result = evaluateDailySuccess(state, cursor, state.activeDayKey);
    if (result.eligibleCount === 0) {
      cursor = addLocalDays(cursor, -1);
      first = false;
      continue;
    }
    if (first && result.status !== "met") {
      cursor = addLocalDays(cursor, -1);
      first = false;
      continue;
    }
    if (result.status === "met") streak += 1;
    else break;
    cursor = addLocalDays(cursor, -1);
    first = false;
  }
  return streak;
}

function isActivity(log: StudyLog): boolean {
  return finite(log.minutes) > 0 || finite(log.cards) > 0 || finite(log.quantity) > 0;
}

function hasNetActivity(logs: StudyLog[], dayKey: string): boolean {
  const dayLogs = logs.filter((log) => log.dayKey === dayKey);
  const minutes = dayLogs.reduce((sum, log) => sum + finite(log.minutes), 0);
  const cards = dayLogs.reduce((sum, log) => sum + finite(log.cards), 0);
  const quantity = dayLogs.reduce((sum, log) => sum + finite(log.quantity), 0);
  return minutes > 0 || cards > 0 || quantity > 0;
}

function sumDailyNet(logs: StudyLog[], value: (log: StudyLog) => number): number {
  const byDay = new Map<string, number>();
  for (const log of logs) byDay.set(log.dayKey, (byDay.get(log.dayKey) ?? 0) + finite(value(log)));
  return [...byDay.values()].reduce((sum, daily) => sum + Math.max(0, daily), 0);
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Activity-based trends (no daily targets required)
//
// Weekly and monthly *activity* charts follow real calendar days — exactly
// like the Productivity page — so a learner who logs work but has not set up
// daily targets still sees an honest pattern. Target-completion views keep
// using the schedule-aware eligible-day series above.
// ---------------------------------------------------------------------------

export interface CalendarWeeks {
  current: ReportDayDatum[];
  previous: ReportDayDatum[];
}

/** The last `count` calendar days ending today (for effort charts). */
export function buildRecentDays(state: NoctyriumState, count: number): ReportDayDatum[] {
  const floor = reportTrackingFloor(state);
  return reportDateKeys(state.activeDayKey, count).map((dayKey) => reportDayDatum(state, dayKey, floor));
}

/** The last 7 calendar days ending today, and the 7 before them. */
export function buildCalendarWeeks(state: NoctyriumState): CalendarWeeks {
  const floor = reportTrackingFloor(state);
  const keys = reportDateKeys(state.activeDayKey, 14);
  const days = keys.map((dayKey) => reportDayDatum(state, dayKey, floor));
  return { previous: days.slice(0, 7), current: days.slice(7) };
}

export interface ActivityWeekSummary {
  total: number;
  previousTotal: number;
  activeDays: number;
  previousActiveDays: number;
  /** null when last week had nothing to compare against. */
  percentChange: number | null;
  bestDayKey?: string;
  interpretation: string;
}

export function summarizeActivityWeek(
  current: readonly ReportDayDatum[],
  previous: readonly ReportDayDatum[],
  metric: Exclude<ReportTrendMetric, "requirements">,
): ActivityWeekSummary {
  const value = (day: ReportDayDatum) => reportTrendMetricValue(day, metric);
  const total = current.reduce((sum, day) => sum + value(day), 0);
  const previousTotal = previous.reduce((sum, day) => sum + value(day), 0);
  const activeDays = current.filter((day) => value(day) > 0).length;
  const previousActiveDays = previous.filter((day) => value(day) > 0).length;
  const best = [...current].sort((a, b) => value(b) - value(a) || a.dayKey.localeCompare(b.dayKey))[0];
  const percentChange = previousTotal > 0 ? Math.round(((total - previousTotal) / previousTotal) * 100) : null;
  const noun = metric === "minutes" ? "Study time" : metric === "questions" ? "Practice questions" : "Cards";
  const interpretation = !total && !previousTotal
    ? `No ${metric} logged in the last two weeks yet.`
    : percentChange === null
      ? `${noun}: ${formatMetric(total, metric)} this week — last week had none to compare.`
      : percentChange === 0
        ? `${noun} matched last week exactly.`
        : `${noun} is ${percentChange > 0 ? "up" : "down"} ${Math.abs(percentChange)}% vs the previous 7 days (${formatMetric(previousTotal, metric)}).`;
  return {
    total,
    previousTotal,
    activeDays,
    previousActiveDays,
    percentChange,
    bestDayKey: best && value(best) > 0 ? best.dayKey : undefined,
    interpretation,
  };
}

export function formatMetric(value: number, metric: ReportTrendMetric): string {
  if (metric === "minutes") {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  if (metric === "requirements") return `${Math.round(value)}%`;
  return `${Math.round(value)} ${metric}`;
}

/**
 * Activity rhythm for learners without daily targets: active days in the
 * window and the current run of consecutive active days. Today counts once
 * it has activity; an empty today never breaks the run.
 */
export function buildActivityRhythm(state: NoctyriumState, range: number): { consistency: ReportMetric; streak: ReportMetric } {
  const floor = reportTrackingFloor(state);
  const endKey = state.activeDayKey;
  const observed = reportDateKeys(endKey, range).filter((dayKey) => dayKey >= floor);
  const completed = observed.filter((dayKey) => dayKey < endKey);
  const active = completed.filter((dayKey) => hasNetActivity(state.logs, dayKey));
  const todayActive = hasNetActivity(state.logs, endKey);
  let streak = todayActive ? 1 : 0;
  for (let cursor = addLocalDays(endKey, -1); cursor >= floor; cursor = addLocalDays(cursor, -1)) {
    if (!hasNetActivity(state.logs, cursor)) break;
    streak += 1;
  }
  const rate = percent(active.length, completed.length);
  const period = `${completed.length} completed day${completed.length === 1 ? "" : "s"} in the last ${range}`;
  const sourceRecordIds = state.logs.filter((log) => observed.includes(log.dayKey)).map((log) => log.id);
  return {
    consistency: {
      id: "consistency",
      label: "Active days",
      value: completed.length ? `${rate}%` : "Building",
      note: `${active.length} of ${completed.length} days had logged activity`,
      numerator: active.length,
      denominator: completed.length,
      period,
      sourceLabel: "Activity log (calendar days)",
      sourceRecordIds,
      calculation: `${active.length} days with positive logged activity ÷ ${completed.length} completed calendar days since you started tracking. Today is excluded until it ends.`,
      interpretation: completed.length < 3
        ? "A few more days are needed before a pattern means much."
        : rate >= 80 ? "You show up almost every day." : rate >= 50 ? "You’re active on most days — protect the quiet ones." : "The rhythm is intermittent; aim for small daily contact.",
      action: "Set daily targets for target-based consistency",
      state: completed.length >= 3 ? "ready" : completed.length ? "low-data" : "neutral",
    },
    streak: {
      id: "streak",
      label: "Activity streak",
      value: `${streak}`,
      note: `${streak === 1 ? "day" : "days"} in a row with logged activity${todayActive ? " (including today)" : ""}`,
      numerator: streak,
      denominator: observed.length,
      period,
      sourceLabel: "Activity log (calendar days)",
      sourceRecordIds,
      calculation: "Consecutive calendar days with positive logged activity, counting back from yesterday (today is added once it has activity).",
      interpretation: streak >= 7 ? "A full week of contact. Keep the floor low enough to keep it." : streak ? "The run is alive — one small log keeps it going." : "Log anything today to start a new run.",
      action: "Log an activity",
      state: observed.length ? "ready" : "neutral",
    },
  };
}
