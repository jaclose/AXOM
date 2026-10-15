import type { QuestionBankBook } from "../bookshelf/questionBankBooks";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { STORAGE_KEYS } from "../brand";

/** One handoff identity and size contract for curriculum and QBank. */
export const COURSE_QUIZ_LAUNCH_KEY = "axom.courseQuizLaunch.v1";
export const MAX_COURSE_QUIZ_QUESTIONS = 2000;
export interface CourseQuizLaunch {
  module: string;
  term: string;
  /** Optional stable owner identity for same-named modules in different courses. */
  courseId?: string;
  week?: number;
  questionIds: string[];
  setIds: string[];
}

/** A fixed canonical selection. An empty course never means the whole bank. */
export function courseQuizSelection(bank: QuestionBankBook, week?: number): CourseQuizLaunch {
  const collections = bank.weeks.filter(entry => week === undefined || entry.week === week)
    .flatMap(entry => entry.collections).filter(entry => entry.ready > 0);
  return { module: bank.module, term: bank.term, week,
    ...(bank.courseId ? { courseId: bank.courseId } : {}),
    questionIds: [...new Set(collections.flatMap(entry => entry.readyQuestionIds ?? []))],
    setIds: [...new Set(collections.flatMap(entry => entry.setId ? [entry.setId] : []))] };
}

export function launchCourseQuiz(selection: CourseQuizLaunch): void {
  if (!selection.questionIds.length) throw new Error("No reviewed questions are available in this selection yet.");
  if (selection.questionIds.length > MAX_COURSE_QUIZ_QUESTIONS
    || new Set(selection.questionIds).size !== selection.questionIds.length
    || selection.questionIds.some(id => typeof id !== "string" || !id.trim())
    || !selection.module.trim() || !selection.term.trim()
    || (selection.week !== undefined && (!Number.isSafeInteger(selection.week) || selection.week < 1))
    || (selection.courseId !== undefined && !selection.courseId.trim())
    || selection.setIds.length > MAX_COURSE_QUIZ_QUESTIONS) {
    throw new Error("The course practice selection is invalid or exceeds its supported question limit.");
  }
  const active = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null") as { poolIds?: unknown[] } | null;
  if (active?.poolIds?.length) throw new Error("Resume or finish your current quiz in Question Bank before starting another.");
  sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, JSON.stringify(selection));
  location.hash = "questions";
}

/** Reading is pure so React's repeated initializers cannot consume the request. */
export function readCourseQuizLaunch(questions: readonly QuestionRecord[]): CourseQuizLaunch | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null");
    if (!value || typeof value !== "object" || !("questionIds" in value) || !Array.isArray(value.questionIds)
      || !("module" in value) || typeof value.module !== "string" || !value.module.trim()
      || !("term" in value) || typeof value.term !== "string" || !value.term.trim()
      || value.questionIds.length < 1 || value.questionIds.length > MAX_COURSE_QUIZ_QUESTIONS
      || value.questionIds.some(id => typeof id !== "string" || !id.trim())
      || new Set(value.questionIds).size !== value.questionIds.length
      || ("week" in value && value.week !== undefined && (!Number.isSafeInteger(value.week) || (value.week as number) < 1))
      || ("courseId" in value && value.courseId !== undefined && (typeof value.courseId !== "string" || !value.courseId.trim()))
      || ("setIds" in value && (!Array.isArray(value.setIds) || value.setIds.length > MAX_COURSE_QUIZ_QUESTIONS
        || value.setIds.some(id => typeof id !== "string" || !id.trim())))) return null;
    const questionIds = value.questionIds as string[];
    const eligible = new Set(questions.filter(question => questionMappingStatus(question) === "ready" && question.options.length >= 2).map(question => question.id));
    // A partial hydration MUST NOT produce a shorter practice block. Keep the
    // original request untouched until every exact question is ready on-device.
    if (!questionIds.every(id => eligible.has(id))) return null;
    return { module: value.module, term: value.term, questionIds,
      ...("courseId" in value && typeof value.courseId === "string" ? { courseId: value.courseId } : {}),
      ...("week" in value && typeof value.week === "number" ? { week: value.week } : {}),
      setIds: "setIds" in value && Array.isArray(value.setIds) ? value.setIds as string[] : [] };
  } catch { return null; }
}

export function clearCourseQuizLaunch(): void { sessionStorage.removeItem(COURSE_QUIZ_LAUNCH_KEY); }
