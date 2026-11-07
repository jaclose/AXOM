import type { QuestionBankBook } from "../bookshelf/questionBankBooks";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { STORAGE_KEYS } from "../brand";

/** One handoff identity and size contract for curriculum and QBank. */
export const COURSE_QUIZ_LAUNCH_KEY = "axom.courseQuizLaunch.v1";
export const COURSE_QUIZ_LAUNCH_EVENT = "axom:course-quiz-launch";
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

/** A stored session is either absent, resumable or held for non-destructive recovery.
 * Legacy single-key snapshots and this tab's per-run mirror have the same guard.
 * Full resume validity is checked by ExamRunner; this preflight must never
 * interpret an existing malformed record as permission to start a new run. */
function savedQuizPresence(raw: string | null): "none" | "active" | "corrupt" {
  if (raw === null) return "none";
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return "corrupt"; }
  if (value === null) return "none"; // Preserve the historical explicit null sentinel.
  if (!value || typeof value !== "object" || Array.isArray(value)) return "corrupt";
  const poolIds = (value as { poolIds?: unknown }).poolIds;
  if (!Array.isArray(poolIds) || !poolIds.length
    || poolIds.some(id => typeof id !== "string" || !id.trim())) return "corrupt";
  return "active";
}

export function launchCourseQuiz(selection: CourseQuizLaunch): void {
  if (!selection.questionIds.length) throw new Error("No reviewed questions are available in this selection yet.");
  if (selection.questionIds.length > MAX_COURSE_QUIZ_QUESTIONS
    || new Set(selection.questionIds).size !== selection.questionIds.length
    || selection.questionIds.some(id => typeof id !== "string" || !id.trim())
    || !selection.module.trim() || !selection.term.trim()
    || (selection.week !== undefined && (!Number.isSafeInteger(selection.week) || selection.week < 1))
    || (selection.courseId !== undefined && !selection.courseId.trim())
    || selection.setIds.length > MAX_COURSE_QUIZ_QUESTIONS
    || new Set(selection.setIds).size !== selection.setIds.length
    || selection.setIds.some(id => typeof id !== "string" || !id.trim())) {
    throw new Error("The course practice selection is invalid or exceeds its supported question limit.");
  }
  // A legacy mirror may be absent when a modern run was saved only under its
  // per-tab run key (e.g. a quota failure during legacy-mirror persistence).
  const legacyPresence = savedQuizPresence(localStorage.getItem(STORAGE_KEYS.quizActiveSession));
  const tabRunId = sessionStorage.getItem(`${STORAGE_KEYS.quizActiveSession}:run-id`);
  const scopedPresence = tabRunId
    ? savedQuizPresence(localStorage.getItem(`${STORAGE_KEYS.quizActiveSession}:run:${tabRunId}`))
    : "none";
  if (legacyPresence === "corrupt" || scopedPresence === "corrupt") {
    throw new Error("Your saved Question Bank session cannot be read. Open Question Bank to recover it before starting a new quiz.");
  }
  if (legacyPresence === "active" || scopedPresence === "active") {
    throw new Error("Resume or finish your current quiz in Question Bank before starting another.");
  }
  sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, JSON.stringify(selection));
  const alreadyInQuestionBank = location.hash === "#questions";
  location.hash = "questions";
  // A same-route launch does not emit hashchange, so the mounted page needs a
  // fresh read of the exact handoff stored above.
  if (alreadyInQuestionBank) window.dispatchEvent(new Event(COURSE_QUIZ_LAUNCH_EVENT));
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
        || new Set(value.setIds).size !== value.setIds.length
        || value.setIds.some(id => typeof id !== "string" || !id.trim())))) return null;
    const questionIds = value.questionIds as string[];
    const requestedIds = new Set(questionIds);
    const seenOnDevice = new Set<string>();
    const duplicateOnDevice = new Set<string>();
    const eligible = new Set<string>();
    for (const question of questions) {
      if (!requestedIds.has(question.id)) continue;
      if (seenOnDevice.has(question.id)) duplicateOnDevice.add(question.id);
      seenOnDevice.add(question.id);
      if (questionMappingStatus(question) === "ready" && question.options.length >= 2) eligible.add(question.id);
    }
    // A partial hydration or conflicting local identity must not launch a
    // shorter or order-dependent block. Preserve the pending request for repair.
    if (!questionIds.every(id => eligible.has(id) && !duplicateOnDevice.has(id))) return null;
    return { module: value.module, term: value.term, questionIds,
      ...("courseId" in value && typeof value.courseId === "string" ? { courseId: value.courseId } : {}),
      ...("week" in value && typeof value.week === "number" ? { week: value.week } : {}),
      setIds: "setIds" in value && Array.isArray(value.setIds) ? value.setIds as string[] : [] };
  } catch { return null; }
}

export function clearCourseQuizLaunch(): void { sessionStorage.removeItem(COURSE_QUIZ_LAUNCH_KEY); }
