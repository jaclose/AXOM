// ===========================================================================
// Attempts as events. Each question keeps its own attempts; analysis wants one
// time-ordered stream that says, for every answer, whether it was the first
// time the learner met the question. Everything here is read straight from
// what was recorded: nothing is estimated.
// ===========================================================================
import type { ID } from "../types";
import {
  questionMappingStatus,
  type AnswerCertainty, type QuestionAttemptMode, type QuestionErrorType, type QuestionRecord,
} from "../questions";

export interface AttemptEvent {
  questionId: ID;
  at: string;
  /** 1 the first time the learner answered this question, 2 the second, and so on. */
  exposure: number;
  /** Undefined when the answer could not be scored (no trusted key at the time). */
  correct: boolean | undefined;
  answerKey?: string;
  /** The question's key, only while its mapping is trusted. */
  correctKey?: string;
  seconds?: number;
  /** What the learner said before the answer was checked. */
  certainty?: AnswerCertainty;
  /** The reason the learner gave for a miss. */
  errorType?: QuestionErrorType;
  mode?: QuestionAttemptMode;
  quizSessionId?: ID;
}

export function attemptEvents(questions: readonly QuestionRecord[]): AttemptEvent[] {
  const events: AttemptEvent[] = [];
  for (const question of questions) {
    const correctKey = questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
    const ordered = [...question.attempts].sort((left, right) => left.at.localeCompare(right.at));
    let exposure = 0;
    for (const attempt of ordered) {
      // A flag with no answer is not an exposure to the question's answer.
      const answered = attempt.status === "correct" || attempt.status === "incorrect" || attempt.status === "guessed";
      if (!answered && !attempt.answerKey) continue;
      exposure += 1;
      events.push({
        questionId: question.id,
        at: attempt.at,
        exposure,
        correct: attempt.status === "correct" || attempt.status === "guessed"
          ? true
          : attempt.status === "incorrect" ? false : undefined,
        answerKey: attempt.answerKey,
        correctKey,
        seconds: attempt.timeSpentSeconds,
        // "Guessed" is the learner's own word for a right answer they were not sure of.
        certainty: attempt.certainty ?? (attempt.status === "guessed" ? "guess" : undefined),
        errorType: attempt.errorType,
        mode: attempt.mode,
        quizSessionId: attempt.quizSessionId,
      });
    }
  }
  return events.sort((left, right) => left.at.localeCompare(right.at));
}

export interface Tally {
  attempts: number;
  correct: number;
  /** Whole percent, or null when nothing was scored. */
  accuracy: number | null;
}

export function tally(events: readonly AttemptEvent[]): Tally {
  const scored = events.filter((event) => event.correct !== undefined);
  const correct = scored.filter((event) => event.correct).length;
  return {
    attempts: scored.length,
    correct,
    accuracy: scored.length ? Math.round((correct / scored.length) * 100) : null,
  };
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
