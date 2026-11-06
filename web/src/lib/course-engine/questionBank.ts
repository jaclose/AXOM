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
  // Never let a duplicate original ID pick the last saved row. Conflicting
  // source identity or practice history must be repaired before any collection
  // carrying that ID appears as a runnable week; the saved rows stay untouched.
  const questionsById = new Map<string, QuestionRecord>();
  const conflictingQuestionIds = new Set<string>();
  const identity = (question: QuestionRecord): string => JSON.stringify([
    question.source, question.setId ?? null, question.sourceDocumentId ?? null,
    question.sourcePage ?? null, question.questionNumber ?? null,
    question.courseId ?? null, canonicalModuleKey(question.module ?? ""),
    hasDeclaredWeek(question.week) ? parseWeek(question.week) ?? "invalid" : null,
    question.stem, question.options.map((option) => [option.key, option.text]),
    question.content ?? null, question.correctKey ?? null,
    questionMappingStatus(question), question.status, question.attempts,
  ]);
  for (const question of questions) {
    const first = questionsById.get(question.id);
    if (!first) questionsById.set(question.id, question);
    else if (identity(first) !== identity(question)) conflictingQuestionIds.add(question.id);
  }
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
  for (const question of questionsById.values()) {
    if (conflictingQuestionIds.has(question.id)) continue;
    const related = memberships.get(question.id) ?? [];
    // Bind legacy inference to a source collection, never to the first review
    // collection encountered in an arbitrary array ordering.
    const source = related.find((set) => set.kind !== "review");
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
  for (const set of sets) {
    // A partially conflicting original would make the entire launch set unsafe.
    // Keep it in the library for repair rather than dropping just that member.
    if (set.questionIds.some((id) => conflictingQuestionIds.has(id))) continue;
    const rawWeek = set.scope?.week;
    // Invalid explicit source weeks are review work, not a usable week label.
    if (hasDeclaredWeek(rawWeek) && parseWeek(rawWeek) === undefined) continue;
    const members = [...new Set(set.questionIds)].flatMap((id) =>
      questionsById.has(id) ? [questionsById.get(id)!] : []);
    const scopes = members.map((question) => scopesById.get(question.id)!);
    const scope: CourseScope = {
      module: set.scope?.module ?? sameValue(scopes.map((entry) => entry.module)),
      week: hasDeclaredWeek(rawWeek) ? parseWeek(rawWeek) : sameValue(scopes.map((entry) => entry.week)),
      courseId: set.scope?.courseId ?? sameValue(scopes.map((entry) => entry.courseId)),
    };

    // Week numbering without a module has no unambiguous academic owner.
    if (!scope.module && scope.week !== undefined) continue;
    const catalogCourse = courseForScope(scope, courses);

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
        !primary || !primary.questionIds.includes(question.id)
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
    if (conflicting) continue;

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
