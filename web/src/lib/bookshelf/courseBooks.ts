// ===========================================================================
// Course books: one for each module of each course, read from the workspace
// and from the curriculum map the app already carries. The inside of a book
// is the Course Engine's own week view. No course model of its own.
// ===========================================================================
import { COURSE_ACTIVITY_LABEL, countActivity, type CourseActivity } from "../course-engine/activity";
import { trackerPathScope } from "../course-engine/scope";
import { moduleKey } from "../course-engine/vocabulary";
import { buildModuleWeeks } from "../course-engine/weekView";
import type { CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import type { Course, Term, TrackerItem } from "../types";
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

/**
 * A book is the same book before and after it is loaded: its id comes from
 * where it stands (term, course, module), not from the record that backs it.
 * An open book therefore stays open while the workspace changes under it.
 */
export function courseBookId(term: string, courseCode: string, module: string): string {
  return `course:${moduleKey(term)}:${moduleKey(courseCode)}:${moduleKey(module)}`;
}

export function buildCourseBooks(input: CourseBookInput): CourseBook[] {
  const setsById = new Map((input.sets ?? []).map((set) => [set.id, set]));
  const byModule = new Map(buildModuleWeeks(input.tracker, input.questions ?? [], setsById).map((entry) => [entry.key, entry]));
  // Rows that name the module in their path but sit under no "Week N".
  const loose = new Map<string, number>();
  for (const item of input.tracker) {
    if (trackerPathScope(item.path).week) continue;
    for (const segment of item.path.split("/")) {
      const key = moduleKey(segment);
      if (key) loose.set(key, (loose.get(key) ?? 0) + 1);
    }
  }
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
      const key = moduleKey(module.name);
      present.add(`${moduleKey(term)}|${key}`);
      const found = byModule.get(key);
      const weeks: CourseBookWeek[] = (found?.weeks ?? []).map((week) => ({
        week: week.week,
        total: week.items.length,
        done: week.done,
        activities: week.byActivity.map((entry) => ({ activity: entry.activity, label: activityLabel(entry.activity, entry.total), total: entry.total, done: entry.done })),
        items: week.items.map((item) => ({ id: item.id, label: item.label, kind: item.activity ? COURSE_ACTIVITY_LABEL[item.activity] : item.kind })),
      }));
      const unfiled = loose.get(key) ?? 0;
      const count = (found?.total ?? 0) + unfiled;
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
        done: found?.done ?? 0,
      });
    }
  }

  for (const curriculum of input.curricula ?? []) {
    for (const term of curriculum.terms) {
      for (const course of term.courses) {
        for (const module of course.modules) {
          if (present.has(`${moduleKey(term.name)}|${moduleKey(module)}`)) continue;
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
