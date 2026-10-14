import type { QuestionBankBook } from "../bookshelf/questionBankBooks";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { STORAGE_KEYS } from "../brand";

/** One handoff identity shared by curriculum producer and QBank consumer. */
export const COURSE_QUIZ_LAUNCH_KEY = "axom.courseQuizLaunch.v1";
export interface CourseQuizLaunch {
  module: string;
  term: string;
  week?: number;
  questionIds: string[];
  setIds: string[];
}

/** A fixed canonical selection. An empty course never means the whole bank. */
export function courseQuizSelection(bank: QuestionBankBook, week?: number): CourseQuizLaunch {
  const collections = bank.weeks.filter(entry => week === undefined || entry.week === week)
    .flatMap(entry => entry.collections).filter(entry => entry.ready > 0);
  return { module: bank.module, term: bank.term, week,
    questionIds: [...new Set(collections.flatMap(entry => entry.readyQuestionIds ?? []))],
    setIds: [...new Set(collections.flatMap(entry => entry.setId ? [entry.setId] : []))] };
}

export function launchCourseQuiz(selection: CourseQuizLaunch): void {
  if (!selection.questionIds.length) throw new Error("No reviewed questions are available in this selection yet.");
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
      || !("module" in value) || typeof value.module !== "string" || !("term" in value) || typeof value.term !== "string") return null;
    const eligible = new Set(questions.filter(question => questionMappingStatus(question) === "ready" && question.options.length >= 2).map(question => question.id));
    const questionIds = [...new Set(value.questionIds.filter((id): id is string => typeof id === "string" && eligible.has(id)))];
    return questionIds.length ? { module: value.module, term: value.term, questionIds,
      week: "week" in value && typeof value.week === "number" ? value.week : undefined,
      setIds: "setIds" in value && Array.isArray(value.setIds) ? value.setIds.filter((id): id is string => typeof id === "string") : [] } : null;
  } catch { return null; }
}

export function clearCourseQuizLaunch(): void { sessionStorage.removeItem(COURSE_QUIZ_LAUNCH_KEY); }
