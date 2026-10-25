import type { QuizSession } from "./quiz";
import type { StudyLog } from "./types";

export const quizPracticeLogId = (sessionId: string): string => `qbank-session:${sessionId}`;

/**
 * Project one completed or intentionally ended Question Bank run into the
 * existing Productivity ledger. The run id is the event id, so retries,
 * resumed saves and duplicate finalization cannot double-count questions.
 */
export function quizPracticeLog(session: QuizSession, activeDayKey: string, existing?: StudyLog): StudyLog | undefined {
  const answered = session.answers.filter((answer) => Boolean(answer.answerKey)).length;
  if (!answered) return undefined;
  const seconds = session.answers.reduce((total, answer) => (
    total + (Number.isFinite(answer.seconds) && (answer.seconds ?? 0) > 0 ? answer.seconds! : 0)
  ), 0);
  const minutes = Math.round(seconds / 60 * 100) / 100;
  return {
    id: quizPracticeLogId(session.id),
    dayKey: existing?.dayKey ?? activeDayKey,
    ts: existing?.ts ?? session.endedAt ?? session.startedAt,
    type: "Question Bank",
    minutes,
    cards: 0,
    unitType: minutes ? "custom" : "count",
    quantity: answered,
    quantityKind: "questions",
    quantityLabel: "questions",
    note: `${session.mode === "exam" ? "Exam" : "Tutor"} block · ${answered}/${session.questionIds.length} answered${session.endedEarly ? " · ended early" : ""}`,
    academic: true,
    productive: true,
  };
}
export function withQuizPracticeLog(logs: readonly StudyLog[], session: QuizSession, activeDayKey: string): StudyLog[] {
  const id = quizPracticeLogId(session.id);
  const existing = logs.find((log) => log.id === id);
  const projected = quizPracticeLog(session, activeDayKey, existing);
  const rest = logs.filter((log) => log.id !== id);
  return projected ? [projected, ...rest] : rest;
}
