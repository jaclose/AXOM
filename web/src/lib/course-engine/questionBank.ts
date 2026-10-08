import type { Course, Term } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { questionMappingStatus } from "../questions";
import { questionScope, type CourseScope } from "./scope";
import { moduleKey } from "./vocabulary";

/** Resolve only a unique course. Repeated module names require an explicit assignment. */
export function courseForScope(scope: CourseScope, courses: readonly Course[]): Course | undefined {
  if (scope.courseId) return courses.find((course) => course.id === scope.courseId);
  if (!scope.module) return undefined;
  const matches = courses.filter((course) => course.modules.some((module) => moduleKey(module.name) === moduleKey(scope.module!)));
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

/** An indexed read model, never another workspace or progress store. */
export function buildCourseQuestionBank(
  sets: readonly QuestionSet[], questions: readonly QuestionRecord[],
  courses: readonly Course[], terms: readonly Term[],
): BankModule[] {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const setsById = new Map(sets.map((set) => [set.id, set]));
  const modules = new Map<string, BankModule>();
  for (const set of sets) {
    const members = set.questionIds.flatMap((id) => questionsById.has(id) ? [questionsById.get(id)!] : []);
    const scopes = members.map((question) => questionScope(question, setsById));
    const scope: CourseScope = {
      module: set.scope?.module ?? sameValue(scopes.map((entry) => entry.module)),
      week: set.scope?.week ?? sameValue(scopes.map((entry) => entry.week)),
      courseId: set.scope?.courseId ?? sameValue(scopes.map((entry) => entry.courseId)),
    };
    const course = courseForScope(scope, courses);
    const term = terms.find((item) => item.id === course?.termId)?.name ?? "Not yet assigned";
    const key = JSON.stringify([course?.id ?? scope.courseId ?? "unassigned", moduleKey(scope.module ?? "")]);
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
    modules.set(key, branch);
  }
  for (const branch of modules.values()) {
    branch.weeks.sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity));
    for (const week of branch.weeks) {
      // A review set and its source count the same underlying question once.
      week.questionIds = [...new Set(week.sets.flatMap((set) => set.questionIds))].filter((id) => questionsById.has(id));
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
