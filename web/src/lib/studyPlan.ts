// ===========================================================================
// What to do next, and why. A pure reading of what the workspace already
// records: answered questions, tracker passes, question runs and focus
// sprints. Every suggestion names the recorded facts it rests on and carries
// the exact action that starts it. Nothing is estimated beyond the learner's
// own measured pace, nothing is written, and no schedule is invented.
// ===========================================================================
import type { NoctyriumState, TrackerItem } from "./types";
import type { QuestionRecord } from "./questions";
import { uniquePracticeQuestions } from "./exam/nextPractice";
import { questionScope, trackerPathScope } from "./course-engine/scope";
import { canonicalModuleKey } from "./course-engine/vocabulary";
import { attemptEvents, median, type AttemptEvent } from "./learning-intelligence/attempts";
import { localDateKey } from "./dailyRollover";
import { canonicalStudyLogs } from "./targetContributions";
import { quizPracticeLogId } from "./quizPracticeProgress";
import { STORAGE_KEYS } from "./brand";

export type StudyActionKind = "resume-run" | "sure-and-wrong" | "retry-missed" | "continue-course" | "new-questions" | "flagged";

/** A practice launch names its exact questions; lib/exam/practiceLaunch starts and guards the run. */
export type StudyLaunch =
  | { type: "practice"; questionIds: string[] }
  | { type: "route"; route: "questions" | "tracker" };

export interface StudyAction {
  id: string;
  kind: StudyActionKind;
  title: string;
  /** One sentence: the recorded facts this suggestion rests on. */
  reason: string;
  /** Whole minutes at the learner's own measured pace; absent until enough answers are timed. */
  minutes?: number;
  launch: StudyLaunch;
  actionLabel: string;
}

export interface ObservedDay {
  /** Answers AXOM recorded in the Question Bank on this day. */
  answered: number;
  correct: number;
  /** Whole percent of scored answers, or null when none was scored. */
  accuracy: number | null;
  trackerPasses: number;
  cardReviews: number;
  /** Minutes from focus sprints and question runs AXOM timed itself. */
  observedMinutes: number;
  /** Minutes the learner typed in. */
  reportedMinutes: number;
}

export interface StudyPlan {
  actions: StudyAction[];
  observed: ObservedDay;
  /** True when the workspace holds nothing a plan could be read from. */
  empty: boolean;
}

/** An unfinished Question Bank run, as the page that owns storage found it. */
export interface ActiveRun { total: number }

/**
 * The only reader of browser storage here; buildStudyPlan itself stays pure.
 * An unreadable saved run is the Question Bank's to recover, so the plan
 * simply does not mention it.
 */
export function readActiveRun(): ActiveRun | null {
  try {
    const key = STORAGE_KEYS.quizActiveSession;
    const tabRun = sessionStorage.getItem(`${key}:run-id`);
    for (const raw of [localStorage.getItem(key), tabRun ? localStorage.getItem(`${key}:run:${tabRun}`) : null]) {
      const value = JSON.parse(raw ?? "null") as { poolIds?: unknown } | null;
      if (value && Array.isArray(value.poolIds) && value.poolIds.length) return { total: value.poolIds.length };
    }
  } catch {
    return null;
  }
  return null;
}

export interface StudyPlanOptions {
  /** Keep only these kinds, in the plan's own order. Other kinds still claim their questions first. */
  kinds?: readonly StudyActionKind[];
  /** How many actions to return; four by default. */
  limit?: number;
  /** Offer a retry for every module with misses, largest first, instead of only the largest. */
  everyMissedModule?: boolean;
}

const QUIZ_CAP = 20;
const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
/** The same floor review.ts uses before a pace means anything. */
const MIN_TIMED_ANSWERS = 6;
const MAX_ACTIONS = 4;
const UNFILED = "Unfiled questions";

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

interface Scoped { question: QuestionRecord; module: string; moduleKey: string; last?: AttemptEvent }

/** The newest recorded touch of a tracker row: a pass event or its last update. */
function lastTouched(item: TrackerItem): number {
  const times = [(item.passEvents ?? []).map((event) => Date.parse(event.at)), item.passes > 0 || item.ankiPasses > 0 ? [Date.parse(item.updated)] : []]
    .flat().filter(Number.isFinite);
  return times.length ? Math.max(...times) : -Infinity;
}

const practice = (questions: readonly QuestionRecord[]): StudyLaunch => ({ type: "practice", questionIds: questions.map((question) => question.id) });

/**
 * Up to four next actions, most pressing first, and what AXOM itself saw today.
 * The order is fixed and readable: finish what is open, recheck what you were
 * sure of and got wrong, retry your misses, continue the course you are in,
 * meet new questions there, then clear your flags. A question appears in one
 * suggestion only.
 */
export function buildStudyPlan(state: NoctyriumState, now: Date = new Date(), activeRun: ActiveRun | null = null, options: StudyPlanOptions = {}): StudyPlan {
  // A workspace restored from an older copy can lack whole collections; an absent one is an empty one.
  const questions = state.questions ?? [];
  const tracker = state.tracker ?? [];
  const setsById = new Map((state.questionSets ?? []).map((set) => [set.id, set]));
  const events = attemptEvents(questions);
  const lastScored = new Map<string, AttemptEvent>();
  for (const event of events) if (event.correct !== undefined) lastScored.set(event.questionId, event);
  const answeredIds = new Set(events.map((event) => event.questionId));
  const timed = events.filter((event) => event.seconds && event.seconds > 0).map((event) => event.seconds!);
  const pace = timed.length >= MIN_TIMED_ANSWERS ? median(timed) : undefined;
  const minutesFor = (count: number): number | undefined => pace ? Math.max(1, Math.round((count * pace) / 60)) : undefined;

  // Ready, and one record per identity: the same rule the Up Next recommendation uses.
  const ready: Scoped[] = uniquePracticeQuestions(questions).map((question) => {
    const module = questionScope(question, setsById).module?.trim() || UNFILED;
    return { question, module, moduleKey: module === UNFILED ? "" : canonicalModuleKey(module), last: lastScored.get(question.id) };
  });
  const used = new Set<string>();
  const take = (pool: readonly Scoped[]): Scoped[] => {
    const chosen = pool.filter((entry) => !used.has(entry.question.id)).slice(0, QUIZ_CAP);
    for (const entry of chosen) used.add(entry.question.id);
    return chosen;
  };
  const newestAnswerFirst = (left: Scoped, right: Scoped) => (right.last?.at ?? "").localeCompare(left.last?.at ?? "");
  /** Modules by how many entries they hold; ties go to the one missed most recently. */
  const byModule = (pool: readonly Scoped[]): Scoped[][] => {
    const groups = new Map<string, Scoped[]>();
    for (const entry of pool) groups.set(entry.moduleKey, [...(groups.get(entry.moduleKey) ?? []), entry]);
    return [...groups.values()].sort((left, right) => right.length - left.length
      || (right[0].last?.at ?? "").localeCompare(left[0].last?.at ?? ""));
  };
  const actions: StudyAction[] = [];

  if (activeRun && activeRun.total > 0) {
    actions.push({ id: "resume-run", kind: "resume-run", title: "Finish the block you started",
      reason: `An unfinished Question Bank block of ${plural(activeRun.total, "question", "questions")} is saved on this device.`,
      launch: { type: "route", route: "questions" }, actionLabel: "Resume" });
  }

  const missed = ready.filter((entry) => entry.last?.correct === false).sort(newestAnswerFirst);
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const sure = take(missed.filter((entry) => entry.last!.certainty === "sure" && Date.parse(entry.last!.at) >= since));
  if (sure.length) {
    actions.push({ id: "sure-and-wrong", kind: "sure-and-wrong",
      title: `Recheck ${plural(sure.length, "answer", "answers")} you were sure of`,
      reason: `You marked ${sure.length === 1 ? "this" : "these"} as sure and the answer was wrong, within the last ${RECENT_DAYS} days. A confident miss returns unless it is met again.`,
      minutes: minutesFor(sure.length),
      launch: practice(sure.map((entry) => entry.question)),
      actionLabel: "Start recheck" });
  }

  const remainingMisses = missed.filter((entry) => !used.has(entry.question.id));
  for (const missGroup of byModule(remainingMisses).slice(0, options.everyMissedModule ? 3 : 1)) {
    const total = missGroup.length;
    const chosen = take(missGroup);
    const oldest = Math.max(0, Math.floor((now.getTime() - Math.min(...missGroup.map((entry) => Date.parse(entry.last!.at)))) / DAY_MS));
    actions.push({ id: `retry-missed:${missGroup[0].moduleKey}`, kind: "retry-missed",
      title: `Retry ${plural(chosen.length, "missed question", "missed questions")} in ${missGroup[0].module}`,
      reason: `Your latest answer to ${total === 1 ? "this question" : `each of ${total} questions here`} was wrong${total > chosen.length ? `; this block takes the ${chosen.length} most recent` : ""}. The oldest miss is ${oldest === 0 ? "from today" : `${plural(oldest, "day", "days")} old`}.`,
      minutes: minutesFor(chosen.length),
      launch: practice(chosen.map((entry) => entry.question)),
      actionLabel: "Start retry" });
  }

  // The course the learner is in is the one they last recorded work on. AXOM never guesses a schedule.
  const open = tracker.filter((item) => !item.archivedAt);
  const latest = [...open].sort((left, right) => lastTouched(right) - lastTouched(left))[0];
  const current = latest && Number.isFinite(lastTouched(latest)) ? trackerPathScope(latest.path) : {};
  const currentKey = current.module ? canonicalModuleKey(current.module) : "";
  if (current.module) {
    const untouched = open.filter((item) => item.passes === 0 && item.ankiPasses === 0
      && (!item.recommendationSnoozedUntil || Date.parse(item.recommendationSnoozedUntil) <= now.getTime())
      && canonicalModuleKey(trackerPathScope(item.path).module ?? "") === currentKey);
    const weeks = untouched.map((item) => trackerPathScope(item.path).week).filter((week): week is number => week !== undefined);
    const week = weeks.length ? Math.min(...weeks) : undefined;
    const inWeek = week === undefined ? untouched : untouched.filter((item) => trackerPathScope(item.path).week === week);
    if (inWeek.length) {
      actions.push({ id: `continue-course:${currentKey}:${week ?? "all"}`, kind: "continue-course",
        title: `Continue ${current.module}${week ? `, Week ${week}` : ""}`,
        reason: `${plural(inWeek.length, "activity is", "activities are")} not started${week ? " in the earliest unfinished week" : ""}: ${inWeek.slice(0, 2).map((item) => item.label).join("; ")}${inWeek.length > 2 ? "; and more" : ""}. This is the course you last recorded work in.`,
        launch: { type: "route", route: "tracker" }, actionLabel: "Open Course Tracker" });
    }
  }

  // New questions come from the course in progress, or failing that from the module answered most recently.
  const recentModuleKey = currentKey || [...ready].filter((entry) => entry.last && entry.moduleKey)
    .sort(newestAnswerFirst)[0]?.moduleKey || "";
  const unseen = take(ready.filter((entry) => entry.moduleKey === recentModuleKey && recentModuleKey !== "" && !answeredIds.has(entry.question.id)));
  if (unseen.length) {
    const total = ready.filter((entry) => entry.moduleKey === recentModuleKey && !answeredIds.has(entry.question.id)).length;
    actions.push({ id: `new-questions:${recentModuleKey}`, kind: "new-questions",
      title: `Meet ${plural(unseen.length, "new question", "new questions")} in ${unseen[0].module}`,
      reason: `${plural(total, "answer-ready question", "answer-ready questions")} in ${unseen[0].module} ${total === 1 ? "has" : "have"} never been answered. ${currentKey ? "It is the course you are working in." : "It is the module you practised most recently."}`,
      minutes: minutesFor(unseen.length),
      launch: practice(unseen.map((entry) => entry.question)),
      actionLabel: "Start questions" });
  }

  const flagged = take(ready.filter((entry) => entry.question.marked));
  if (flagged.length) {
    actions.push({ id: "flagged", kind: "flagged", title: `Clear ${plural(flagged.length, "flagged question", "flagged questions")}`,
      reason: `You flagged ${flagged.length === 1 ? "this" : "these"} for another look.`,
      minutes: minutesFor(flagged.length),
      launch: practice(flagged.map((entry) => entry.question)),
      actionLabel: "Start flagged" });
  }

  const kept = options.kinds ? actions.filter((action) => options.kinds!.includes(action.kind)) : actions;
  return {
    actions: kept.slice(0, options.limit ?? MAX_ACTIONS),
    observed: observedDay(state, state.activeDayKey, events),
    empty: questions.length === 0 && tracker.length === 0,
  };
}

/** What the app itself recorded on one study day, kept apart from what the learner typed in. */
export function observedDay(state: NoctyriumState, dayKey: string, events: readonly AttemptEvent[] = attemptEvents(state.questions ?? [])): ObservedDay {
  const onDay = (at: string): boolean => {
    const time = Date.parse(at);
    return Number.isFinite(time) && localDateKey(new Date(time)) === dayKey;
  };
  const today = events.filter((event) => onDay(event.at));
  const scored = today.filter((event) => event.correct !== undefined);
  const correct = scored.filter((event) => event.correct).length;
  const latestOnDay = (records: readonly { id: string; at: string }[]): number => {
    const latest = new Map<string, string>();
    for (const record of records) if (!latest.has(record.id) || record.at > latest.get(record.id)!) latest.set(record.id, record.at);
    return [...latest.values()].filter(onDay).length;
  };
  const runLogs = new Set((state.quizSessions ?? []).map((session) => quizPracticeLogId(session.id)));
  let observedMinutes = 0;
  let reportedMinutes = 0;
  for (const log of canonicalStudyLogs(state.logs ?? [])) {
    if (log.dayKey !== dayKey || !(log.minutes > 0)) continue;
    if (log.type === "Pomodoro" || runLogs.has(log.id)) observedMinutes += log.minutes;
    else reportedMinutes += log.minutes;
  }
  return {
    answered: today.length, correct, accuracy: scored.length ? Math.round((correct / scored.length) * 100) : null,
    trackerPasses: latestOnDay((state.tracker ?? []).flatMap((item) => item.passEvents ?? [])),
    cardReviews: latestOnDay(state.cardReviews ?? []),
    observedMinutes: Math.round(observedMinutes), reportedMinutes: Math.round(reportedMinutes),
  };
}
