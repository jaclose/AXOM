import type { Course, Term } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { questionMappingStatus } from "../questions";
import { parseWeek, questionScope, type CourseScope } from "./scope";
import { canonicalModuleKey } from "./vocabulary";

/** Resolve only a unique course. Repeated module names require an explicit assignment. */
export function courseForScope(scope: CourseScope, courses: readonly Course[]): Course | undefined {
  if (scope.courseId) return courses.find((course) => course.id === scope.courseId);
  if (!scope.module) return undefined;
  const matches = courses.filter((course) => course.modules.some((module) => canonicalModuleKey(module.name) === canonicalModuleKey(scope.module!)));
  return matches.length === 1 ? matches[0] : undefined;
}

export type BankSource = "School PQ" | "IMCQ" | "eSoft" | "Personal" | "AXOM generated" | "Review" | "Imported";
export function bankSource(set: QuestionSet): BankSource {
  if (set.kind === "generated") return "AXOM generated";
  if (set.kind === "review") return "Review";
  if (set.kind === "custom") return "Personal";
  if (/\bimcq/i.test(set.title)) return "IMCQ";
  if (/\be[ -]?soft/i.test(set.title)) return "eSoft";
  if (/\bpq\b|practice questions/i.test(set.title)) return "School PQ";
  return "Imported";
}

export interface BankWeek {
  key: string;
  label: string;
  week?: number;
  sets: QuestionSet[];
  questionIds: string[];
  ready: number;
  attempted: number;
  missed: number;
}
export interface BankModule {
  key: string;
  module: string;
  term: string;
  course: string;
  courseId?: string;
  weeks: BankWeek[];
}

const sameValue = <T,>(values: T[]): T | undefined => values.length && values.every((value) => value === values[0]) ? values[0] : undefined;
const hasDeclaredWeek = (value: unknown): boolean => value != null && (typeof value !== "string" || value.trim() !== "");

/** An indexed read model, never another workspace or progress store. */
export function buildCourseQuestionBank(
  sets: readonly QuestionSet[], questions: readonly QuestionRecord[],
  courses: readonly Course[], terms: readonly Term[],
): BankModule[] {
  // Raw duplicate originals are ambiguous before Map indexing. A last-write-wins
  // lookup or Set-deduplicated member list must never certify a source week,
  // launchable set card or ready count. Leave the records in the library for
  // review and exclude every affected membership from this navigator only.
  const repeatedSetIds = new Set<string>();
  const seenSetIds = new Set<string>();
  const malformedMemberSets = new Set<QuestionSet>();
  const ambiguousQuestionIds = new Set<string>();
  for (const set of sets) {
    if (seenSetIds.has(set.id)) repeatedSetIds.add(set.id);
    seenSetIds.add(set.id);
    if (new Set(set.questionIds).size !== set.questionIds.length) {
      malformedMemberSets.add(set);
      // A malformed review must not erase an independently verified primary.
      // A malformed original cannot be rescued by an unrelated review set.
      if (set.kind !== "review") set.questionIds.forEach((id) => ambiguousQuestionIds.add(id));
    }
  }
  const originalSetIds = new Set(sets.filter((set) => set.kind !== "review").map((set) => set.id));
  for (const set of sets) {
    // Repeated review-only IDs hold those collections, not independent originals.
    // Any collision involving an original retains the full identity quarantine.
    if (repeatedSetIds.has(set.id) && originalSetIds.has(set.id)) {
      set.questionIds.forEach((id) => ambiguousQuestionIds.add(id));
    }
  }
  const seenQuestionIds = new Set<string>();
  for (const question of questions) {
    if (seenQuestionIds.has(question.id)) ambiguousQuestionIds.add(question.id);
    seenQuestionIds.add(question.id);
  }
  // A held collection cannot certify a sibling through another review set.
  // Reuse the collection eligibility decision for primary and legacy scope.
  const heldCollectionIds = new Set(sets.filter((set) =>
    repeatedSetIds.has(set.id) || malformedMemberSets.has(set)
      || set.questionIds.some((id) => ambiguousQuestionIds.has(id)),
  ).map((set) => set.id));
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const setsById = new Map(sets.map((set) => [set.id, set]));
  const memberships = new Map<string, QuestionSet[]>();
  for (const set of sets) {
    for (const id of new Set(set.questionIds)) {
      memberships.set(id, [...(memberships.get(id) ?? []), set]);
    }
  }

  // A question's own filing and primary set always win over other collections.
  // Old records without setId can inherit only unanimous, valid source-set
  // membership. A review collection must not turn an unknown week into a
  // scheduled week or borrow the course of a different primary source.
  const scopesById = new Map<string, CourseScope>();
  for (const question of questions) {
    // Review collections neither certify nor veto an independently supported
    // legacy source week. Their own contradictory filing is checked below.
    const related = (memberships.get(question.id) ?? []).filter((set) =>
      !heldCollectionIds.has(set.id) && set.kind !== "review");
    const source = related[0];
    const first = source?.scope;
    const unanimousLegacy = !question.setId && Boolean(first?.module)
      && related.every((set) =>
      Boolean(set.scope?.module)
      && canonicalModuleKey(set.scope!.module!) === canonicalModuleKey(first!.module!)
      && set.scope?.courseId === first?.courseId
      && (!hasDeclaredWeek(set.scope?.week) || parseWeek(set.scope?.week) !== undefined)
      && parseWeek(set.scope?.week) === parseWeek(first?.week));
    const bound = unanimousLegacy ? { ...question, setId: source!.id } : question;
    scopesById.set(question.id, questionScope(bound, setsById));
  }

  const modules = new Map<string, BankModule>();
  const eligibleBySet = new Map<string, string[]>();
  // First classify local filing contradictions without depending on iteration order.
  const filingHeldIds = new Set(heldCollectionIds);
  const candidates: Array<{ set: QuestionSet; members: QuestionRecord[]; scope: CourseScope; catalogCourse: Course | undefined }> = [];
  for (const set of sets) {
    // This also blocks secondary review sets from laundering a conflicted
    // primary original into a different source week.
    if (heldCollectionIds.has(set.id)) continue;
    const rawWeek = set.scope?.week;
    // Invalid explicit source weeks are review work, not a usable week label.
    if (hasDeclaredWeek(rawWeek) && parseWeek(rawWeek) === undefined) {
      filingHeldIds.add(set.id);
      continue;
    }
    const members = [...new Set(set.questionIds)].flatMap((id) =>
      questionsById.has(id) ? [questionsById.get(id)!] : []);
    const scopes = members.map((question) => scopesById.get(question.id)!);
    const scope: CourseScope = {
      module: set.scope?.module ?? sameValue(scopes.map((entry) => entry.module)),
      week: hasDeclaredWeek(rawWeek) ? parseWeek(rawWeek) : sameValue(scopes.map((entry) => entry.week)),
      courseId: set.scope?.courseId ?? sameValue(scopes.map((entry) => entry.courseId)),
    };

    // Week numbering without a module has no unambiguous academic owner.
    if (!scope.module && scope.week !== undefined) {
      filingHeldIds.add(set.id);
      continue;
    }
    const catalogCourse = courseForScope(scope, courses);

    // Explicit course/module ownership must agree with the local catalog.
    // Do not reparent a stale assignment to another course or certify a
    // module absent from the assigned course. Keep the original collection
    // and attempts intact for review outside this academic navigator.
    if (scope.courseId && scope.module && (!catalogCourse || !catalogCourse.modules.some((module) =>
      canonicalModuleKey(module.name) === canonicalModuleKey(scope.module!)))) {
      filingHeldIds.add(set.id);
      continue;
    }

    // A contradictory source set is not a safe practice collection. Exclude
    // the *entire* set from this course/week navigator (not from the library)
    // so its raw IDs cannot still launch through Practice week or a set card.
    // Missing references remain in the original set for repair, unchanged.
    const conflicting = members.some((question) => {
      const own = scopesById.get(question.id)!;
      const primary = question.setId != null ? setsById.get(question.setId) : undefined;
      const primaryScope = primary?.scope;
      const primaryWeek = parseWeek(primaryScope?.week);
      // A question's refiled fields cannot silently override contradictory
      // primary-source proof just because a secondary review set agrees.
      const contradictsPrimary = question.setId != null && (
        !primary || primary.kind === "review" || heldCollectionIds.has(primary.id) || !primary.questionIds.includes(question.id)
        || (hasDeclaredWeek(primaryScope?.week) && primaryWeek === undefined)
        || Boolean(primaryScope && (
          (primaryScope.module && own.module
            && canonicalModuleKey(primaryScope.module) !== canonicalModuleKey(own.module))
          || (primaryWeek !== undefined && own.week !== undefined && own.week !== primaryWeek)
          || (primaryScope.courseId && own.courseId && primaryScope.courseId !== own.courseId)
        ))
      );
      return (hasDeclaredWeek(question.week) && parseWeek(question.week) === undefined)
        || contradictsPrimary
        || Boolean(scope.module && (!own.module
          || canonicalModuleKey(own.module) !== canonicalModuleKey(scope.module)))
        || Boolean(scope.courseId && own.courseId !== scope.courseId)
        || Boolean(catalogCourse && own.courseId && own.courseId !== catalogCourse.id)
        || (scope.week !== undefined && own.week !== scope.week);
    });
    if (conflicting) {
      filingHeldIds.add(set.id);
      continue;
    }
    candidates.push({ set, members, scope, catalogCourse });
  }

  // A collection-wide filing hold also invalidates practice collections that
  // depend on that original, even if their own subset looks consistent. Legacy
  // records without an explicit primary cannot prove independence from any of
  // their non-review source memberships. Explicitly bound questions in a
  // different, valid primary remain independent of secondary collection holds.
  const dependentsByPrimary = new Map<string, Set<string>>();
  for (const { set, members } of candidates) {
    for (const question of members) {
      const primaryIds = question.setId != null ? [question.setId]
        : (memberships.get(question.id) ?? []).filter((entry) => entry.kind !== "review").map((entry) => entry.id);
      for (const primaryId of primaryIds) {
        if (primaryId === set.id) continue;
        const dependents = dependentsByPrimary.get(primaryId) ?? new Set<string>();
        dependents.add(set.id);
        dependentsByPrimary.set(primaryId, dependents);
      }
    }
  }
  // Set iteration visits newly added holds; each ID is processed at most once.
  // This closes transitive dependencies before any week/card becomes visible.
  for (const heldId of filingHeldIds) {
    for (const dependentId of dependentsByPrimary.get(heldId) ?? []) {
      filingHeldIds.add(dependentId);
    }
  }
  for (const { set, members, scope, catalogCourse } of candidates) {
    if (filingHeldIds.has(set.id)) continue;
    const course = catalogCourse;
    const term = terms.find((item) => item.id === course?.termId)?.name ?? "Not yet assigned";
    const key = JSON.stringify([course?.id ?? scope.courseId ?? "unassigned", canonicalModuleKey(scope.module ?? "")]);
    const branch = modules.get(key) ?? {
      key, term, course: course?.name || course?.code || "Choose a course when filing",
      courseId: course?.id, module: scope.module ?? "Unfiled & mixed", weeks: [],
    };
    const weekKey = `${key}|${scope.week ?? "mixed"}`;
    let week = branch.weeks.find((entry) => entry.key === weekKey);
    if (!week) {
      week = { key: weekKey, label: scope.week ? `Week ${scope.week}` : "No single week", week: scope.week,
        sets: [], questionIds: [], ready: 0, attempted: 0, missed: 0 };
      branch.weeks.push(week);
    }
    week.sets.push(set);
    eligibleBySet.set(set.id, members.map((question) => question.id));
    modules.set(key, branch);
  }
  for (const branch of modules.values()) {
    branch.weeks.sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity));
    for (const week of branch.weeks) {
      // A review set and its primary source count one eligible question once.
      week.questionIds = [...new Set(week.sets.flatMap((set) => eligibleBySet.get(set.id) ?? []))];
      const members = week.questionIds.map((id) => questionsById.get(id)!);
      week.ready = members.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).length;
      week.attempted = members.filter((question) => question.attempts.length > 0).length;
      week.missed = members.filter((question) => question.status === "incorrect").length;
      week.sets.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    }
  }
  return [...modules.values()].sort((a, b) => {
    if (!!a.courseId !== !!b.courseId) return a.courseId ? -1 : 1;
    return `${a.term}/${a.course}/${a.module}`.localeCompare(`${b.term}/${b.course}/${b.module}`, undefined, { numeric: true });
  });
}
