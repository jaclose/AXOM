import type { CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import type { Course, Term } from "../types";
import { parseWeek, questionScope, type CourseScope } from "./scope";
import { canonicalModuleKey } from "./vocabulary";

/**
 * An independent read-model of installed *local question records*. A scheduled
 * activity, a source file, a prepared package, and a runnable question are
 * deliberately different evidence. Neither title matching nor an outline
 * alone can certify that a question belongs to a particular lecture.
 */
export interface ModuleQuestionAvailability {
  term: string;
  module: string;
  collections: number;
  storedQuestions: number;
  readyQuestions: number;
  reviewQuestions: number;
  missingReferencedQuestions: number;
  /** Source-set or question metadata declares a week, NOT a verified school timetable. */
  indexedWeeks: number[];
  /** Questions that cannot be uniquely placed into a source-indexed week. */
  unresolvedWeekQuestions: number;
  explicitCourseAssignments: number;
  outlineAssignments: number;
}

export interface QuestionAvailabilityIndex {
  byModule: ReadonlyMap<string, ModuleQuestionAvailability>;
  unassignedCollections: number;
  unassignedQuestions: number;
}

export interface QuestionAvailabilityInput {
  curriculum: CurriculumTemplate;
  terms: readonly Term[];
  courses: readonly Course[];
  sets: readonly QuestionSet[];
  questions: readonly QuestionRecord[];
}

const termKey = (term: string) => {
  const match = term.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : term.trim().toLowerCase();
};
const courseKey = (code: string) => code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Course suffix is necessary only when two modules share a term and name. */
export const questionAvailabilityModuleKey = (term: string, module: string, courseCode?: string) =>
  `${termKey(term)}|${canonicalModuleKey(module)}${courseCode ? `|course:${courseKey(courseCode)}` : ""}`;

const hasDeclaredWeek = (value: unknown): boolean => value != null && (typeof value !== "string" || value.trim() !== "");

type Owner = { term: string; module: string; courseCode: string };
type Resolution = { key: string; method: "course" | "outline"; owner: Owner };
interface Draft {
  owner: Owner;
  collections: Set<string>;
  present: Set<string>;
  ready: Set<string>;
  review: Set<string>;
  missing: Set<string>;
  weeks: Set<number>;
  unresolvedWeeks: Set<string>;
  courseAssignments: Set<string>;
  outlineAssignments: Set<string>;
}

export function buildQuestionAvailabilityIndex(input: QuestionAvailabilityInput): QuestionAvailabilityIndex {
  const owners = new Map<string, Owner[]>();
  for (const term of input.curriculum.terms.filter((item) => /^Term\s+[1-5]$/i.test(item.name))) {
    for (const course of term.courses) {
      for (const module of course.modules) {
        const key = canonicalModuleKey(module);
        owners.set(key, [...(owners.get(key) ?? []), { term: term.name, module, courseCode: course.code }]);
      }
    }
  }
  // An installed term ID must identify exactly one row, even when duplicate
  // names normalize to the same curriculum term. Never grant indexed credit
  // from a last-write-wins catalog lookup.
  const termName = new Map<string, string>();
  const duplicateTermIds = new Set<string>();
  for (const term of input.terms) {
    if (termName.has(term.id)) duplicateTermIds.add(term.id);
    termName.set(term.id, term.name);
  }
  for (const id of duplicateTermIds) termName.delete(id);
  // Duplicate local IDs cannot identify a unique curriculum owner. Do not
  // let Map insertion order select a different term, course or module.
  const courseById = new Map<string, Course>();
  const duplicateCourseIds = new Set<string>();
  for (const course of input.courses) {
    if (courseById.has(course.id)) duplicateCourseIds.add(course.id);
    courseById.set(course.id, course);
  }
  for (const id of duplicateCourseIds) courseById.delete(id);
  const resolve = (scope: CourseScope): Resolution | undefined => {
    const code = canonicalModuleKey(scope.module ?? "");
    const matches = owners.get(code);
    if (!code || !matches?.length) return undefined;
    let owner: Owner;
    let method: Resolution["method"];
    if (scope.courseId) {
      const course = courseById.get(scope.courseId);
      const courseTerm = course ? termName.get(course.termId) : undefined;
      if (!course || !courseTerm
        || !course.modules.some((module) => canonicalModuleKey(module.name) === code)) return undefined;
      const compatible = matches.filter((candidate) =>
        termKey(candidate.term) === termKey(courseTerm)
        && courseKey(candidate.courseCode) === courseKey(course.code));
      if (compatible.length !== 1) return undefined;
      owner = compatible[0];
      method = "course";
    } else {
      // Without an explicit course, module aliases repeated in multiple
      // outlines have no defensible owner, even when their names match.
      if (matches.length !== 1) return undefined;
      owner = matches[0];
      method = "outline";
    }
    const sameTermOwners = matches.filter((candidate) =>
      termKey(candidate.term) === termKey(owner.term));
    return {
      key: questionAvailabilityModuleKey(owner.term, owner.module,
        sameTermOwners.length > 1 ? owner.courseCode : undefined),
      owner, method,
    };
  };
  const drafts = new Map<string, Draft>();
  const draftFor = (resolution: Resolution): Draft => {
    const existing = drafts.get(resolution.key);
    if (existing) return existing;
    const next: Draft = {
      owner: resolution.owner, collections: new Set(), present: new Set(), ready: new Set(),
      review: new Set(), missing: new Set(), weeks: new Set(), unresolvedWeeks: new Set(),
      courseAssignments: new Set(), outlineAssignments: new Set(),
    };
    drafts.set(resolution.key, next);
    return next;
  };
  // Raw duplicate question IDs cannot be resolved by Map insertion order, even
  // when both records happen to contain identical source or answer metadata.
  // Keep both stored originals for repair, but neither can certify readiness
  // or source-week coverage in this read model.
  const seenQuestionIds = new Set<string>();
  const duplicateQuestionIds = new Set<string>();
  for (const question of input.questions) {
    if (seenQuestionIds.has(question.id)) duplicateQuestionIds.add(question.id);
    seenQuestionIds.add(question.id);
  }
  const byId = new Map(input.questions.map((question) => [question.id, question]));
  // A Map silently drops the first source set when raw originals share an
  // identity. Hold every collided original before scope or week attribution.
  const seenSetIds = new Set<string>();
  const duplicateSetIds = new Set<string>();
  for (const set of input.sets) {
    if (seenSetIds.has(set.id)) duplicateSetIds.add(set.id);
    seenSetIds.add(set.id);
  }
  const ambiguousMembers = new Set<string>();
  for (const set of input.sets) {
    if (duplicateSetIds.has(set.id)) {
      for (const id of set.questionIds) ambiguousMembers.add(id);
    }
  }
  // A collection held for identity ambiguity cannot certify either its own
  // coverage or inherited question scope. Keep one eligibility decision for
  // primary lookups, legacy memberships and collection indexing.
  const heldSetIds = new Set<string>();
  for (const set of input.sets) {
    const ambiguousPrimary = set.questionIds.some((id) => {
      if (duplicateQuestionIds.has(id)) return true;
      const member = byId.get(id);
      return Boolean(member && (member.setId != null
        ? duplicateSetIds.has(member.setId)
        : ambiguousMembers.has(id)));
    });
    if (duplicateSetIds.has(set.id) || ambiguousPrimary) heldSetIds.add(set.id);
  }
  const setsById = new Map(input.sets.filter((set) => !heldSetIds.has(set.id)).map((set) => [set.id, set]));
  const memberships = new Map<string, CourseScope[]>();
  for (const set of input.sets) {
    if (heldSetIds.has(set.id)) continue;
    for (const id of new Set(set.questionIds)) {
      if (!set.scope) continue;
      memberships.set(id, [...(memberships.get(id) ?? []), set.scope]);
    }
  }
  let unassignedQuestions = 0;
  for (const question of input.questions) {
    // Neither a last-write-wins primary nor a legacy secondary membership may
    // certify a question whose original source-set identity is ambiguous.
    if (duplicateQuestionIds.has(question.id)
      || (question.setId != null && duplicateSetIds.has(question.setId))
      || (question.setId == null && ambiguousMembers.has(question.id))) {
      unassignedQuestions += 1;
      continue;
    }
    const scope = questionScope(question, setsById);
    // Older questions sometimes have immutable set membership but no setId.
    // Inherit it only when all eligible memberships agree on a unique module.
    // Declared primary references (including stale/empty IDs) may not be
    // silently repaired from secondary review-set membership.
    const related = question.setId == null ? memberships.get(question.id) ?? [] : [];
    const fallback = related.map(resolve).filter((entry): entry is Resolution => entry !== undefined);
    const fallbackKeys = new Set(fallback.map((entry) => entry.key));
    // The resolved owner is common to every membership, but the first raw
    // scope may omit a course ID or contradict the question's own local ID.
    // Combine all explicit evidence before inheriting any missing filing.
    const fallbackOwner = fallbackKeys.size === 1 && related.length === fallback.length
      ? fallback[0]?.owner : undefined;
    const relatedCourseIds = new Set(related.map((entry) => entry.courseId).filter((id): id is string => Boolean(id)));
    const [relatedCourseId] = relatedCourseIds;
    const compatibleFallback = Boolean(fallbackOwner
      && (!scope.module || canonicalModuleKey(scope.module) === canonicalModuleKey(fallbackOwner.module))
      && relatedCourseIds.size <= 1
      && (!scope.courseId || !relatedCourseId || scope.courseId === relatedCourseId));
    // All legacy set memberships must state the same valid week. Ambiguous
    // or missing evidence is not a source-week assignment.
    const relatedWeeks = related.map((entry) => parseWeek(entry.week));
    const inheritedWeek = relatedWeeks.length > 0 && relatedWeeks.every((week) => week !== undefined)
      && new Set(relatedWeeks).size === 1 ? relatedWeeks[0] : undefined;
    const finalScope: CourseScope = {
      module: scope.module ?? (compatibleFallback ? fallbackOwner?.module : undefined),
      courseId: scope.courseId ?? (compatibleFallback ? relatedCourseId : undefined),
      week: scope.week ?? (!hasDeclaredWeek(question.week) && compatibleFallback ? inheritedWeek : undefined),
    };
    const resolved = resolve(finalScope);
    if (!resolved) { unassignedQuestions += 1; continue; }
    const draft = draftFor(resolved);
    draft.present.add(question.id);
    (questionMappingStatus(question) === "ready" ? draft.ready : draft.review).add(question.id);
    if (finalScope.week !== undefined) draft.weeks.add(finalScope.week);
    else draft.unresolvedWeeks.add(question.id);
    (resolved.method === "course" ? draft.courseAssignments : draft.outlineAssignments).add(question.id);
  }
  let unassignedCollections = 0;
  for (const set of input.sets) {
    // Use the same identity gate that excluded unsafe scope inheritance.
    if (heldSetIds.has(set.id)) {
      unassignedCollections += 1;
      continue;
    }
    const indexedSetWeek = parseWeek(set.scope?.week);
    const invalidSetWeek = hasDeclaredWeek(set.scope?.week) && indexedSetWeek === undefined;
    // Set-owned metadata wins if it resolves. A collection whose membership
    // spans different modules is not assigned by a filename or first record.
    const presentMembers = [...new Set(set.questionIds)].flatMap((id) =>
      byId.has(id) ? [byId.get(id)!] : []);
    const memberAssignments = presentMembers.map((member) => {
      const scope = questionScope(member, setsById);
      return { scope, assignment: resolve(scope),
        invalidWeek: hasDeclaredWeek(member.week) && parseWeek(member.week) === undefined,
        alternatePrimary: member.setId != null && member.setId !== set.id };

    });
    const memberResolutions = memberAssignments.flatMap(({ assignment }) => assignment ? [assignment] : []);
    const direct = set.scope ? resolve(set.scope) : undefined;
    const uniqueMemberKeys = new Set(memberResolutions.map((entry) => entry.key));
    const target = direct ?? (memberResolutions.length > 0 && uniqueMemberKeys.size === 1
      ? memberResolutions[0] : undefined);
    const contradictsSource = memberAssignments.some(({ scope, assignment, invalidWeek, alternatePrimary }) => {
      // Neither malformed own weeks nor review-set-only weeks justify a
      // source-indexed collection.
      if (invalidWeek || (alternatePrimary && indexedSetWeek !== undefined && scope.week === undefined)) return true;
      if (assignment && target && assignment.key !== target.key) return true;
      if (scope.courseId && set.scope?.courseId && scope.courseId !== set.scope.courseId) return true;
      if (scope.week !== undefined && indexedSetWeek !== undefined && scope.week !== indexedSetWeek) return true;
      // A present member with explicit but unresolvable ownership is not
      // silently granted the set's declared course/term.
      return Boolean((scope.module || scope.courseId) && !assignment);
    });
    if (!target || invalidSetWeek || contradictsSource || uniqueMemberKeys.size > 1
      || (!direct && memberResolutions.length !== memberAssignments.length)
      || (memberResolutions.length && !uniqueMemberKeys.has(target.key))) {
      unassignedCollections += 1;
      continue;
    }
    const draft = draftFor(target);
    draft.collections.add(set.id);
    if (indexedSetWeek !== undefined) draft.weeks.add(indexedSetWeek);
    for (const questionId of new Set(set.questionIds)) {
      if (!byId.has(questionId)) draft.missing.add(questionId);
    }
  }
  return {
    byModule: new Map([...drafts].map(([key, draft]) => [key, {
      term: draft.owner.term, module: draft.owner.module,
      collections: draft.collections.size,
      storedQuestions: draft.present.size,
      readyQuestions: draft.ready.size,
      reviewQuestions: draft.review.size,
      missingReferencedQuestions: draft.missing.size,
      indexedWeeks: [...draft.weeks].sort((a, b) => a - b),
      unresolvedWeekQuestions: draft.unresolvedWeeks.size,
      explicitCourseAssignments: draft.courseAssignments.size,
      outlineAssignments: draft.outlineAssignments.size,
    }])),
    unassignedCollections,
    unassignedQuestions,
  };
}
