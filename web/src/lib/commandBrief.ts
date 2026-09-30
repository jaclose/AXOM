// ===========================================================================
// Command Brief — the engine behind the primary dashboard section. Answers:
// "Given my deadlines, energy, unfinished work, recent performance, and
// available time, what should I do next?" with ONE mode, ONE next best move,
// ONE fallback, and a factual delta since yesterday.
//
// Everything is transparent rules over persisted data (pure + testable). The
// AI layer (lib/ai) may later PROPOSE a brief through the same schema, but a
// proposal never mutates the plan without user review.
// ===========================================================================
import type { Course, DayPlan, Habit, HabitEntry, NoctyriumState, Task, TrackerItem } from "./types";
import { sessionElapsedMinutes, type StudySession, type SessionLink } from "./sessions";
import type { DailyCloseout } from "./closeout";
import { isQuestionKind } from "./tracker";
import { rankTrackerItems, trackerStudyAction } from "./recommendationFactors";
import type { StudyWorkflowPreferences } from "./studyPreferences";
import { dayTotals, isoDate } from "./scoring";
import { pickFocusExam, daysUntilExam, EXAM_META } from "./examPlan";
import { previousCloseout } from "./closeout";
import type { QuestionRecord } from "./questions";
import { dueQuestions, questionMappingStatus, weakTopics } from "./questions";
import type { AnkiCard } from "./ankiCards";
import { dueCards } from "./ankiCards";
import type { QuestionSet, SourceDocument } from "./library";
import { EDUCATION_TRACKS } from "./tracks";
import { ACADEMIC_TEMPLATE_COURSES } from "./experience";
import { normalizeTrackerPath, trackerItemKey } from "./pathUtils";
import { entryFor, isScheduledDay, trackingStartKey } from "./habits";
import type { DailyRequirementResult, DailySuccessResult } from "./dailySuccess";
import type { ReadinessResult } from "./energy";

export type BriefMode = "maintain" | "catch-up" | "recovery" | "sprint" | "exam-week";

export const MODE_LABEL: Record<BriefMode, string> = {
  maintain: "Maintain",
  "catch-up": "Catch-Up",
  recovery: "Recovery",
  sprint: "Sprint",
  "exam-week": "Exam Week",
};

export interface NextBestMove {
  title: string;
  link: SessionLink;
  estimatedMinutes: number;
  resources: string[];
  reason: string;
  expectedOutcome: string;
  studyPlan?: { summary: string; sources: string[] };
  /** Inspectable, deterministic evidence. The weights sum to score. */
  score?: number;
  contributions?: BriefRecommendationContribution[];
  source: "command-brief";
}

export interface BriefRecommendationContribution {
  id: string;
  label: string;
  weight: number;
  sourceLabel: string;
}

export interface RankedBriefCandidate extends NextBestMove {
  candidateId: string;
  score: number;
  contributions: BriefRecommendationContribution[];
}

export interface MinimumViableWin {
  title: string;
  estimatedMinutes: number;
  reason: string;
  link: SessionLink;
}

export interface BriefChange {
  label: string;
  value: string;
  tone: "good" | "neutral" | "watch";
}

export interface BriefSignals {
  daysSinceLastStudy: number;
  missedDaysLast7: number;
  overdueTasks: number;
  carriedTasks: number;
  openTasks: number;
  backlogScore: number; // 0..100 composite
  examDaysAway: number | null;
  examLabel?: string;
  reviewFlagged: number;
  dueQuestionCount: number;
  dueCardCount: number;
  yesterdayMinutes: number;
  todayMinutes: number;
}

export interface CommandBrief {
  mode: BriefMode;
  modeReason: string;
  move: NextBestMove;
  minimumViableWin: MinimumViableWin;
  changes: BriefChange[];
  signals: BriefSignals;
  recoverySuggested: boolean;
  generatedFor: string; // dayKey
  source: "rules" | "ai-reviewed";
}

// --- signal extraction ------------------------------------------------------

export interface BriefStateSlice {
  tasks: Task[];
  tracker: TrackerItem[];
  /** Active primary Course Tracker scopes (lib/trackerFocus). */
  primaryScopes?: readonly string[];
  courses?: Course[];
  studyWorkflow?: StudyWorkflowPreferences;
  logs: NoctyriumState["logs"];
  boardPrep: NoctyriumState["boardPrep"];
  activeDayKey: string;
  sessions: StudySession[];
  closeouts: DailyCloseout[];
  questions: QuestionRecord[];
  ankiCards: AnkiCard[];
  dayPlans?: DayPlan[];
  dailySuccess?: DailySuccessResult;
  habits?: Habit[];
  habitEntries?: HabitEntry[];
  /** Readiness is optional and influences the brief only when backed by a
   * self-report or a user-confirmed factor. The neutral baseline is ignored. */
  readiness?: ReadinessResult;
}

export interface BriefEvidenceState {
  courses: Course[];
  tracker: TrackerItem[];
  studyWorkflow?: StudyWorkflowPreferences;
  logs: NoctyriumState["logs"];
  tasks: Task[];
  questions: QuestionRecord[];
  documents: SourceDocument[];
  questionSets: QuestionSet[];
  /** Explicit local study day. Without it, historical records are never
   * promoted to a misleading "current" signal. */
  activeDayKey?: string;
  dayPlans?: DayPlan[];
  sessions?: StudySession[];
  dailySuccess?: DailySuccessResult;
  habits?: Habit[];
  habitEntries?: HabitEntry[];
  readiness?: ReadinessResult;
}

export interface BriefEvidenceCriterion {
  ready: boolean;
  count: number;
  required: number;
  label: string;
  explanation: string;
}

export interface CommandBriefEvidenceAssessment {
  ready: boolean;
  confidence: "none" | "limited" | "strong";
  activation: "learning" | "automatic" | "manual";
  canActivateManually: boolean;
  manualActivationReason: string;
  evidenceCount: number;
  actionableCount: number;
  currentSignalCount: number;
  rankedEvidence: BriefReadinessEvidence[];
  starter: BriefStarterState | null;
  workload: BriefEvidenceCriterion;
  activeItems: BriefEvidenceCriterion;
  activity: BriefEvidenceCriterion;
}

export interface CommandBriefEvidenceOptions {
  /** Opt into a deliberately limited-confidence brief. This is ignored only
   * when the workspace still contains no user-backed evidence at all. */
  manualActivation?: boolean;
  now?: Date;
}

export interface BriefReadinessEvidence extends BriefRecommendationContribution {
  kind: "actionable" | "current-context" | "workload";
  count: number;
}

export type BriefStarterDestination = "tracker" | "questions" | "tasks" | "productivity";

export interface BriefStarterState {
  id: "empty" | "limited-action" | "course-needs-items" | "source-needs-review" | "context-needs-target";
  title: string;
  explanation: string;
  actionLabel: string;
  destination: BriefStarterDestination;
}

type EvidenceOrigin = "seed" | "template" | "user" | "import";

const STARTER_TASK_TITLES = new Set([
  "create today's standup",
  "add your real lecture/DLA/PQ list",
  "save progress from settings",
].map(normalizeEvidenceText));

const TEMPLATE_COURSE_FINGERPRINTS = new Set([
  ...EDUCATION_TRACKS.flatMap((track) => track.terms.flatMap((term) => term.courses.map(courseFingerprint))),
  // The pre-Wave 2 SGU seed map (lib/experience.ts) still lives in older workspaces and in makeSeed().
  ...ACADEMIC_TEMPLATE_COURSES.map(courseFingerprint),
]);

const TEMPLATE_TRACKER_BASELINES = new Map<string, { passes: number; ankiPasses: number }>();
for (const row of EDUCATION_TRACKS.flatMap((track) => track.trackerRows)) {
  TEMPLATE_TRACKER_BASELINES.set(
    trackerFingerprint(row),
    { passes: 0, ankiPasses: 0 },
  );
}
// The original SGU seed includes two additional illustrative rows with one
// pass already applied. Their shipped progress is presentation, not evidence.
TEMPLATE_TRACKER_BASELINES.set(
  trackerFingerprint({
    path: "Term 2/BPM 501/NB3/Lectures",
    label: "Example lecture: Sleep and biological rhythms",
    kind: "Lecture",
  }),
  { passes: 1, ankiPasses: 1 },
);
TEMPLATE_TRACKER_BASELINES.set(
  trackerFingerprint({
    path: "Term 2/BPM 501/NB3/PQs",
    label: "Example PQ set: Psych foundations",
    kind: "PQ",
  }),
  { passes: 1, ankiPasses: 0 },
);

/**
 * Decide whether the brief has enough user evidence to make a recommendation.
 * Seed/template structure can teach the UI, but it cannot diagnose a
 * workload. Automatic activation needs either two rankable pieces of work or
 * one rankable item plus same-day context. Any real evidence can be used
 * through an explicit limited-confidence override; a completely empty/seeded
 * workspace cannot. The result includes deterministic evidence and starter
 * guidance so the UI never has to recreate this policy.
 */
export function assessCommandBriefEvidence(
  state: BriefEvidenceState,
  options: CommandBriefEvidenceOptions = {},
): CommandBriefEvidenceAssessment {
  const meaningfulTracker = rankMeaningfulTracker(state, options.now).map(({ item }) => item);
  const actionableTasks = state.tasks.filter(isActionableTask);
  const dueTrustedQuestions = trustedDueQuestions(state.questions, options.now ?? new Date());
  const realCourses = state.courses.filter(isRealWorkloadCourse).length;
  const importedSourceKeys = new Set<string>();
  for (const document of state.documents) importedSourceKeys.add(`document:${document.id}`);
  for (const set of state.questionSets) importedSourceKeys.add(`set:${set.id}`);
  for (const question of state.questions) {
    const sourceKey = question.sourceDocumentId
      ? `document:${question.sourceDocumentId}`
      : question.setId
        ? `set:${question.setId}`
        : question.sourceFile?.name
          ? `file:${normalizeEvidenceText(question.sourceFile.name)}`
          : ["pasted", "screenshot", "image", "pdf", "imported"].includes(question.source)
            ? `question-source:${question.id}`
            : null;
    if (sourceKey) importedSourceKeys.add(sourceKey);
  }
  // Question records are user-backed in the current product (there is no
  // shipped question seed). Mapping trust still controls whether one can be
  // ranked; unresolved records only justify limited/manual activation.
  const savedQuestionCount = state.questions.length;
  const scheduledTargets = unfinishedDailyTargets(state.dailySuccess, state.activeDayKey);
  const targetHabitIds = linkedHabitIds(scheduledTargets);
  const dueHabits = dueRecurringHabits(
    state.habits ?? [],
    state.habitEntries ?? [],
    state.activeDayKey,
    targetHabitIds,
  );
  const workloadCount = realCourses
    + importedSourceKeys.size
    + meaningfulTracker.length
    + actionableTasks.length
    + savedQuestionCount
    + scheduledTargets.length
    + dueHabits.length;

  const activeItemCount = meaningfulTracker.length
    + actionableTasks.length
    + dueTrustedQuestions.length
    + scheduledTargets.length
    + dueHabits.length;
  const currentLogs = state.activeDayKey ? state.logs.filter((log) => (
    log.dayKey === state.activeDayKey
    && (
    Math.max(0, Number(log.minutes) || 0) > 0
    || Math.max(0, Number(log.cards) || 0) > 0
    || Math.max(0, Number(log.quantity) || 0) > 0
    )
  )) : [];
  const currentPractice = state.activeDayKey ? state.questions.filter((question) => (
    question.attempts.some((attempt) => timestampFallsOnDay(attempt.at, state.activeDayKey!))
    || timestampFallsOnDay(question.attemptedAt, state.activeDayKey!)
  )) : [];
  const currentSessions = state.activeDayKey ? (state.sessions ?? []).filter((session) => (
    session.dayKey === state.activeDayKey
    && session.title.trim().length > 0
    && session.status !== "abandoned"
    && (session.segments.length > 0 || session.quickLogs.length > 0 || session.status === "active" || session.status === "paused")
  )) : [];
  const currentPlan = state.activeDayKey ? (state.dayPlans ?? []).find((plan) => (
    plan.dayKey === state.activeDayKey
    && plan.outcome !== "won"
    && (
      plan.intention.trim().length > 0
      || plan.priority?.trim().length
      || plan.wins.some((win) => win.trim().length > 0)
      || (Number.isFinite(plan.expectedStudyMinutes) && (plan.expectedStudyMinutes ?? 0) > 0)
    )
  )) : undefined;
  const readinessGrounded = groundedReadinessScore(state.readiness) !== undefined;
  const signalCount = currentLogs.length
    + currentPractice.length
    + currentSessions.length
    + (currentPlan ? 1 : 0)
    + (readinessGrounded ? 1 : 0);
  const evidenceCount = workloadCount + signalCount;
  const automaticReady = activeItemCount >= 2 || (activeItemCount >= 1 && signalCount >= 1);
  const canActivateManually = evidenceCount > 0;
  const manuallyActivated = !automaticReady && options.manualActivation === true && canActivateManually;
  const ready = automaticReady || manuallyActivated;

  const rankedEvidence = buildReadinessEvidence({
    actionableTasks: actionableTasks.length,
    meaningfulTracker: meaningfulTracker.length,
    dueTrustedQuestions: dueTrustedQuestions.length,
    scheduledTargets: scheduledTargets.length,
    dueHabits: dueHabits.length,
    currentLogs: currentLogs.length,
    currentPractice: currentPractice.length,
    currentSessions: currentSessions.length,
    currentPlan: currentPlan ? 1 : 0,
    currentReadiness: readinessGrounded ? 1 : 0,
    realCourses,
    importedSources: importedSourceKeys.size,
    savedQuestions: savedQuestionCount,
  });

  const workload: BriefEvidenceCriterion = {
    ready: workloadCount >= 1,
    count: workloadCount,
    required: 1,
    label: "User-backed evidence",
    explanation: "Add or import real work; shipped examples never count.",
  };
  const activeItems: BriefEvidenceCriterion = {
    ready: activeItemCount >= 1,
    count: activeItemCount,
    required: 1,
    label: "Actionable work",
    explanation: "Tasks, active tracker items, and trusted due questions can become the next action.",
  };
  const activity: BriefEvidenceCriterion = {
    ready: signalCount >= 1,
    count: signalCount,
    required: 1,
    label: "Today’s context",
    explanation: "Today’s intention, activity, practice, or focus session helps AXOM rank the work.",
  };
  return {
    ready,
    confidence: automaticReady ? "strong" : canActivateManually ? "limited" : "none",
    activation: automaticReady ? "automatic" : manuallyActivated ? "manual" : "learning",
    canActivateManually,
    manualActivationReason: automaticReady
      ? "AXOM has enough supported evidence to rank a next action."
      : canActivateManually
        ? "AXOM can start from the evidence available, but confidence is limited and the first result may be a setup step."
        : "Add real work, log today’s activity, or write today’s intention before using Command Brief.",
    evidenceCount,
    actionableCount: activeItemCount,
    currentSignalCount: signalCount,
    rankedEvidence,
    starter: ready ? null : deriveBriefStarterState({
      actionableTasks: actionableTasks.length,
      meaningfulTracker: meaningfulTracker.length,
      dueTrustedQuestions: dueTrustedQuestions.length,
      scheduledTargets: scheduledTargets.length,
      dueHabits: dueHabits.length,
      realCourses,
      importedSources: importedSourceKeys.size,
      savedQuestions: savedQuestionCount,
      currentSignals: signalCount,
    }),
    workload,
    activeItems,
    activity,
  };
}

interface ReadinessEvidenceCounts {
  actionableTasks: number;
  meaningfulTracker: number;
  dueTrustedQuestions: number;
  scheduledTargets: number;
  dueHabits: number;
  currentLogs: number;
  currentPractice: number;
  currentSessions: number;
  currentPlan: number;
  currentReadiness: number;
  realCourses: number;
  importedSources: number;
  savedQuestions: number;
}

function buildReadinessEvidence(counts: ReadinessEvidenceCounts): BriefReadinessEvidence[] {
  const facts: BriefReadinessEvidence[] = [];
  const add = (
    id: string,
    label: string,
    count: number,
    weight: number,
    sourceLabel: string,
    kind: BriefReadinessEvidence["kind"],
  ) => {
    if (count > 0) facts.push({ id, label, count, weight: weight + Math.min(count, 10), sourceLabel, kind });
  };
  add("open-tasks", "Open user tasks", counts.actionableTasks, 80, "Tasks", "actionable");
  add("active-tracker", "Active study items", counts.meaningfulTracker, 78, "Course Tracker", "actionable");
  add("due-questions", "Trusted reviews due", counts.dueTrustedQuestions, 76, "Question Bank", "actionable");
  add("scheduled-targets", "Scheduled targets still open", counts.scheduledTargets, 74, "Today’s targets", "actionable");
  add("due-habits", "Recurring habits due today", counts.dueHabits, 72, "Habits", "actionable");
  add("focus-session", "Today’s focus session", counts.currentSessions, 48, "Focus timer", "current-context");
  add("activity-log", "Activity logged today", counts.currentLogs, 45, "Productivity", "current-context");
  add("question-practice", "Questions practised today", counts.currentPractice, 43, "Question Bank", "current-context");
  add("day-intention", "Today’s intention", counts.currentPlan, 40, "Today’s plan", "current-context");
  add("readiness", "Grounded readiness context", counts.currentReadiness, 38, "Journal and check-in", "current-context");
  add("courses", "User courses", counts.realCourses, 24, "Course Tracker", "workload");
  add("imported-sources", "Saved or imported sources", counts.importedSources, 22, "Source Library", "workload");
  add("saved-questions", "Saved practice questions", counts.savedQuestions, 20, "Question Bank", "workload");
  return facts.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

function deriveBriefStarterState(counts: Pick<
  ReadinessEvidenceCounts,
  "actionableTasks" | "meaningfulTracker" | "dueTrustedQuestions" | "scheduledTargets" | "dueHabits" | "realCourses" | "importedSources" | "savedQuestions"
> & { currentSignals: number }): BriefStarterState {
  if (counts.actionableTasks + counts.meaningfulTracker + counts.dueTrustedQuestions + counts.scheduledTargets + counts.dueHabits > 0) {
    const destination: BriefStarterDestination = counts.actionableTasks > 0
      ? "tasks"
      : counts.meaningfulTracker > 0
        ? "tracker"
        : counts.dueTrustedQuestions > 0
          ? "questions"
          : "productivity";
    return {
      id: "limited-action",
      title: "One supported next step is available",
      explanation: "Use Command Brief now with limited confidence, or add today’s context so AXOM can rank it more strongly.",
      actionLabel: destination === "tasks"
        ? "Review tasks"
        : destination === "tracker"
          ? "Review study items"
          : destination === "questions"
            ? "Review due questions"
            : "Review today’s targets",
      destination,
    };
  }
  if (counts.importedSources > 0 || counts.savedQuestions > 0) {
    return {
      id: "source-needs-review",
      title: "Turn saved material into a next step",
      explanation: "Your source or questions are saved, but no trusted review or concrete task is ready to rank yet.",
      actionLabel: "Open Question Bank",
      destination: "questions",
    };
  }
  if (counts.realCourses > 0) {
    return {
      id: "course-needs-items",
      title: "Add the first course item",
      explanation: "The course is real, but Command Brief needs a lecture, assignment, or other active item to name the next move.",
      actionLabel: "Open Course Tracker",
      destination: "tracker",
    };
  }
  if (counts.currentSignals > 0) {
    return {
      id: "context-needs-target",
      title: "Connect today’s signal to real work",
      explanation: "AXOM can see today’s context, but there is no concrete task or study item to rank yet.",
      actionLabel: "Choose a target",
      destination: "productivity",
    };
  }
  return {
    id: "empty",
    title: "Add one real piece of work",
    explanation: "A task, course item, question source, activity, or intention is enough to begin. Shipped examples do not count.",
    actionLabel: "Open Course Tracker",
    destination: "tracker",
  };
}

function timestampFallsOnDay(value: string | undefined, dayKey: string): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && isoDate(parsed) === dayKey;
}

function recordOrigin(value: unknown): EvidenceOrigin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const origin = (value as { origin?: unknown }).origin;
  return origin === "seed" || origin === "template" || origin === "user" || origin === "import"
    ? origin
    : undefined;
}

function isRealWorkloadCourse(course: Course): boolean {
  const origin = recordOrigin(course);
  if (origin === "user" || origin === "import") return true;
  return !TEMPLATE_COURSE_FINGERPRINTS.has(courseFingerprint(course));
}

function isMeaningfulTrackerItem(item: TrackerItem): boolean {
  const origin = recordOrigin(item);
  if (origin === "user" || origin === "import") return true;
  const baseline = TEMPLATE_TRACKER_BASELINES.get(trackerFingerprint(item));
  if (baseline) return item.passes > baseline.passes || item.ankiPasses > baseline.ankiPasses;
  if (/^example(?:[:\s]|$)/i.test(item.label.trim())) return item.passes > 0 || item.ankiPasses > 0;
  return true;
}

function rankMeaningfulTracker(
  state: Pick<BriefStateSlice, "tracker" | "courses" | "studyWorkflow" | "primaryScopes">,
  now?: Date,
) {
  return rankTrackerItems(state.tracker.filter(isMeaningfulTrackerItem), {
    preferences: state.studyWorkflow,
    courses: state.courses,
    primaryScopes: state.primaryScopes,
    now,
  });
}

function isActionableTask(task: Task): boolean {
  if (task.done || task.archived || !task.title.trim()) return false;
  const origin = recordOrigin(task);
  if (origin === "seed" || origin === "template") return false;
  return !STARTER_TASK_TITLES.has(normalizeEvidenceText(task.title));
}

function trustedDueQuestions(questions: QuestionRecord[], now: Date): QuestionRecord[] {
  return dueQuestions(questions, now).filter((question) => questionMappingStatus(question) === "ready");
}

function unfinishedDailyTargets(result: DailySuccessResult | undefined, dayKey?: string): DailyRequirementResult[] {
  if (!result || (dayKey && result.dayKey !== dayKey)) return [];
  return result.requirements.filter((row) => (
    row.eligible
    && row.status !== "met"
    && row.status !== "not-eligible"
    && row.status !== "unavailable"
  ));
}

function linkedHabitIds(targets: DailyRequirementResult[]): Set<string> {
  return new Set(targets.flatMap((row) => (
    row.requirement.source.kind === "habit" ? [row.requirement.source.habitId] : []
  )));
}

interface DueHabit {
  habit: Habit;
  entry?: HabitEntry;
}

/**
 * Return only habits that have a defensible daily obligation. Flexible weekly
 * habits and one-time milestones are deliberately excluded: without a chosen
 * weekday AXOM cannot honestly call either one "due today".
 */
function dueRecurringHabits(
  habits: Habit[],
  entries: HabitEntry[],
  dayKey: string | undefined,
  excludedHabitIds: Set<string> = new Set(),
): DueHabit[] {
  if (!dayKey) return [];
  return habits
    .filter((habit) => (
      !habit.archived
      && !excludedHabitIds.has(habit.id)
      && habit.type !== "weekly"
      && habit.type !== "milestone"
      && dayKey >= trackingStartKey(habit, entries, dayKey)
      && isScheduledDay(habit, dayKey)
    ))
    .map((habit) => ({ habit, entry: entryFor(entries, habit.id, dayKey) }))
    .filter(({ entry }) => entry?.status !== "done" && entry?.status !== "skipped")
    .sort((a, b) => a.habit.id.localeCompare(b.habit.id));
}

function groundedReadinessScore(readiness: ReadinessResult | undefined): number | undefined {
  if (!readiness) return undefined;
  if (readiness.selfReportedEnergy.source) return readiness.selfReportedEnergy.score;
  if (readiness.contributions.some((item) => item.userConfirmed)) return readiness.estimatedReadiness;
  return undefined;
}

function courseFingerprint(course: Pick<Course, "code" | "name" | "modules"> | { code: string; name: string; modules: string[] }): string {
  const modules = course.modules.map((module) => (
    typeof module === "string" ? module : module.name
  ));
  return [course.code, course.name, ...modules].map(normalizeEvidenceText).join("\u001f");
}

function trackerFingerprint(item: Pick<TrackerItem, "path" | "label" | "kind">): string {
  return `${trackerItemKey(normalizeTrackerPath(item.path), item.label)}::${item.kind}`;
}

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function previousDayKey(key: string, back = 1): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() - back);
  return isoDate(d);
}

export function deriveSignals(s: BriefStateSlice, now: Date = new Date()): BriefSignals {
  const today = s.activeDayKey;
  const yesterday = previousDayKey(today);

  // Study days: any day with academic minutes or cards logged.
  const activeDays = new Set(
    s.logs.filter((l) => l.academic !== false && (l.minutes > 0 || l.cards > 0)).map((l) => l.dayKey),
  );
  let daysSinceLastStudy = 0;
  let missedDaysLast7 = 0;
  // A workspace with no study history has no evidence of missed study days.
  // Treating absence of history as 30 inactive days made first-use workspaces
  // enter Recovery before the user had logged anything.
  const priorActiveDays = [...activeDays].filter((key) => key < today).sort();
  if (!activeDays.has(today) && priorActiveDays.length > 0) {
    for (let back = 1; back <= 30; back++) {
      if (activeDays.has(previousDayKey(today, back))) break;
      daysSinceLastStudy = back;
    }
  }
  if (priorActiveDays.length > 0) {
    const trackingFloor = priorActiveDays[0];
    for (let back = 1; back <= 7; back++) {
      const key = previousDayKey(today, back);
      if (key >= trackingFloor && !activeDays.has(key)) missedDaysLast7++;
    }
  }

  const open = s.tasks.filter(isActionableTask);
  const overdueTasks = open.filter((t) => t.due && t.due < today).length;
  const carriedTasks = open.filter((t) => (t.carryoverFrom?.length ?? 0) > 0).length;

  const activeTracker = rankMeaningfulTracker(s, now).map(({ item }) => item);
  const reviewFlagged = activeTracker.filter((t) => t.yield === "review").length;
  const behindTracker = activeTracker.length;

  const examId = pickFocusExam(s.boardPrep, today);
  const examPrep = examId ? s.boardPrep?.[examId] : undefined;
  const examDaysAway = examPrep ? daysUntilExam(examPrep.examDate, today) : null;

  const backlogScore = Math.min(100, Math.round(
    overdueTasks * 12 + carriedTasks * 8 + reviewFlagged * 6 + Math.min(behindTracker, 40) * 0.5 + missedDaysLast7 * 6,
  ));

  return {
    daysSinceLastStudy,
    missedDaysLast7,
    overdueTasks,
    carriedTasks,
    openTasks: open.length,
    backlogScore,
    examDaysAway,
    examLabel: examId ? EXAM_META[examId].label : undefined,
    reviewFlagged,
    dueQuestionCount: trustedDueQuestions(s.questions, now).length,
    dueCardCount: dueCards(s.ankiCards, now).length,
    yesterdayMinutes: dayTotals(s.logs, yesterday).minutes,
    todayMinutes: dayTotals(s.logs, today).minutes,
  };
}

// --- mode -------------------------------------------------------------------

export function deriveMode(
  signals: BriefSignals,
  closeoutPreference?: "auto" | BriefMode,
): { mode: BriefMode; reason: string } {
  // A closeout choice for "tomorrow" wins — the user decided last night.
  if (closeoutPreference && closeoutPreference !== "auto") {
    return { mode: closeoutPreference, reason: "You chose this mode in yesterday's closeout. Change it any time." };
  }

  const { examDaysAway, examLabel, backlogScore, missedDaysLast7, daysSinceLastStudy, overdueTasks } = signals;
  const exam = examLabel ?? "your exam";

  if (examDaysAway !== null && examDaysAway >= 0 && examDaysAway <= 3) {
    return {
      mode: "exam-week",
      reason: `${exam} is ${examDaysAway === 0 ? "today" : `${examDaysAway} day${examDaysAway === 1 ? "" : "s"} away`}. Focus narrows to highest-yield review and question work — nothing new.`,
    };
  }
  if (examDaysAway !== null && examDaysAway > 3 && examDaysAway <= 7 && backlogScore >= 30) {
    return {
      mode: "sprint",
      reason: `${exam} is ${examDaysAway} days away and unfinished work needs a narrower plan. Short, prioritized pushes beat completeness now.`,
    };
  }
  if (daysSinceLastStudy >= 3 || (missedDaysLast7 >= 3 && backlogScore >= 40)) {
    return {
      mode: "recovery",
      reason: daysSinceLastStudy >= 3
        ? `No study logged for ${daysSinceLastStudy} days. That happens — the plan below restarts small instead of trying to repay everything at once.`
        : `${missedDaysLast7} of the last 7 days had no study and work has stacked up. Restart small; consistency first, volume later.`,
    };
  }
  if (backlogScore >= 30 || overdueTasks >= 2) {
    return {
      mode: "catch-up",
      reason: overdueTasks > 0
        ? `${overdueTasks} overdue task${overdueTasks === 1 ? " needs" : "s need"} attention. Today prioritizes the oldest high-value work without trying to clear everything at once.`
        : "Several active review items need attention. Today prioritizes the strongest supported repair without trying to clear everything at once.",
    };
  }
  return {
    mode: "maintain",
    reason: "Workload is stable and nothing major is overdue. Keep the rhythm: steady passes, questions, and reviews.",
  };
}

// --- next best move ---------------------------------------------------------

const MODE_MINUTES: Record<BriefMode, number> = {
  maintain: 45,
  "catch-up": 50,
  recovery: 25,
  sprint: 40,
  "exam-week": 45,
};

export function deriveNextBestMove(s: BriefStateSlice, mode: BriefMode, _signals: BriefSignals, now: Date = new Date()): NextBestMove {
  const [top] = rankCommandBriefCandidates(s, mode, now);
  if (top) return top;

  return {
    title: "Set up your course tracker",
    link: { kind: "free", label: "Course Tracker setup" },
    estimatedMinutes: 15,
    resources: ["Course Tracker → bulk import"],
    reason: "There is no tracked work yet, so the brief has nothing to rank. Fifteen minutes of setup makes every future brief specific.",
    expectedOutcome: "Tomorrow's brief names a real lecture, not a setup step.",
    source: "command-brief",
  };
}

function evidence(id: string, label: string, weight: number, sourceLabel: string): BriefRecommendationContribution {
  return { id, label, weight, sourceLabel };
}

function candidateScore(contributions: BriefRecommendationContribution[]): number {
  return contributions.reduce((total, item) => total + item.weight, 0);
}

interface BriefRankingContext {
  dayPlan?: DayPlan;
  liveSession?: StudySession;
  availableMinutes?: number;
  readinessScore?: number;
  recentSessions: StudySession[];
  now: Date;
}

function linksMatch(left: SessionLink | undefined, right: SessionLink | undefined): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.id || right.id) return Boolean(left.id && right.id && left.id === right.id);
  return normalizeEvidenceText(left.label) === normalizeEvidenceText(right.label);
}

function candidateMatchesText(candidate: Pick<RankedBriefCandidate, "title" | "link">, value: string): boolean {
  const normalized = normalizeEvidenceText(value);
  return Boolean(normalized) && [candidate.title, candidate.link.label]
    .some((label) => normalizeEvidenceText(label) === normalized);
}

function addCandidateEvidence(
  candidate: RankedBriefCandidate,
  contribution: BriefRecommendationContribution,
): void {
  if (candidate.contributions.some((item) => item.id === contribution.id)) return;
  candidate.contributions.push(contribution);
  candidate.score = candidateScore(candidate.contributions);
}

function contextualizeCandidate(
  candidate: RankedBriefCandidate,
  context: BriefRankingContext,
): RankedBriefCandidate {
  const contributions = [...candidate.contributions];
  const add = (item: BriefRecommendationContribution) => {
    if (!contributions.some((existing) => existing.id === item.id)) contributions.push(item);
  };
  const priority = context.dayPlan?.priority?.trim() ?? "";
  const intention = context.dayPlan?.intention.trim() ?? "";
  const liveMatch = linksMatch(candidate.link, context.liveSession?.link);

  if (priority && candidateMatchesText(candidate, priority)) {
    add(evidence("pinned-priority", "Pinned as today’s priority", 72, "Daily Check-In"));
  }
  if (intention && candidateMatchesText(candidate, intention)) {
    add(evidence("day-intention", "Matches today’s intention", 46, "Daily Check-In"));
  }
  if (liveMatch) {
    add(evidence("active-session", "Focus session already in progress", 95, "Focus timer"));
  }

  const avoidanceCount = context.recentSessions.filter((session) => (
    linksMatch(candidate.link, session.link)
    && (
      session.status === "abandoned"
      || session.quickLogs.some((row) => row.log === "blocked" || row.log === "rescheduled")
    )
  )).length;
  if (avoidanceCount >= 2) {
    add(evidence("recent-avoidance", `Deferred or blocked ${avoidanceCount} times recently`, 24, "Recent sessions"));
  }

  let estimatedMinutes = candidate.estimatedMinutes;
  if (liveMatch && context.liveSession?.plannedMinutes) {
    const remaining = context.liveSession.plannedMinutes - sessionElapsedMinutes(context.liveSession, context.now);
    estimatedMinutes = Math.max(5, remaining);
  }
  if (context.availableMinutes !== undefined) {
    estimatedMinutes = Math.min(estimatedMinutes, context.availableMinutes);
    add(evidence("available-time", `Sized to the planned ${context.availableMinutes}-minute block`, 4, "Daily Check-In"));
  }
  if (context.readinessScore !== undefined) {
    if (context.readinessScore < 40) estimatedMinutes = Math.min(estimatedMinutes, 25);
    add(evidence(
      "readiness-context",
      context.readinessScore < 40
        ? `Adjusted for reported readiness (${context.readinessScore}/100)`
        : `Readiness context (${context.readinessScore}/100)`,
      context.readinessScore < 40 ? 4 : 2,
      "Journal and check-in",
    ));
  }

  const reason = liveMatch
    ? "This is the focus session already in progress."
    : priority && candidateMatchesText(candidate, priority)
      ? "You pinned this as today’s priority."
      : candidate.reason;
  return {
    ...candidate,
    estimatedMinutes: Math.max(5, Math.round(estimatedMinutes)),
    reason,
    score: candidateScore(contributions),
    contributions,
  };
}

function targetEstimatedMinutes(result: DailyRequirementResult): number {
  const remaining = Math.max(0, result.target - result.current);
  const unit = normalizeEvidenceText(result.requirement.unit);
  if (unit.includes("min")) return Math.max(5, Math.min(120, Math.ceil(remaining)));
  if (unit.includes("question")) return Math.max(5, Math.min(90, Math.ceil(remaining * 2)));
  if (unit.includes("card")) return Math.max(5, Math.min(60, Math.ceil(remaining / 2)));
  return 15;
}

function habitEstimatedMinutes(habit: Habit, entry: HabitEntry | undefined): number {
  if (habit.type !== "duration") return 10;
  const remaining = Math.max(0, (habit.target ?? 20) - (entry?.value ?? 0));
  return Math.max(5, Math.min(90, Math.ceil(remaining)));
}

/** Rank only actionable, user-backed work. Seed/template rows never enter this list. */
export function rankCommandBriefCandidates(
  s: BriefStateSlice,
  mode: BriefMode,
  now: Date = new Date(),
): RankedBriefCandidate[] {
  const minutes = MODE_MINUTES[mode];
  const closeout = previousCloseout(s.closeouts, s.activeDayKey);
  const commitment = normalizeEvidenceText(closeout?.tomorrowFirstTask ?? "");
  const examId = pickFocusExam(s.boardPrep, s.activeDayKey);
  const examPrep = examId ? s.boardPrep?.[examId] : undefined;
  const examDays = examPrep ? daysUntilExam(examPrep.examDate, s.activeDayKey) : null;
  const examNear = examDays !== null && examDays >= 0 && examDays <= 7;
  const recentFloor = previousDayKey(s.activeDayKey, 7);
  const latestLinked = [...s.sessions]
    .filter((session) => session.dayKey >= recentFloor && session.dayKey <= s.activeDayKey)
    .filter((session) => session.link?.id || session.link?.kind === "question-set")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.link;
  const dayPlan = (s.dayPlans ?? []).find((plan) => plan.dayKey === s.activeDayKey && plan.outcome !== "won");
  const liveSession = [...s.sessions]
    .filter((session) => session.dayKey === s.activeDayKey && (session.status === "active" || session.status === "paused"))
    .sort((a, b) => (
      (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1)
      || b.createdAt.localeCompare(a.createdAt)
    ))[0];
  const availableMinutes = dayPlan?.expectedStudyMinutes && Number.isFinite(dayPlan.expectedStudyMinutes)
    ? Math.max(5, Math.min(240, Math.round(dayPlan.expectedStudyMinutes)))
    : undefined;
  const readinessScore = groundedReadinessScore(s.readiness);
  const context: BriefRankingContext = {
    dayPlan,
    liveSession,
    availableMinutes,
    readinessScore,
    recentSessions: s.sessions.filter((session) => session.dayKey >= recentFloor && session.dayKey <= s.activeDayKey),
    now,
  };
  const candidates: RankedBriefCandidate[] = [];

  for (const task of s.tasks.filter(isActionableTask)) {
    const contributions = [evidence("open-task", "Open task", 20, "Tasks")];
    if (task.due && task.due < s.activeDayKey) {
      const daysLate = Math.max(1, Math.round((Date.parse(`${s.activeDayKey}T12:00:00`) - Date.parse(`${task.due}T12:00:00`)) / 86_400_000));
      contributions.push(evidence("overdue", `${daysLate} day${daysLate === 1 ? "" : "s"} overdue`, 80 + Math.min(daysLate, 14), "Task due date"));
    } else if (task.due === s.activeDayKey) {
      contributions.push(evidence("due-today", "Due today", 50, "Task due date"));
    } else if (task.due && task.due <= previousDayKey(s.activeDayKey, -2)) {
      contributions.push(evidence("due-soon", "Due within two days", 30, "Task due date"));
    }
    if ((task.carryoverFrom?.length ?? 0) > 0) contributions.push(evidence("carried", "Carried forward", 15, "Task history"));
    if (commitment && normalizeEvidenceText(task.title) === commitment) contributions.push(evidence("commitment", "Chosen as the first task", 100, "Yesterday’s closeout"));
    if (latestLinked?.kind === "task" && latestLinked.id === task.id) contributions.push(evidence("continuity", "Recently in progress", 18, "Recent session"));
    const score = candidateScore(contributions);
    candidates.push({
      candidateId: `task:${task.id}`,
      title: task.title,
      link: { kind: "task", id: task.id, label: task.title, context: task.scope },
      estimatedMinutes: mode === "recovery" ? 25 : minutes,
      resources: [],
      reason: contributions.slice().sort((a, b) => b.weight - a.weight)[0].label,
      expectedOutcome: "Complete one committed block and leave a clear task status.",
      score,
      contributions,
      source: "command-brief",
    });
  }

  const sharedTrackerRanks = rankMeaningfulTracker(s, now);
  for (const ranked of sharedTrackerRanks) {
    const item = ranked.item;
    const action = trackerStudyAction(ranked);
    const contributions = ranked.factors.map((factor) => evidence(factor.id, factor.label, factor.value, "Course Tracker"));
    if (examNear && (item.yield === "review" || item.yield === "high" || isQuestionKind(item.kind))) {
      contributions.push(evidence("exam-proximity", `${EXAM_META[examId!].label} is within seven days`, 18, "Exam plan"));
    }
    if (commitment && normalizeEvidenceText(item.label) === commitment) contributions.push(evidence("commitment", "Chosen as the first task", 100, "Yesterday’s closeout"));
    if (latestLinked?.kind === "tracker" && latestLinked.id === item.id) contributions.push(evidence("continuity", "Recently in progress", 18, "Recent session"));
    const score = candidateScore(contributions);
    candidates.push({
      candidateId: `tracker:${item.id}`,
      title: action.title,
      link: { kind: "tracker", id: item.id, label: item.label, context: item.path.split("/").slice(0, 3).join(" · ") },
      estimatedMinutes: mode === "recovery" ? 25 : minutes,
      resources: action.resources,
      reason: ranked.reason || "This active item has the strongest current evidence.",
      expectedOutcome: action.expectedOutcome,
      studyPlan: { summary: action.summary, sources: action.sources },
      score,
      contributions,
      source: "command-brief",
    });
  }

  const due = trustedDueQuestions(s.questions, now);
  if (due.length) {
    const contributions = [evidence("due-review", `${due.length} trusted review${due.length === 1 ? "" : "s"} due`, 65 + Math.min(due.length, 20), "Question Bank")];
    if (examNear) contributions.push(evidence("exam-proximity", `${EXAM_META[examId!].label} is within seven days`, 20, "Exam plan"));
    if (latestLinked?.kind === "question-set") contributions.push(evidence("continuity", "Recently practised", 12, "Recent session"));
    const score = candidateScore(contributions);
    candidates.push({
      candidateId: "questions:due-review",
      title: `Rework ${Math.min(due.length, 20)} due practice question${due.length === 1 ? "" : "s"}`,
      link: { kind: "question-set", label: "Question Workspace", context: "Due review queue" },
      estimatedMinutes: mode === "recovery" ? 20 : minutes,
      resources: ["Question Workspace → Review mode"],
      reason: `${due.length} trusted question${due.length === 1 ? " is" : "s are"} due for review.`,
      expectedOutcome: "Revisit supported answer mappings and repair repeat errors.",
      score,
      contributions,
      source: "command-brief",
    });
  }

  const scheduledTargets = unfinishedDailyTargets(s.dailySuccess, s.activeDayKey);
  for (const result of scheduledTargets) {
    const id = `scheduled-target:${result.requirement.id}`;
    const targetEvidence = evidence(
      id,
      `Scheduled target: ${result.calculation}`,
      48 + Math.round((Math.max(0.1, Math.min(5, result.requirement.weight ?? 1)) - 1) * 4),
      "Today’s targets",
    );
    const matching = candidates.find((candidate) => candidateMatchesText(candidate, result.requirement.label));
    if (matching) {
      addCandidateEvidence(matching, targetEvidence);
      continue;
    }
    const contributions = [targetEvidence];
    if (result.current > 0) contributions.push(evidence("target-progress", "Already in progress today", 10, "Today’s targets"));
    candidates.push({
      candidateId: `target:${result.requirement.id}`,
      title: `Complete ${result.requirement.label}`,
      link: { kind: "free", id: result.requirement.id, label: result.requirement.label, context: "Today’s targets" },
      estimatedMinutes: targetEstimatedMinutes(result),
      resources: [],
      reason: `This target is scheduled today and currently shows ${result.calculation}.`,
      expectedOutcome: `Reach ${result.target} ${result.requirement.unit} without changing the underlying target.`,
      score: candidateScore(contributions),
      contributions,
      source: "command-brief",
    });
  }

  const targetHabitIds = linkedHabitIds(scheduledTargets);
  for (const { habit, entry } of dueRecurringHabits(
    s.habits ?? [],
    s.habitEntries ?? [],
    s.activeDayKey,
    targetHabitIds,
  )) {
    const habitEvidence = evidence(`due-habit:${habit.id}`, "Recurring habit is due today", 44, "Habits");
    const matching = candidates.find((candidate) => candidateMatchesText(candidate, habit.name));
    if (matching) {
      addCandidateEvidence(matching, habitEvidence);
      continue;
    }
    const contributions = [habitEvidence];
    if (entry?.status === "partial") contributions.push(evidence("habit-progress", "Partially completed today", 10, "Habit check-in"));
    candidates.push({
      candidateId: `habit:${habit.id}`,
      title: habit.type === "avoidance" ? `Check in: ${habit.name}` : `Complete ${habit.name}`,
      link: { kind: "free", id: habit.id, label: habit.name, context: "Habits" },
      estimatedMinutes: habitEstimatedMinutes(habit, entry),
      resources: [],
      reason: "This recurring habit is scheduled today and has not been completed or intentionally skipped.",
      expectedOutcome: entry?.status === "partial" ? "Finish or update today’s partial habit entry." : "Record today’s habit outcome.",
      score: candidateScore(contributions),
      contributions,
      source: "command-brief",
    });
  }

  const priority = dayPlan?.priority?.trim() ?? "";
  if (priority) {
    const matching = candidates.find((candidate) => candidateMatchesText(candidate, priority));
    if (matching) {
      addCandidateEvidence(matching, evidence("pinned-priority", "Pinned as today’s priority", 72, "Daily Check-In"));
    } else {
      const contributions = [evidence("pinned-priority", "Pinned as today’s priority", 72, "Daily Check-In")];
      candidates.push({
        candidateId: "plan:priority",
        title: priority,
        link: { kind: "free", label: priority, context: "Today’s priority" },
        estimatedMinutes: minutes,
        resources: [],
        reason: "You pinned this as today’s priority.",
        expectedOutcome: "Make one visible block of progress on the priority you chose.",
        score: candidateScore(contributions),
        contributions,
        source: "command-brief",
      });
    }
  }

  const intention = dayPlan?.intention.trim() ?? "";
  if (intention && normalizeEvidenceText(intention) !== normalizeEvidenceText(priority)) {
    const matching = candidates.find((candidate) => candidateMatchesText(candidate, intention));
    if (matching) {
      addCandidateEvidence(matching, evidence("day-intention", "Matches today’s intention", 46, "Daily Check-In"));
    } else {
      const contributions = [evidence("day-intention", "Unfinished intention for today", 42, "Daily Check-In")];
      candidates.push({
        candidateId: "plan:intention",
        title: intention,
        link: { kind: "free", label: intention, context: "Today’s intention" },
        estimatedMinutes: minutes,
        resources: [],
        reason: "This is the unfinished intention you set for today.",
        expectedOutcome: "Advance the intention you chose, then update today’s plan with the result.",
        score: candidateScore(contributions),
        contributions,
        source: "command-brief",
      });
    }
  }

  if (liveSession && !candidates.some((candidate) => linksMatch(candidate.link, liveSession.link))) {
    const contributions = [evidence("active-session", "Focus session already in progress", 95, "Focus timer")];
    candidates.push({
      candidateId: `session:${liveSession.id}`,
      title: `Continue ${liveSession.title}`,
      link: liveSession.link,
      estimatedMinutes: liveSession.plannedMinutes ?? minutes,
      resources: liveSession.resources ?? [],
      reason: "This is the focus session already in progress.",
      expectedOutcome: "Finish or intentionally pause the active focus block, then record its outcome.",
      score: candidateScore(contributions),
      contributions,
      source: "command-brief",
    });
  }

  return candidates
    .map((candidate) => contextualizeCandidate(candidate, context))
    .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
}

// --- minimum viable win -----------------------------------------------------

export function deriveMinimumViableWin(s: BriefStateSlice, signals: BriefSignals, now: Date = new Date()): MinimumViableWin {
  if (signals.dueCardCount > 0) {
    const n = Math.min(signals.dueCardCount, 8);
    return {
      title: `Review ${n} due card${n === 1 ? "" : "s"}`,
      estimatedMinutes: 5,
      reason: "Five minutes of due reviews keeps retention compounding even on a zero day.",
      link: { kind: "card-review", label: "Anki Lab review queue" },
    };
  }
  if (signals.dueQuestionCount > 0) {
    const n = Math.min(signals.dueQuestionCount, 5);
    return {
      title: `Answer ${n} due question${n === 1 ? "" : "s"}`,
      estimatedMinutes: 10,
      reason: "A handful of questions preserves the review loop without demanding a full session.",
      link: { kind: "question-set", label: "Question Workspace", context: "Review mode" },
    };
  }
  const fragile = rankMeaningfulTracker(s, now).find(({ item }) => item.passes === 1 && item.yield !== "low")?.item;
  if (fragile) {
    return {
      title: `15-minute skim: ${fragile.label}`,
      estimatedMinutes: 15,
      reason: "One short focused block keeps continuity. It counts.",
      link: { kind: "tracker", id: fragile.id, label: fragile.label },
    };
  }
  return {
    title: "Write one sentence: what's blocking you today?",
    estimatedMinutes: 2,
    reason: "Naming the blocker is the smallest unit of progress — tomorrow's brief will use it.",
    link: { kind: "free", label: "Daily closeout note" },
  };
}

// --- what changed since yesterday --------------------------------------------

export function deriveChanges(s: BriefStateSlice, signals: BriefSignals): BriefChange[] {
  const changes: BriefChange[] = [];
  const yesterday = previousDayKey(s.activeDayKey);
  const y = dayTotals(s.logs, yesterday);

  changes.push(
    y.minutes > 0
      ? { label: "Yesterday", value: `${y.minutes} min logged${y.cards ? ` · ${y.cards} cards` : ""}`, tone: "good" }
      : { label: "Yesterday", value: "No study logged", tone: "watch" },
  );

  const completedYesterday = s.tasks.filter((t) => t.done && t.completedAt?.slice(0, 10) === yesterday).length;
  if (completedYesterday > 0) {
    changes.push({ label: "Completed", value: `${completedYesterday} task${completedYesterday === 1 ? "" : "s"} closed yesterday`, tone: "good" });
  }
  if (signals.overdueTasks > 0) {
    changes.push({ label: "Backlog", value: `${signals.overdueTasks} task${signals.overdueTasks === 1 ? "" : "s"} overdue`, tone: "watch" });
  }

  const attemptedYesterday = s.questions.filter((q) => q.attemptedAt?.slice(0, 10) === yesterday);
  if (attemptedYesterday.length >= 3) {
    const correct = attemptedYesterday.filter((q) => q.status === "correct").length;
    const pct = Math.round((correct / attemptedYesterday.length) * 100);
    changes.push({
      label: "Questions",
      value: `${pct}% correct on ${attemptedYesterday.length} attempted`,
      tone: pct >= 70 ? "good" : "watch",
    });
  }

  const weak = weakTopics(s.questions, 1)[0];
  if (weak) {
    changes.push({ label: "Weak topic", value: `${weak.topic} (${weak.incorrect}/${weak.attempts} missed)`, tone: "watch" });
  }

  const closeout = previousCloseout(s.closeouts, s.activeDayKey);
  if (closeout?.tomorrowFirstTask) {
    changes.push({ label: "You planned", value: `Start with: ${closeout.tomorrowFirstTask}`, tone: "neutral" });
  }
  if (closeout?.energyVsMorning) {
    const map = { lower: "watch", same: "neutral", higher: "good" } as const;
    changes.push({ label: "Energy", value: `Ended yesterday ${closeout.energyVsMorning} than morning`, tone: map[closeout.energyVsMorning] });
  }

  if (signals.dueCardCount + signals.dueQuestionCount > 0) {
    changes.push({
      label: "Due today",
      value: [
        signals.dueCardCount ? `${signals.dueCardCount} cards` : "",
        signals.dueQuestionCount ? `${signals.dueQuestionCount} questions` : "",
      ].filter(Boolean).join(" · "),
      tone: "neutral",
    });
  }
  return changes.slice(0, 6);
}

// --- assembly ----------------------------------------------------------------

export function buildCommandBrief(s: BriefStateSlice, now: Date = new Date()): CommandBrief {
  const signals = deriveSignals(s, now);
  const closeout = previousCloseout(s.closeouts, s.activeDayKey);
  const { mode, reason } = deriveMode(signals, closeout?.tomorrowMode);
  const move = deriveNextBestMove(s, mode, signals, now);

  return {
    mode,
    modeReason: reason,
    move,
    minimumViableWin: deriveMinimumViableWin(s, signals, now),
    changes: deriveChanges(s, signals),
    signals,
    recoverySuggested: mode === "recovery",
    generatedFor: s.activeDayKey,
    source: "rules",
  };
}
