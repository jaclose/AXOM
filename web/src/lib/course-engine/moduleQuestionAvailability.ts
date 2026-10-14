import type { CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import type { Course, Term } from "../types";
import { questionScope, type CourseScope } from "./scope";
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
  const termName = new Map(input.terms.map((term) => [term.id, term.name]));
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
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
  const byId = new Map(input.questions.map((question) => [question.id, question]));
  const setsById = new Map(input.sets.map((set) => [set.id, set]));
  const memberships = new Map<string, CourseScope[]>();
  for (const set of input.sets) {
    for (const id of new Set(set.questionIds)) {
      if (!set.scope) continue;
      memberships.set(id, [...(memberships.get(id) ?? []), set.scope]);
    }
  }
  let unassignedQuestions = 0;
  for (const question of input.questions) {
    const scope = questionScope(question, setsById);
    // Older questions sometimes have immutable set membership but no setId.
    // Inherit it only when all eligible memberships agree on a unique module.
    const related = memberships.get(question.id) ?? [];
    const fallback = related.map(resolve).filter((entry): entry is Resolution => entry !== undefined);
    const fallbackKeys = new Set(fallback.map((entry) => entry.key));
    const fallbackScope = fallbackKeys.size === 1 && related.length === fallback.length
      ? related[0] : undefined;
    // A question may belong to multiple immutable sets covering different
    // weeks. Never adopt whichever set happened to appear first.
    const relatedWeeks = new Set(related.map((entry) => entry.week).filter((week): week is number => week !== undefined));
    const relatedCourseIds = new Set(related.map((entry) => entry.courseId).filter((id): id is string => Boolean(id)));
    const finalScope: CourseScope = {
      module: scope.module ?? fallbackScope?.module,
      courseId: scope.courseId ?? (relatedCourseIds.size === 1 ? fallbackScope?.courseId : undefined),
      week: scope.week ?? (relatedWeeks.size === 1 ? fallbackScope?.week : undefined),
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
    // Set-owned metadata wins if it resolves. A collection whose membership
    // spans different modules is not assigned by a filename or first record.
    const presentMembers = [...new Set(set.questionIds)].flatMap((id) =>
      byId.has(id) ? [byId.get(id)!] : []);
    const memberAssignments = presentMembers.map((member) => {
      const scope = questionScope(member, setsById);
      return { scope, assignment: resolve(scope) };
    });
    const memberResolutions = memberAssignments.flatMap(({ assignment }) => assignment ? [assignment] : []);
    const direct = set.scope ? resolve(set.scope) : undefined;
    const uniqueMemberKeys = new Set(memberResolutions.map((entry) => entry.key));
    const target = direct ?? (memberResolutions.length > 0 && uniqueMemberKeys.size === 1
      ? memberResolutions[0] : undefined);
    const contradictsSource = memberAssignments.some(({ scope, assignment }) => {
      if (assignment && target && assignment.key !== target.key) return true;
      if (scope.courseId && set.scope?.courseId && scope.courseId !== set.scope.courseId) return true;
      if (scope.week !== undefined && set.scope?.week !== undefined && scope.week !== set.scope.week) return true;
      // A present member with explicit but unresolvable ownership is not
      // silently granted the set's declared course/term.
      return Boolean((scope.module || scope.courseId) && !assignment);
    });
    if (!target || contradictsSource || uniqueMemberKeys.size > 1
      || (!direct && memberResolutions.length !== memberAssignments.length)
      || (memberResolutions.length && !uniqueMemberKeys.has(target.key))) {
      unassignedCollections += 1;
      continue;
    }
    const draft = draftFor(target);
    draft.collections.add(set.id);
    if (set.scope?.week !== undefined) draft.weeks.add(set.scope.week);
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
