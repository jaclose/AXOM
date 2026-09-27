import type { DailyRequirementStatus, DailySuccessResult } from "./dailySuccess";
import { evaluateDailySuccess } from "./dailySuccess";
import { localDateKey } from "./dailyRollover";
import { calculateReadiness, type ReadinessContribution, type SelfReportedEnergy } from "./energy";
import { isScheduledDay, trackingStartKey } from "./habits";
import { entryDayKey, planForDay } from "./journal";
import { questionMappingStatus, type QuestionAttempt } from "./questions";
import { dayTotals } from "./scoring";
import { sessionElapsedMinutes, type SessionLink, type SessionStatus } from "./sessions";
import type { TargetContribution } from "./targetContributions";
import type { HabitCheckStatus, NoctyriumState, Task } from "./types";

export type DayAtAGlanceState = Pick<
  NoctyriumState,
  | "profile"
  | "activeDayKey"
  | "dayPlans"
  | "logs"
  | "productivityTrackers"
  | "sessions"
  | "questions"
  | "habits"
  | "habitEntries"
  | "tasks"
  | "energyFactors"
  | "journal"
  | "closeouts"
>;

export type DayAtAGlanceSourceType =
  | "day-plan"
  | "daily-requirement"
  | "study-log"
  | "study-session"
  | "question"
  | "question-attempt"
  | "habit"
  | "habit-entry"
  | "task"
  | "energy-factor"
  | "journal-entry"
  | "daily-closeout"
  | "manual-contribution";

export type DayAtAGlanceSourceRole =
  | "intention"
  | "target"
  | "focus"
  | "session-context"
  | "questions"
  | "cards"
  | "habit"
  | "task-completed"
  | "task-open"
  | "energy"
  | "win"
  | "unfinished";

export interface DayAtAGlanceSourceRef {
  sourceType: DayAtAGlanceSourceType;
  sourceId: string;
  role: DayAtAGlanceSourceRole;
  detail?: string;
}

export interface DayAtAGlanceIntention {
  text: string;
  outcome?: "won" | "partial" | "missed";
  reviewNote?: string;
  sourceId: string;
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceTargetResult {
  id: string;
  label: string;
  eligible: boolean;
  current: number;
  target: number;
  unit: string;
  ratio: number;
  status: DailyRequirementStatus;
  sourceLabel: string;
  sourceRecordIds: string[];
  calculation: string;
  contributions: TargetContribution[];
}

export interface DayAtAGlanceTargetCompletion {
  progress: number;
  status: DailySuccessResult["status"];
  statusLabel: string;
  eligibleCount: number;
  metCount: number;
  requirements: DayAtAGlanceTargetResult[];
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceSession {
  id: string;
  title: string;
  status: SessionStatus;
  elapsedMinutes: number;
  source: "command-brief" | "minimum-viable-win" | "recovery" | "manual";
  link: SessionLink;
}

export interface DayAtAGlanceFocusedMinutes {
  /** Finalized academic minutes. Completed sessions and Pomodoro runs auto-log here. */
  value: number;
  sourceIds: string[];
  pomodoroLogIds: string[];
  sessions: DayAtAGlanceSession[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceQuestions {
  trustedAttempts: number;
  correct: number;
  incorrect: number;
  other: number;
  questionIds: string[];
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceCards {
  reviewed: number;
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceHabit {
  habitId: string;
  name: string;
  expectedToday: boolean;
  status: HabitCheckStatus | "none";
  value?: number;
  target?: number;
  unit?: string;
  entryId?: string;
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceHabits {
  items: DayAtAGlanceHabit[];
  expected: number;
  done: number;
  partial: number;
  skipped: number;
  missed: number;
  unlogged: number;
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceTask {
  id: string;
  title: string;
  due?: string;
  scope?: string;
}

export interface DayAtAGlanceTasks {
  completed: DayAtAGlanceTask[];
  open: DayAtAGlanceTask[];
  /** Historical task state is not versioned; open means still open now and created by this day. */
  openBasis: "current-state-created-by-day";
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceEnergy {
  hasEvidence: boolean;
  selfReported: SelfReportedEnergy;
  estimatedReadiness: number;
  readinessLabel: "Low" | "Recovering" | "Ready" | "High";
  contributions: ReadinessContribution[];
  possibleSignalIds: string[];
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlanceWin {
  text: string;
  kind: "planned-condition" | "closeout-summary" | "journal-summary";
  status: "planned" | "confirmed" | "reported";
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export type DayAtAGlanceUnfinishedKind =
  | "day-plan"
  | "target"
  | "session"
  | "habit"
  | "task"
  | "closeout";

export interface DayAtAGlanceUnfinishedItem {
  id: string;
  kind: DayAtAGlanceUnfinishedKind;
  label: string;
  status: string;
  sourceIds: string[];
  provenance: DayAtAGlanceSourceRef[];
}

export interface DayAtAGlance {
  dayKey: string;
  hasEvidence: boolean;
  intention: DayAtAGlanceIntention | null;
  targetCompletion: DayAtAGlanceTargetCompletion;
  focusedMinutes: DayAtAGlanceFocusedMinutes;
  questions: DayAtAGlanceQuestions;
  cards: DayAtAGlanceCards;
  habits: DayAtAGlanceHabits;
  tasks: DayAtAGlanceTasks;
  energy: DayAtAGlanceEnergy;
  wins: DayAtAGlanceWin[];
  unfinishedItems: DayAtAGlanceUnfinishedItem[];
  provenance: DayAtAGlanceSourceRef[];
}

/**
 * Read one local study day from existing canonical records. This selector never
 * writes a summary record, invents completion, or asks an AI to interpret data.
 */
export function selectDayAtAGlance(
  state: DayAtAGlanceState,
  dayKey: string = state.activeDayKey,
  today: string = state.activeDayKey,
  now: Date = new Date(),
): DayAtAGlance {
  const plan = planForDay(state.dayPlans, dayKey);
  const planId = `day-plan:${dayKey}`;
  const intentionProvenance = plan
    ? [source("day-plan", planId, "intention")]
    : [];
  const intention: DayAtAGlanceIntention | null = plan?.intention.trim()
    ? {
        text: plan.intention.trim(),
        outcome: plan.outcome,
        reviewNote: cleanText(plan.reviewNote),
        sourceId: planId,
        provenance: intentionProvenance,
      }
    : null;

  const targetCompletion = selectTargetCompletion(state, dayKey, today);
  const focusedMinutes = selectFocusedMinutes(state, dayKey, now);
  const questions = selectQuestions(state, dayKey);
  const cards = selectCards(state, dayKey);
  const habits = selectHabits(state, dayKey, today);
  const tasks = selectTasks(state.tasks, dayKey);
  const energy = selectEnergy(state, dayKey);
  const wins = selectWins(state, dayKey, planId);
  const unfinishedItems = selectUnfinished({
    state,
    dayKey,
    today,
    planId,
    targetCompletion,
    focusedMinutes,
    habits,
    tasks,
  });
  const provenance = uniqueSources([
    ...intentionProvenance,
    ...targetCompletion.provenance,
    ...focusedMinutes.provenance,
    ...questions.provenance,
    ...cards.provenance,
    ...habits.provenance,
    ...tasks.provenance,
    ...energy.provenance,
    ...wins.flatMap((win) => win.provenance),
    ...unfinishedItems.flatMap((item) => item.provenance),
  ]);

  return {
    dayKey,
    hasEvidence: provenance.length > 0,
    intention,
    targetCompletion,
    focusedMinutes,
    questions,
    cards,
    habits,
    tasks,
    energy,
    wins,
    unfinishedItems,
    provenance,
  };
}

function selectTargetCompletion(
  state: DayAtAGlanceState,
  dayKey: string,
  today: string,
): DayAtAGlanceTargetCompletion {
  const result = evaluateDailySuccess(state, dayKey, today);
  const requirements = result.requirements.map((item): DayAtAGlanceTargetResult => ({
    id: item.requirement.id,
    label: item.requirement.label,
    eligible: item.eligible,
    current: finiteNonNegative(item.current),
    target: finiteNonNegative(item.target),
    unit: item.requirement.unit,
    ratio: clampRatio(item.ratio),
    status: item.status,
    sourceLabel: item.sourceLabel,
    sourceRecordIds: uniqueStrings(item.sourceRecordIds),
    calculation: item.calculation,
    contributions: item.contributions,
  }));
  const provenance = requirements.flatMap((requirement) => [
    source("daily-requirement", requirement.id, "target"),
    ...requirement.contributions.map(targetContributionSource),
  ]);
  return {
    progress: finiteNonNegative(result.progress),
    status: result.status,
    statusLabel: result.statusLabel,
    eligibleCount: result.eligibleCount,
    metCount: result.metCount,
    requirements,
    sourceIds: uniqueStrings(requirements.flatMap((requirement) => [requirement.id, ...requirement.sourceRecordIds])),
    provenance: uniqueSources(provenance),
  };
}

function selectFocusedMinutes(
  state: DayAtAGlanceState,
  dayKey: string,
  now: Date,
): DayAtAGlanceFocusedMinutes {
  const dayLogs = state.logs.filter((log) => log.dayKey === dayKey && log.academic !== false && finite(log.minutes) !== 0);
  const sourceIds = uniqueStrings(dayLogs.map((log) => log.id));
  const pomodoroLogIds = uniqueStrings(dayLogs
    .filter((log) => /pomodoro|focus sprint/i.test(`${log.type} ${log.note ?? ""}`))
    .map((log) => log.id));
  const sessions = state.sessions
    .filter((session) => session.dayKey === dayKey)
    .map((session): DayAtAGlanceSession => ({
      id: session.id,
      title: session.title,
      status: session.status,
      elapsedMinutes: finiteNonNegative(sessionElapsedMinutes(session, now)),
      source: session.source,
      link: session.link,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const provenance = [
    ...sourceIds.map((id) => source("study-log", id, "focus")),
    ...sessions.map((session) => source("study-session", session.id, "session-context", session.status)),
  ];
  return {
    value: sanitizedDayTotals(state, dayKey).minutes,
    sourceIds,
    pomodoroLogIds,
    sessions,
    provenance: uniqueSources(provenance),
  };
}

function selectQuestions(state: DayAtAGlanceState, dayKey: string): DayAtAGlanceQuestions {
  const attempts: Array<{ questionId: string; attempt: QuestionAttempt; index: number }> = [];
  for (const question of state.questions) {
    if (questionMappingStatus(question) !== "ready") continue;
    question.attempts.forEach((attempt, index) => {
      if (timestampDay(attempt.at) === dayKey) attempts.push({ questionId: question.id, attempt, index });
    });
  }
  attempts.sort((a, b) => (
    a.attempt.at.localeCompare(b.attempt.at)
    || a.questionId.localeCompare(b.questionId)
    || a.index - b.index
  ));
  const correct = attempts.filter(({ attempt }) => attempt.status === "correct").length;
  const incorrect = attempts.filter(({ attempt }) => attempt.status === "incorrect").length;
  const questionIds = uniqueStrings(attempts.map(({ questionId }) => questionId));
  const provenance = attempts.map(({ questionId, attempt, index }) => source(
    "question-attempt",
    questionId,
    "questions",
    `${attempt.at}#${index}`,
  ));
  return {
    trustedAttempts: attempts.length,
    correct,
    incorrect,
    other: attempts.length - correct - incorrect,
    questionIds,
    sourceIds: questionIds,
    provenance: uniqueSources(provenance),
  };
}

function selectCards(state: DayAtAGlanceState, dayKey: string): DayAtAGlanceCards {
  const sourceIds = uniqueStrings(state.logs
    .filter((log) => log.dayKey === dayKey && log.academic !== false && finite(log.cards) !== 0)
    .map((log) => log.id));
  return {
    reviewed: sanitizedDayTotals(state, dayKey).cards,
    sourceIds,
    provenance: sourceIds.map((id) => source("study-log", id, "cards")),
  };
}

function selectHabits(state: DayAtAGlanceState, dayKey: string, today: string): DayAtAGlanceHabits {
  const items: DayAtAGlanceHabit[] = [];
  for (const habit of state.habits) {
    const entry = latestHabitEntry(state.habitEntries, habit.id, dayKey);
    const started = dayKey >= trackingStartKey(habit, state.habitEntries, today);
    const expectedToday = !habit.archived
      && !habit.examMode
      && started
      && habit.type !== "weekly"
      && habit.type !== "milestone"
      && isScheduledDay(habit, dayKey);
    if (!expectedToday && !entry) continue;
    const sourceIds = uniqueStrings([habit.id, entry?.id].filter(isString));
    const provenance = [
      source("habit", habit.id, "habit"),
      ...(entry ? [source("habit-entry", entry.id, "habit", entry.status)] : []),
    ];
    items.push({
      habitId: habit.id,
      name: habit.name,
      expectedToday,
      status: entry?.status ?? "none",
      value: finiteOptional(entry?.value),
      target: finiteOptional(habit.target),
      unit: cleanText(habit.unit),
      entryId: entry?.id,
      sourceIds,
      provenance,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.habitId.localeCompare(b.habitId));
  const expected = items.filter((item) => item.expectedToday);
  return {
    items,
    expected: expected.length,
    done: items.filter((item) => item.status === "done").length,
    partial: items.filter((item) => item.status === "partial").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    missed: items.filter((item) => item.status === "missed").length,
    unlogged: expected.filter((item) => item.status === "none").length,
    sourceIds: uniqueStrings(items.flatMap((item) => item.sourceIds)),
    provenance: uniqueSources(items.flatMap((item) => item.provenance)),
  };
}

function selectTasks(tasks: Task[], dayKey: string): DayAtAGlanceTasks {
  const completed = tasks
    .filter((task) => task.done && timestampDay(task.completedAt) === dayKey)
    .map(dayTask)
    .sort(compareTasks);
  const open = tasks
    .filter((task) => !task.done && !task.archived && timestampDay(task.created) <= dayKey)
    .map(dayTask)
    .sort(compareTasks);
  const provenance = [
    ...completed.map((task) => source("task", task.id, "task-completed")),
    ...open.map((task) => source("task", task.id, "task-open")),
  ];
  return {
    completed,
    open,
    openBasis: "current-state-created-by-day",
    sourceIds: uniqueStrings([...completed, ...open].map((task) => task.id)),
    provenance: uniqueSources(provenance),
  };
}

function selectEnergy(state: DayAtAGlanceState, dayKey: string): DayAtAGlanceEnergy {
  const result = calculateReadiness({
    date: dayKey,
    factors: state.energyFactors,
    journal: state.journal,
    logs: state.logs,
    tasks: state.tasks,
    dayPlans: state.dayPlans,
    productivityTrackers: state.productivityTrackers,
    energyChecks: state.profile?.energyChecks,
  });
  const journalIds = uniqueStrings([
    result.selfReportedEnergy.source?.startsWith("energy-check:") ? undefined : result.selfReportedEnergy.source,
    ...state.journal
      .filter((entry) => result.possibleSignals.some((signal) => signal.id.startsWith(`journal-signal:${entry.id}:`)))
      .map((entry) => entry.id),
  ].filter(isString));
  const hasProductiveContribution = result.contributions.some((item) => item.id.startsWith(`implicit:productive-work:${dayKey}`));
  const hasMovementContribution = result.contributions.some((item) => item.id.startsWith(`implicit:movement-log:${dayKey}`));
  const trackersById = new Map(state.productivityTrackers.map((tracker) => [tracker.id, tracker]));
  const dayLogIds = state.logs.filter((log) => {
    if (log.dayKey !== dayKey) return false;
    if (hasProductiveContribution && log.productive !== false && finite(log.minutes) > 0) return true;
    if (!hasMovementContribution) return false;
    const tracker = log.trackerId ? trackersById.get(log.trackerId) : undefined;
    const label = `${log.type} ${tracker?.name ?? ""} ${tracker?.category ?? ""}`.toLowerCase();
    return /(gym|workout|exercise|walk|run|movement|health)/.test(label)
      && Math.max(0, finite(log.minutes), finite(log.quantity)) > 0;
  }).map((log) => log.id);
  const factorIds = result.contributions.map((item) => item.factorId).filter(isString);
  const plan = planForDay(state.dayPlans, dayKey);
  const planIds = plan?.outcome && result.contributions.some((item) => item.id.startsWith("implicit:plan-"))
    ? [`day-plan:${dayKey}`]
    : [];
  const carryoverTaskIds = result.contributions.some((item) => item.id.startsWith(`implicit:carryover-work:${dayKey}`))
    ? state.tasks.filter((task) => (
    !task.done
    && !task.archived
    && Boolean(task.due)
    && task.due!.slice(0, 10) <= dayKey
    && (task.carryoverFrom?.length ?? 0) > 0
    )).map((task) => task.id)
    : [];
  const sourceIds = uniqueStrings([
    result.selfReportedEnergy.source,
    ...factorIds,
    ...dayLogIds,
    ...planIds,
    ...carryoverTaskIds,
  ].filter(isString));
  const provenance = [
    ...journalIds.map((id) => source("journal-entry", id, "energy")),
    ...factorIds.map((id) => source("energy-factor", id, "energy")),
    ...dayLogIds.map((id) => source("study-log", id, "energy")),
    ...planIds.map((id) => source("day-plan", id, "energy")),
    ...carryoverTaskIds.map((id) => source("task", id, "energy", "unfinished carryover")),
  ];
  const hasEvidence = Boolean(result.selfReportedEnergy.source)
    || result.contributions.length > 0;
  return {
    hasEvidence,
    selfReported: result.selfReportedEnergy,
    estimatedReadiness: finiteNonNegative(result.estimatedReadiness),
    readinessLabel: result.readinessLabel,
    contributions: result.contributions,
    possibleSignalIds: uniqueStrings(result.possibleSignals.map((signal) => signal.id)),
    sourceIds,
    provenance: uniqueSources(provenance),
  };
}

function selectWins(state: DayAtAGlanceState, dayKey: string, planId: string): DayAtAGlanceWin[] {
  const plan = planForDay(state.dayPlans, dayKey);
  const closeout = latestCloseout(state, dayKey);
  const journal = latestJournal(state, dayKey);
  const wins: DayAtAGlanceWin[] = [];
  for (const text of plan?.wins ?? []) {
    const clean = cleanText(text);
    if (!clean) continue;
    const provenance = [source("day-plan", planId, "win")];
    wins.push({
      text: clean,
      kind: "planned-condition",
      status: plan?.outcome === "won" ? "confirmed" : "planned",
      sourceIds: [planId],
      provenance,
    });
  }
  const completedSummary = cleanText(closeout?.completedSummary);
  if (completedSummary && closeout) {
    const provenance = [source("daily-closeout", closeout.id, "win")];
    wins.push({
      text: completedSummary,
      kind: "closeout-summary",
      status: "reported",
      sourceIds: [closeout.id],
      provenance,
    });
  }
  const journalSummary = cleanText(journal?.today);
  if (journalSummary && journal && journalSummary !== completedSummary) {
    const provenance = [source("journal-entry", journal.id, "win")];
    wins.push({
      text: journalSummary,
      kind: "journal-summary",
      status: "reported",
      sourceIds: [journal.id],
      provenance,
    });
  }
  return wins;
}

function selectUnfinished(input: {
  state: DayAtAGlanceState;
  dayKey: string;
  today: string;
  planId: string;
  targetCompletion: DayAtAGlanceTargetCompletion;
  focusedMinutes: DayAtAGlanceFocusedMinutes;
  habits: DayAtAGlanceHabits;
  tasks: DayAtAGlanceTasks;
}): DayAtAGlanceUnfinishedItem[] {
  const items: DayAtAGlanceUnfinishedItem[] = [];
  const plan = planForDay(input.state.dayPlans, input.dayKey);
  if (plan?.intention.trim() && (
    plan.outcome === "partial"
    || plan.outcome === "missed"
    || (!plan.outcome && input.dayKey < input.today)
  )) {
    const status = plan.outcome ?? "unreviewed";
    const provenance = [source("day-plan", input.planId, "unfinished", status)];
    items.push({
      id: `day-plan:${input.dayKey}`,
      kind: "day-plan",
      label: plan.intention.trim(),
      status,
      sourceIds: [input.planId],
      provenance,
    });
  }
  for (const requirement of input.targetCompletion.requirements) {
    if (input.dayKey > input.today) continue;
    if (!requirement.eligible || ["met", "not-eligible", "unavailable"].includes(requirement.status)) continue;
    const sourceIds = uniqueStrings([requirement.id, ...requirement.sourceRecordIds]);
    const provenance = [
      source("daily-requirement", requirement.id, "unfinished", requirement.status),
      ...requirement.contributions.map((contribution) => ({
        ...targetContributionSource(contribution),
        role: "unfinished" as const,
      })),
    ];
    items.push({
      id: `target:${requirement.id}`,
      kind: "target",
      label: requirement.label,
      status: requirement.status,
      sourceIds,
      provenance: uniqueSources(provenance),
    });
  }
  for (const session of input.focusedMinutes.sessions) {
    const capture = input.state.sessions.find((item) => item.id === session.id)?.capture;
    const incompleteCapture = session.status === "completed"
      && Boolean(capture)
      && capture?.outcome !== "completed";
    if (session.status !== "active" && session.status !== "paused" && !incompleteCapture) continue;
    const status = session.status === "completed" ? capture?.outcome ?? "partial" : session.status;
    const provenance = [source("study-session", session.id, "unfinished", status)];
    items.push({
      id: `session:${session.id}`,
      kind: "session",
      label: session.title,
      status,
      sourceIds: [session.id],
      provenance,
    });
  }
  for (const habit of input.habits.items) {
    if (input.dayKey > input.today) continue;
    if (!habit.expectedToday || habit.status === "done" || habit.status === "skipped") continue;
    const status = habit.status === "none" ? "unlogged" : habit.status;
    const provenance = habit.provenance.map((item) => ({ ...item, role: "unfinished" as const }));
    items.push({
      id: `habit:${habit.habitId}`,
      kind: "habit",
      label: habit.name,
      status,
      sourceIds: habit.sourceIds,
      provenance,
    });
  }
  for (const task of input.tasks.open) {
    const provenance = [source("task", task.id, "unfinished", task.due ? `due ${task.due}` : "open")];
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      label: task.title,
      status: task.due && task.due.slice(0, 10) <= input.dayKey ? "due-or-overdue" : "open",
      sourceIds: [task.id],
      provenance,
    });
  }
  const closeout = latestCloseout(input.state, input.dayKey);
  const remaining = cleanText(closeout?.remainingSummary);
  if (closeout && remaining) {
    const provenance = [source("daily-closeout", closeout.id, "unfinished")];
    items.push({
      id: `closeout:${closeout.id}:remaining`,
      kind: "closeout",
      label: remaining,
      status: "reported-remaining",
      sourceIds: [closeout.id],
      provenance,
    });
  }
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function latestCloseout(state: DayAtAGlanceState, dayKey: string) {
  return state.closeouts
    .filter((entry) => entry.dayKey === dayKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
}

function latestJournal(state: DayAtAGlanceState, dayKey: string) {
  return state.journal
    .filter((entry) => entryDayKey(entry) === dayKey)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
}

function latestHabitEntry(entries: NoctyriumState["habitEntries"], habitId: string, dayKey: string) {
  return entries
    .filter((entry) => entry.habitId === habitId && entry.date === dayKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

function sanitizedDayTotals(state: Pick<DayAtAGlanceState, "logs">, dayKey: string) {
  const totals = dayTotals(state.logs.map((log) => ({
    ...log,
    minutes: finite(log.minutes),
    cards: finite(log.cards),
  })), dayKey);
  return {
    minutes: finiteNonNegative(totals.minutes),
    cards: finiteNonNegative(totals.cards),
  };
}

function targetContributionSource(contribution: TargetContribution): DayAtAGlanceSourceRef {
  const sourceType: DayAtAGlanceSourceType = contribution.sourceRecord === "study-log"
    ? "study-log"
    : contribution.sourceRecord === "habit-entry"
      ? "habit-entry"
      : contribution.sourceRecord === "daily-closeout"
        ? "daily-closeout"
        : "manual-contribution";
  return source(sourceType, contribution.sourceRecordId, "target", contribution.matchedBy);
}

function source(
  sourceType: DayAtAGlanceSourceType,
  sourceId: string,
  role: DayAtAGlanceSourceRole,
  detail?: string,
): DayAtAGlanceSourceRef {
  return { sourceType, sourceId, role, ...(detail ? { detail } : {}) };
}

function uniqueSources(sources: DayAtAGlanceSourceRef[]): DayAtAGlanceSourceRef[] {
  return [...new Map(sources.map((item) => [
    `${item.sourceType}\u0000${item.sourceId}\u0000${item.role}\u0000${item.detail ?? ""}`,
    item,
  ])).values()].sort((a, b) => (
    a.sourceType.localeCompare(b.sourceType)
    || a.sourceId.localeCompare(b.sourceId)
    || a.role.localeCompare(b.role)
    || (a.detail ?? "").localeCompare(b.detail ?? "")
  ));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function dayTask(task: Task): DayAtAGlanceTask {
  return {
    id: task.id,
    title: task.title,
    due: task.due,
    scope: task.scope,
  };
}

function compareTasks(a: DayAtAGlanceTask, b: DayAtAGlanceTask): number {
  return (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99")
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

function timestampDay(value: string | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : localDateKey(parsed);
}

function cleanText(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean || undefined;
}

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteNonNegative(value: unknown): number {
  return Math.max(0, finite(value));
}

function finiteOptional(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return finiteNonNegative(value);
}

function clampRatio(value: unknown): number {
  return Math.max(0, Math.min(1, finite(value)));
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
