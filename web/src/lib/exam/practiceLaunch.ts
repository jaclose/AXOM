import { assertQuizLaunchAvailable, COURSE_QUIZ_LAUNCH_KEY } from "../course-engine/quizLaunch";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, type QuestionAttachmentScope } from "../questionAttachmentScope";
import type { QuestionRecord } from "../questions";
import { uniquePracticeQuestions } from "./nextPractice";

export const PRACTICE_LAUNCH_EVENT = "axom:practice-launch";
let pending: { scope: QuestionAttachmentScope; records: QuestionRecord[] } | undefined;

export interface PracticeLaunchContext {
  readonly scope: QuestionAttachmentScope;
  readonly questions: readonly QuestionRecord[];
}

/** Capture with the rendered recommendation, before a later click can retarget it. */
export function capturePracticeLaunchContext(questions: readonly QuestionRecord[]): PracticeLaunchContext {
  return { scope: getQuestionAttachmentScope(), questions };
}

/** This is only an in-tab navigation handoff. The existing runner owns durable
 * recovery once it opens; account changes and replacement records invalidate it. */
export function launchRecommendedPractice(questionIds: readonly string[], context: PracticeLaunchContext, currentQuestions: readonly QuestionRecord[]): void {
  if (!isQuestionAttachmentScopeCurrent(context.scope)) throw new Error("The account changed. Choose a recommendation in your current workspace.");
  assertQuizLaunchAvailable();
  if (sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) !== null) throw new Error("Open Question Bank to finish or dismiss your pending course selection first.");
  const byId = new Map(uniquePracticeQuestions(context.questions).map(question => [question.id, question]));
  if (!questionIds.length || questionIds.length > 20 || new Set(questionIds).size !== questionIds.length
    || questionIds.some(id => !byId.has(id))) throw new Error("These questions changed or need review. Refresh the recommendation before starting.");
  const currentById = new Map(uniquePracticeQuestions(currentQuestions).map(question => [question.id, question]));
  if (questionIds.some(id => currentById.get(id) !== byId.get(id))) throw new Error("The workspace changed. Choose a new recommendation before starting.");
  pending = { scope: context.scope, records: questionIds.map(id => byId.get(id)!) };
  location.hash = "questions";
  window.dispatchEvent(new Event(PRACTICE_LAUNCH_EVENT));
}

export function takeRecommendedPractice(questions: readonly QuestionRecord[]): string[] | null {
  const request = pending;
  if (!request) return null;
  pending = undefined;
  if (!isQuestionAttachmentScopeCurrent(request.scope)) throw new Error("The account changed. Choose a recommendation in your current workspace.");
  const byId = new Map(uniquePracticeQuestions(questions).map(question => [question.id, question]));
  if (request.records.some(question => byId.get(question.id) !== question)) throw new Error("The workspace changed. Choose a new recommendation before starting.");
  assertQuizLaunchAvailable();
  return request.records.map(question => question.id);
}
