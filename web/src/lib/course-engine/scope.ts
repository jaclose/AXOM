// ===========================================================================
// One answer to "where in the course does this belong?", shared by the
// Question Bank, the Course Tracker and Analysis. A question says it in its
// own fields; a tracker row says it in its path ("T1/FTM 1/Week 2"). Both are
// read into the same scope here, so the three surfaces count the same things
// and none of them keeps a second copy of anyone's progress.
//
// Decode (lib/decode) reads scope from here and keeps none of its own: a
// question's place is its own module and week, or its set's.
// ===========================================================================
import type { ID } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { canonicalModuleKey } from "./vocabulary.ts";

export interface CourseScope {
  /** Module as the learner writes it: "FTM 1". */
  module?: string;
  /** Week number within what the module's materials call "Week N". */
  week?: number;
  courseId?: ID;
}

/** A set's own place in the course, which its questions inherit unless they say otherwise. */
export type QuestionSetScope = Pick<CourseScope, "module" | "week" | "courseId">;

/**
 * Progress consumers receive full question sets from the installed workspace.
 * Older analysis callers may only have a source's scope, not its membership.
 * Such scope-only maps cannot establish immutable membership provenance.
 */
export type QuestionSourceEvidence = Pick<QuestionSet, "scope"> & Partial<Pick<QuestionSet, "questionIds" | "kind" | "tags">>;

/** Review/custom snapshots reference existing originals and cannot serve as
 * their primary evidence. Older missed-review sets used a tag before kind. */
export function isSecondaryQuestionSet(set: Pick<QuestionSourceEvidence, "kind" | "tags"> | undefined): boolean {
  return Boolean(set && (set.kind === "review" || set.kind === "custom"
    || (!set.kind && set.tags?.includes("missed-review"))));
}

export const UNASSIGNED_SCOPE_KEY = "unassigned";

/** "ftm1|w2". Two spellings of a module are one scope. */
export function scopeKey(scope: CourseScope): string {
  const module = scope.module ? canonicalModuleKey(scope.module) : "";
  if (!module) return UNASSIGNED_SCOPE_KEY;
  return scope.week ? `${module}|w${scope.week}` : module;
}

export function parseWeek(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 && value < 100 ? value : undefined;
  if (typeof value !== "string") return undefined;
  // Do not turn a date, module number or source-week range into a single week.
  // Separators own their whitespace so malformed padding cannot backtrack cubically.
  const match = value.trim().match(/^(?:(?:week|wk|w)\s*(?::\s*)?(?:#\s*)?)?(\d{1,2})$/i);
  return match ? parseWeek(Number(match[1])) : undefined;
}

/**
 * Own filing wins. Inherited modules require compatible course ownership.
 * Only an absent week may inherit from a compatible source set; invalid weeks
 * and contradictory refiling stay unassigned.
 */
export function questionScope(
  question: Pick<QuestionRecord, "module" | "week" | "courseId" | "setId">,
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): CourseScope {
  const inherited = question.setId ? setsById?.get(question.setId)?.scope : undefined;
  // Empty legacy values are absent, but an explicit invalid week is not.
  const declaredWeek: unknown = question.week;
  const hasOwnWeek = declaredWeek != null && (typeof declaredWeek !== "string" || declaredWeek.trim() !== "");
  const sameModule = question.module == null || inherited?.module == null
    || canonicalModuleKey(question.module) === canonicalModuleKey(inherited.module);
  const sameCourse = question.courseId == null || inherited?.courseId == null || question.courseId === inherited.courseId;
  return {
    module: question.module ?? (sameCourse ? inherited?.module : undefined),
    week: hasOwnWeek ? parseWeek(declaredWeek) : sameModule && sameCourse ? parseWeek(inherited?.week) : undefined,
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
  /** Excluded from current scope progress because the declared primary is missing,
   * forged, invalid or contradictory. Historical attempts remain untouched. */
  sourceReviewHeld?: number;
}

/** Complete primary-source evidence is needed before a question counts as
 * currently filed progress. Scope-only legacy projections preserve their old
 * semantics; the installed workspace supplies immutable questionIds too. */
function hasConsistentPrimaryFiling(
  question: QuestionRecord,
  own: CourseScope,
  setsById?: ReadonlyMap<ID, QuestionSourceEvidence>,
  hasFullSourceIndex = false,
): boolean {
  // A source-unbound legacy question may be valid, but a malformed *declared*
  // week cannot become module-wide eligible progress when full evidence exists.
  const rawQuestionWeek: unknown = question.week;
  if (hasFullSourceIndex && rawQuestionWeek != null
    && (typeof rawQuestionWeek !== "string" || rawQuestionWeek.trim() !== "")
    && parseWeek(rawQuestionWeek) === undefined) return false;
  if (!question.setId || !setsById) return true;
  const primary = setsById.get(question.setId);
  if (!primary || isSecondaryQuestionSet(primary)) return false;
  if (!primary.questionIds) return true; // Legacy scope-only analysis is not proof of membership.
  if (!primary.questionIds.includes(question.id)) return false;
  const declaredWeek = (value: unknown): boolean =>
    value != null && (typeof value !== "string" || value.trim() !== "");
  if ((declaredWeek(question.week) && parseWeek(question.week) === undefined)
    || (declaredWeek(primary.scope?.week) && parseWeek(primary.scope?.week) === undefined)) return false;
  const source = primary.scope;
  return !(
    (source?.module && own.module
      && canonicalModuleKey(source.module) !== canonicalModuleKey(own.module))
    || (parseWeek(source?.week) !== undefined && own.week !== undefined
      && parseWeek(source?.week) !== own.week)
    || (source?.courseId && own.courseId && source.courseId !== own.courseId)
  );
}

/** Duplicate originals with competing primary/progress evidence cannot
 * receive mastery credit. Only duplicate IDs need the expensive source checks;
 * unique records are checked when they match the requested scope. */
export function conflictingDuplicateIds(
  questions: readonly QuestionRecord[],
  setsById: ReadonlyMap<ID, QuestionSourceEvidence> | undefined,
  hasFullSourceIndex: boolean,
): Set<ID> {
  const firstById = new Map<ID, QuestionRecord>();
  const held = new Set<ID>();
  const signature = (question: QuestionRecord, own: CourseScope): string => JSON.stringify([
    question.setId ?? null, question.sourceDocumentId ?? null, question.correctKey ?? null,
    own.courseId ?? null, canonicalModuleKey(own.module ?? ""), own.week ?? null,
    question.status, question.attempts[0]?.status ?? null, question.attempts.length > 0,
  ]);
  for (const question of questions) {
    const first = firstById.get(question.id);
    if (!first) { firstById.set(question.id, question); continue; }
    if (held.has(question.id) || first === question) continue;
    const firstScope = questionScope(first, setsById);
    const currentScope = questionScope(question, setsById);
    if (signature(first, firstScope) !== signature(question, currentScope)
      || !hasConsistentPrimaryFiling(first, firstScope, setsById, hasFullSourceIndex)
      || !hasConsistentPrimaryFiling(question, currentScope, setsById, hasFullSourceIndex)) {
      held.add(question.id);
    }
  }
  return held;
}

/**
 * What the learner has done with the questions in a scope, read from the
 * attempts themselves. Nothing here is reported by the learner.
 */
export function scopeProgress(
  questions: readonly QuestionRecord[],
  scope: CourseScope,
  setsById?: ReadonlyMap<ID, QuestionSourceEvidence>,
): ScopeProgress {
  const key = scopeKey(scope);
  const progress: ScopeProgress = { total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0, questionIds: [] };
  const counted = new Set<ID>();
  const held = new Set<ID>();
  const hasFullSourceIndex = [...(setsById?.values() ?? [])].some((set) => Array.isArray(set.questionIds));
  const conflictingDuplicates = conflictingDuplicateIds(questions, setsById, hasFullSourceIndex);
  for (const question of questions) {
    const own = questionScope(question, setsById);
    // A scope without a week counts every week of the module.
    const matches = scope.week ? scopeKey(own) === key : scopeKey({ module: own.module }) === key;
    // An explicitly course-owned query must not absorb answers from another
    // course or from records with unresolved course ownership.
    if (!matches || (scope.courseId && own.courseId !== scope.courseId)) continue;
    if (conflictingDuplicates.has(question.id)
      || !hasConsistentPrimaryFiling(question, own, setsById, hasFullSourceIndex)) {
      held.add(question.id);
      continue;
    }
    // One original question can appear in multiple secondary collections.
    if (counted.has(question.id)) continue;
    counted.add(question.id);
    progress.total += 1;
    progress.questionIds.push(question.id);
    const first = question.attempts[0];
    if (!first) continue;
    progress.attempted += 1;
    if (first.status === "correct") progress.firstTimeCorrect += 1;
    if (question.status === "incorrect") progress.missed += 1;
  }
  if (held.size > 0) progress.sourceReviewHeld = held.size;
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
  setsById?: ReadonlyMap<ID, QuestionSourceEvidence>,
): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  const seen = new Set<ID>();
  const hasFullSourceIndex = [...(setsById?.values() ?? [])].some((set) => Array.isArray(set.questionIds));
  const conflictingDuplicates = conflictingDuplicateIds(questions, setsById, hasFullSourceIndex);
  for (const question of questions) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    const own = questionScope(question, setsById);
    // Keep held questions discoverable in Unassigned, not in an invented
    // eligible module/week; this is a read model, not a refile or deletion.
    const scope = conflictingDuplicates.has(question.id)
      || !hasConsistentPrimaryFiling(question, own, setsById, hasFullSourceIndex) ? {} : own;
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
