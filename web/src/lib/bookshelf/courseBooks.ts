// ===========================================================================
// Course books: one for each module of each course, read from the workspace
// and from the curriculum map the app already carries. The inside of a book
// is the Course Engine's own week view. No course model of its own.
// ===========================================================================
import { COURSE_ACTIVITY_LABEL, countActivity, type CourseActivity } from "../course-engine/activity";
import { trackerPathScope } from "../course-engine/scope";
import { canonicalModuleKey, moduleKey } from "../course-engine/vocabulary";
import { buildModuleWeeks } from "../course-engine/weekView";
import type { CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import type { Course, Term, TrackerItem } from "../types";
import type { CourseTemplateContext } from "../course-engine/templateParse";
import { countWords, type ShelfBook } from "./model";

export interface CourseBookActivity {
  activity: CourseActivity | "other";
  /** "6 lectures", "1 IMCQ". */
  label: string;
  total: number;
  done: number;
}

export interface CourseBookWeek {
  week: number;
  total: number;
  done: number;
  activities: CourseBookActivity[];
  /** The rows themselves, for a look inside before loading. */
  items: { id: string; label: string; kind: string }[];
}

export interface CourseBook extends ShelfBook {
  kind: "course";
  module: string;
  term: string;
  courseCode?: string;
  courseName?: string;
  /** Set when the module is already in the workspace. */
  courseId?: string;
  moduleId?: string;
  /** Where the book comes from: the learner's workspace, or the curriculum map with nothing loaded. */
  origin: "workspace" | "curriculum";
  curriculumId?: string;
  weeks: CourseBookWeek[];
  /** Rows filed under the module but under no week. */
  unfiled: number;
  done: number;
  templateIds?: string[];
  templateVersion?: string;
  loadedActivities?: number;
  academicContext?: CourseTemplateContext;
}

export interface CourseBookInput {
  terms: readonly Term[];
  courses: readonly Course[];
  tracker: readonly TrackerItem[];
  questions?: readonly QuestionRecord[];
  sets?: readonly QuestionSet[];
  /** Curriculum maps whose modules are shown as empty books until they are loaded. */
  curricula?: readonly CurriculumTemplate[];
}

const activityLabel = (activity: CourseActivity | "other", count: number): string =>
  activity === "other" ? countWords.one(count, "other item") : countActivity(activity, count);

/** T2 / Term 2 are equivalent in learner paths, but book IDs stay backward compatible. */
const termKey = (name: string): string => {
  const match = name.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : moduleKey(name);
};

/**
 * A book is the same book before and after it is loaded: its id comes from
 * where it stands (term, course, module), not from the record that backs it.
 * An open book therefore stays open while the workspace changes under it.
 */
export function courseBookId(term: string, courseCode: string, module: string): string {
  return `course:${moduleKey(term)}:${moduleKey(courseCode)}:${canonicalModuleKey(module)}`;
}

export function buildCourseBooks(input: CourseBookInput): CourseBook[] {
  const setsById = new Map((input.sets ?? []).map((set) => [set.id, set]));
  // The Course Engine is keyed by term / course / canonical module. A flat
  // module-name map discards both course ownership and every legacy week row.
  const moduleWeeks = buildModuleWeeks(input.tracker, input.questions ?? [], setsById, {
    terms: input.terms, courses: input.courses,
  });
  const courseModuleCount = new Map<string, number>();
  for (const course of input.courses) {
    const term = input.terms.find((entry) => entry.id === course.termId)?.name ?? "";
    for (const module of course.modules) {
      const key = `${termKey(term)}|${canonicalModuleKey(module.name)}`;
      courseModuleCount.set(key, (courseModuleCount.get(key) ?? 0) + 1);
    }
  }

  /** Assign legacy Term/Module paths only if one course owns that module. */
  const ownsPath = (term: string, courseCode: string, module: string, pathTerm: string,
    pathCourse?: string, pathModule?: string): boolean => {
    if (termKey(term) !== termKey(pathTerm)
        || canonicalModuleKey(module) !== canonicalModuleKey(pathModule ?? "")) return false;
    if (pathCourse) return moduleKey(pathCourse) === moduleKey(courseCode);
    return courseModuleCount.get(`${termKey(term)}|${canonicalModuleKey(module)}`) === 1;
  };

  // Unscheduled / loose rows have no "Week N", so trackerPathScope deliberately
  // does not claim a module. Inspect the actual term/course path explicitly.
  const looseRows = input.tracker.filter((item) => !trackerPathScope(item.path).week)
    .map((item) => {
      const segments = item.path.split("/").map((entry) => entry.trim()).filter(Boolean);
      const explicitCourse = input.courses.some((course) =>
        termKey(input.terms.find((term) => term.id === course.termId)?.name ?? "") === termKey(segments[0] ?? "")
        && moduleKey(course.code) === moduleKey(segments[1] ?? ""));
      return {
        item,
        term: segments[0] ?? "",
        course: explicitCourse ? segments[1] : undefined,
        module: explicitCourse ? segments[2] : segments[1],
      };
    });
  const termName = new Map(input.terms.map((term) => [term.id, term.name]));
  const books: CourseBook[] = [];
  const present = new Set<string>();
  const taken = new Set<string>();
  const unique = (id: string): string => {
    let candidate = id;
    for (let copy = 2; taken.has(candidate); copy += 1) candidate = `${id}:${copy}`;
    taken.add(candidate);
    return candidate;
  };

  for (const course of input.courses) {
    const term = termName.get(course.termId) ?? "Not in a term";
    for (const module of course.modules) {
      present.add(`${termKey(term)}|${moduleKey(course.code)}|${canonicalModuleKey(module.name)}`);
      const related = moduleWeeks.filter((entry) => ownsPath(
        term, course.code, module.name, entry.term ?? "", entry.course, entry.module,
      ));
      // A learner can have both new Term/Course/Module weeks and legacy
      // Term/Module weeks. Merge their rows once, without changing saved ids.
      const byWeek = new Map<number, Map<string, TrackerItem>>();
      for (const source of related) {
        for (const week of source.weeks) {
          const rows = byWeek.get(week.week) ?? new Map<string, TrackerItem>();
          for (const item of week.items) rows.set(item.id, item);
          byWeek.set(week.week, rows);
        }
      }
      const weeks: CourseBookWeek[] = [...byWeek.entries()]
        .sort(([left], [right]) => left - right)
        .map(([week, rows]) => {
          const items = [...rows.values()];
          const activity = new Map<CourseActivity | "other", { total: number; done: number }>();
          for (const item of items) {
            const key = item.activity ?? "other";
            const current = activity.get(key) ?? { total: 0, done: 0 };
            current.total += 1;
            if (item.passes >= 1) current.done += 1;
            activity.set(key, current);
          }
          return {
            week, total: items.length, done: items.filter((item) => item.passes >= 1).length,
            activities: [...activity.entries()].map(([kind, counts]) => ({
              activity: kind, label: activityLabel(kind, counts.total), ...counts,
            })),
            items: items.map((item) => ({
              id: item.id, label: item.label,
              kind: item.activity ? COURSE_ACTIVITY_LABEL[item.activity] : item.kind,
            })),
          };
        });
      const unfiled = looseRows.filter((entry) => ownsPath(
        term, course.code, module.name, entry.term, entry.course, entry.module,
      )).length;
      const count = weeks.reduce((total, week) => total + week.total, 0) + unfiled;
      books.push({
        kind: "course",
        id: unique(courseBookId(term, course.code, module.name)),
        title: module.name,
        identifier: course.code,
        shelf: term,
        count,
        countLabel: countWords.one(count, "activity", "activities"),
        state: count > 0 ? "available" : "empty",
        ...(count > 0 ? {} : { stateNote: "In your Course Tracker, with no activities yet." }),
        module: module.name,
        term,
        courseCode: course.code,
        ...(course.name ? { courseName: course.name } : {}),
        courseId: course.id,
        moduleId: module.id,
        origin: "workspace",
        weeks,
        unfiled,
        done: weeks.reduce((total, week) => total + week.done, 0),
      });
    }
  }

  for (const curriculum of input.curricula ?? []) {
    for (const term of curriculum.terms) {
      for (const course of term.courses) {
        for (const module of course.modules) {
          if (present.has(`${termKey(term.name)}|${moduleKey(course.code)}|${canonicalModuleKey(module)}`)) continue;
          books.push({
            kind: "course",
            id: unique(courseBookId(term.name, course.code, module)),
            title: module,
            identifier: course.code,
            shelf: term.name,
            count: 0,
            countLabel: "0 activities",
            state: "empty",
            stateNote: "Not loaded yet.",
            module,
            term: term.name,
            courseCode: course.code,
            courseName: course.name,
            origin: "curriculum",
            curriculumId: curriculum.id,
            weeks: [],
            unfiled: 0,
            done: 0,
          });
        }
      }
    }
  }

  // Shelves in the order of the curriculum's terms, then any term only the workspace has.
  const order = [...new Set([...(input.curricula ?? []).flatMap((curriculum) => curriculum.terms.map((term) => term.name)), ...input.terms.map((term) => term.name)])];
  const rank = (shelf: string): number => (order.indexOf(shelf) < 0 ? order.length : order.indexOf(shelf));
  return books.map((book, index) => ({ book, index })).sort((a, b) => rank(a.book.shelf) - rank(b.book.shelf) || a.index - b.index).map((entry) => entry.book);
}
