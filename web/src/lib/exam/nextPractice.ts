import { questionPracticeReadiness } from "../questionFilters";
import type { QuestionAttempt, QuestionRecord } from "../questions";

export interface NextPractice {
  kind: "due" | "missed" | "unseen";
  title: string;
  reason: string;
  questionIds: string[];
  available: number;
}

/** A duplicate identity cannot identify one exact question to practise. */
export function uniquePracticeQuestions(questions: readonly QuestionRecord[]): QuestionRecord[] {
  const counts = new Map<string, number>();
  for (const question of questions) counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  return questions.filter(question => question.id.trim() && counts.get(question.id) === 1 && questionPracticeReadiness(question) === "ready");
}

function latestAnswer(question: QuestionRecord, now: number): QuestionAttempt | undefined {
  return question.attempts.reduce<QuestionAttempt | undefined>((latest, attempt) => {
    const at = Date.parse(attempt.at);
    if (!attempt.answerKey || !question.options.some(option => option.key === attempt.answerKey)
      || !Number.isFinite(at) || at > now) return latest;
    return !latest || at >= Date.parse(latest.at) ? attempt : latest;
  }, undefined);
}

/** Read-only recommendations from saved availability, scheduling and answers.
 * A manual status flag alone is never presented as an observed wrong answer. */
export function nextPractice(questions: readonly QuestionRecord[], now = new Date(), limit = 20): NextPractice | null {
  const count = Math.max(1, Math.min(20, Math.floor(limit) || 1));
  const ready = uniquePracticeQuestions(questions);
  const due = ready.filter(question => question.reviewDueAt && Date.parse(question.reviewDueAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.reviewDueAt!) - Date.parse(b.reviewDueAt!) || a.id.localeCompare(b.id));
  const missed = ready.flatMap(question => {
    const answer = latestAnswer(question, now.getTime());
    return answer?.status === "incorrect" && answer.answerKey !== question.correctKey ? [{ question, at: Date.parse(answer.at) }] : [];
  }).sort((a, b) => b.at - a.at || a.question.id.localeCompare(b.question.id)).map(entry => entry.question);
  const unseen = ready.filter(question => !question.attempts.length && question.status === "unseen")
    .sort((a, b) => a.id.localeCompare(b.id));
  const kind = due.length ? "due" : missed.length ? "missed" : "unseen";
  const pool = kind === "due" ? due : kind === "missed" ? missed : unseen;
  if (!pool.length) return null;
  const questionIds = pool.slice(0, kind === "unseen" ? Math.min(count, 10) : count).map(question => question.id);
  const n = questionIds.length;
  const noun = n === 1 ? "question" : "questions";
  return {
    kind, questionIds, available: pool.length,
    title: kind === "due" ? `Review ${n} due ${noun}` : kind === "missed" ? `Retry ${n} missed ${noun}` : `Start ${n} unseen ${noun}`,
    reason: kind === "due"
      ? `${pool.length} ${pool.length === 1 ? "question is" : "questions are"} scheduled for review. Start with ${n} and check the explanations.`
      : kind === "missed"
        ? `Your latest recorded answer was incorrect on ${pool.length} ${pool.length === 1 ? "question" : "questions"}. Retry ${n} and review the explanation after each answer.`
        : `${pool.length} ${pool.length === 1 ? "question is" : "questions are"} ready with no recorded attempts. Begin with ${n}; progress will come from your answers.`,
  };
}
