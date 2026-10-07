// ===========================================================================
// One answer to "where in the course does this belong?", shared by the
// Question Bank, the Course Tracker and Analysis. A question says it in its
// own fields; a tracker row says it in its path ("T1/FTM 1/Week 2"). Both are
// read into the same scope here, so the three surfaces count the same things
// and none of them keeps a second copy of anyone's progress.
//
// The resolver is the single place to change when a reviewed assignment
// overlay (lib/decode on its own branch) becomes the authority for scope.
// ===========================================================================
import type { ID } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { moduleKey } from "./vocabulary.ts";

export interface CourseScope {
  /** Module as the learner writes it: "FTM 1". */
  module?: string;
  /** Week number within what the module's materials call "Week N". */
  week?: number;
  courseId?: ID;
}

/** A set's own place in the course, which its questions inherit unless they say otherwise. */
export type QuestionSetScope = Pick<CourseScope, "module" | "week" | "courseId">;

export const UNASSIGNED_SCOPE_KEY = "unassigned";

/** "ftm1|w2". Two spellings of a module are one scope. */
export function scopeKey(scope: CourseScope): string {
  const module = scope.module ? moduleKey(scope.module) : "";
  if (!module) return UNASSIGNED_SCOPE_KEY;
  return scope.week ? `${module}|w${scope.week}` : module;
}

export function parseWeek(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 && value < 100 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value.match(/(\d{1,2})/);
  return match ? parseWeek(Number(match[1])) : undefined;
}

/**
 * Where a question belongs. Its own module and week win; otherwise it takes
 * the scope of the set it was imported into.
 */
export function questionScope(
  question: Pick<QuestionRecord, "module" | "week" | "courseId" | "setId">,
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): CourseScope {
  const inherited = question.setId ? setsById?.get(question.setId)?.scope : undefined;
  return {
    module: question.module ?? inherited?.module,
    week: parseWeek(question.week) ?? inherited?.week,
    courseId: question.courseId ?? inherited?.courseId,
  };
}

/** The scope a tracker path names: the segment before "Week N" is the module. */
export function trackerPathScope(path: string): CourseScope {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  const weekIndex = segments.findIndex((segment) => /^(?:week|wk)\s*\d{1,2}$/i.test(segment));
  if (weekIndex > 0) return { module: segments[weekIndex - 1], week: parseWeek(segments[weekIndex]) };
  return {};
}

export interface ScopeProgress {
  /** Questions filed under the scope. */
  total: number;
  /** Questions answered at least once. */
  attempted: number;
  /** Of those, how many were right the first time they were seen. */
  firstTimeCorrect: number;
  /** Questions whose latest answer is wrong. */
  missed: number;
  questionIds: ID[];
}

/**
 * What the learner has done with the questions in a scope, read from the
 * attempts themselves. Nothing here is reported by the learner.
 */
export function scopeProgress(
  questions: readonly QuestionRecord[],
  scope: CourseScope,
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): ScopeProgress {
  const key = scopeKey(scope);
  const progress: ScopeProgress = { total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0, questionIds: [] };
  for (const question of questions) {
    const own = questionScope(question, setsById);
    // A scope without a week counts every week of the module.
    const matches = scope.week ? scopeKey(own) === key : scopeKey({ module: own.module }) === key;
    if (!matches) continue;
    progress.total += 1;
    progress.questionIds.push(question.id);
    const first = question.attempts[0];
    if (!first) continue;
    progress.attempted += 1;
    if (first.status === "correct") progress.firstTimeCorrect += 1;
    if (question.status === "incorrect") progress.missed += 1;
  }
  return progress;
}

export interface ScopeGroup {
  key: string;
  module?: string;
  week?: number;
  questionIds: ID[];
}

/** Questions grouped by module, then week, in course order. Unassigned comes last. */
export function groupQuestionsByScope(
  questions: readonly QuestionRecord[],
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  for (const question of questions) {
    const scope = questionScope(question, setsById);
    const key = scopeKey(scope);
    const group = groups.get(key) ?? { key, module: scope.module, week: scope.module ? scope.week : undefined, questionIds: [] };
    group.questionIds.push(question.id);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.key === UNASSIGNED_SCOPE_KEY) return 1;
    if (right.key === UNASSIGNED_SCOPE_KEY) return -1;
    const byModule = (left.module ?? "").localeCompare(right.module ?? "", undefined, { numeric: true, sensitivity: "base" });
    return byModule || (left.week ?? 0) - (right.week ?? 0);
  });
}
