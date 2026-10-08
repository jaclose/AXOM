// ===========================================================================
// Loading a course book into Course Tracker. Opening a book changes nothing;
// this is the one step that writes, and it only ever adds: a term, a course
// or a module that is not there yet. Loading the same book twice adds
// nothing the second time.
// ===========================================================================
import { moduleKey } from "../course-engine/vocabulary";
import type { Course, Term } from "../types";
import type { CourseBook } from "./courseBooks";

export interface CourseLoadPlan {
  /** True when the module is already in the workspace and nothing would be added. */
  alreadyPresent: boolean;
  addsTerm: boolean;
  addsCourse: boolean;
  addsModule: boolean;
  /** What will happen, in a sentence the learner reads before confirming. */
  summary: string;
}

type Workspace = { terms: readonly Term[]; courses: readonly Course[] };

function locate(workspace: Workspace, book: CourseBook): { term?: Term; course?: Course; hasModule: boolean } {
  const term = workspace.terms.find((entry) => moduleKey(entry.name) === moduleKey(book.term));
  const course = term ? workspace.courses.find((entry) => entry.termId === term.id && moduleKey(entry.code) === moduleKey(book.courseCode ?? "")) : undefined;
  return { term, course, hasModule: Boolean(course?.modules.some((module) => moduleKey(module.name) === moduleKey(book.module))) };
}

export function planCourseLoad(workspace: Workspace, book: CourseBook): CourseLoadPlan {
  const found = locate(workspace, book);
  const adds = { addsTerm: !found.term, addsCourse: !found.course, addsModule: !found.hasModule };
  const parts = [
    ...(adds.addsTerm ? [`the term ${book.term}`] : []),
    ...(adds.addsCourse ? [`the course ${book.courseCode ?? book.term}`] : []),
    ...(adds.addsModule ? [`the module ${book.module}`] : []),
  ];
  return {
    alreadyPresent: found.hasModule,
    ...adds,
    summary: found.hasModule
      ? `${book.module} is already in your Course Tracker. Nothing will change.`
      : `Adds ${parts.join(", ")} to your Course Tracker. Nothing you already have is changed or removed.`,
  };
}

const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;

/** The workspace with the book's module added. The lists it is given are not changed. */
export function applyCourseLoad(workspace: Workspace, book: CourseBook, makeId: (prefix: string) => string = newId): { terms: Term[]; courses: Course[] } {
  const found = locate(workspace, book);
  if (found.hasModule) return { terms: [...workspace.terms], courses: [...workspace.courses] };
  const term: Term = found.term ?? { id: makeId("term"), name: book.term };
  const module = { id: makeId("module"), name: book.module };
  const terms = found.term ? [...workspace.terms] : [...workspace.terms, term];
  if (found.course) {
    return { terms, courses: workspace.courses.map((course) => (course.id === found.course!.id ? { ...course, modules: [...course.modules, module] } : course)) };
  }
  const course: Course = { id: makeId("course"), termId: term.id, code: book.courseCode ?? book.term, name: book.courseName ?? "", files: 0, modules: [module] };
  return { terms, courses: [...workspace.courses, course] };
}

export type SaveOutcome =
  /** Written to this device's storage. Not a claim about a backup or about sync. */
  | { status: "saved-on-device" }
  | { status: "nothing-to-save" }
  | { status: "failed"; message: string };

/**
 * Applies the load to the live store and waits for it to reach the device.
 * It reports "saved" only after the write has finished, and says so when it
 * has not.
 */
export async function commitCourseLoad(book: CourseBook): Promise<SaveOutcome> {
  const [{ useStore }, { flushLocalVaultWrites }] = await Promise.all([import("../store"), import("../localVault")]);
  const state = useStore.getState();
  if (planCourseLoad(state, book).alreadyPresent) return { status: "nothing-to-save" };
  try {
    useStore.setState(applyCourseLoad(state, book));
    await flushLocalVaultWrites();
    return { status: "saved-on-device" };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : "The change could not be saved on this device." };
  }
}
