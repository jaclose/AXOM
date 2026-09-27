import type { QuizSession } from "./quiz";

/**
 * Per-question pacing for a finished block, from the seconds already recorded
 * on each answer. The target is the timed block's own budget; untimed blocks
 * compare against a common exam pace (90 s/question) and say so.
 */
export const DEFAULT_TARGET_SECONDS = 90;

export interface PacingQuestion {
  questionId: string;
  position: number;
  seconds: number;
  correct?: boolean;
  overTarget: boolean;
}

export interface PacingSummary {
  timed: boolean;
  targetSeconds: number;
  averageSeconds: number;
  medianSeconds: number;
  totalSeconds: number;
  overTarget: number;
  measured: number;
  slowest: PacingQuestion[];
  questions: PacingQuestion[];
  /** Accuracy for faster vs slower halves, when both halves have scored answers. */
  speedAccuracy?: { faster: number; slower: number };
}

export function summarizePacing(session: Pick<QuizSession, "timed" | "timeLimitSeconds" | "questionIds" | "answers">): PacingSummary | null {
  const order = new Map(session.questionIds.map((id, index) => [id, index + 1]));
  const targetSeconds = session.timed && session.timeLimitSeconds && session.questionIds.length
    ? Math.round(session.timeLimitSeconds / session.questionIds.length)
    : DEFAULT_TARGET_SECONDS;
  const questions = session.answers
    .filter((answer) => typeof answer.seconds === "number" && Number.isFinite(answer.seconds) && answer.seconds >= 0)
    .map((answer) => ({
      questionId: answer.questionId,
      position: order.get(answer.questionId) ?? 0,
      seconds: Math.round(answer.seconds!),
      correct: answer.correct,
      overTarget: answer.seconds! > targetSeconds,
    }))
    .sort((a, b) => a.position - b.position);
  if (!questions.length) return null;
  const sorted = [...questions].map((question) => question.seconds).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianSeconds = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const totalSeconds = sorted.reduce((sum, value) => sum + value, 0);
  const scored = questions.filter((question) => typeof question.correct === "boolean");
  let speedAccuracy: PacingSummary["speedAccuracy"];
  if (scored.length >= 4) {
    const bySpeed = [...scored].sort((a, b) => a.seconds - b.seconds);
    const half = Math.floor(bySpeed.length / 2);
    const rate = (items: PacingQuestion[]) => Math.round((items.filter((item) => item.correct).length / items.length) * 100);
    speedAccuracy = { faster: rate(bySpeed.slice(0, half)), slower: rate(bySpeed.slice(half)) };
  }
  return {
    timed: session.timed,
    targetSeconds,
    averageSeconds: Math.round(totalSeconds / questions.length),
    medianSeconds,
    totalSeconds,
    overTarget: questions.filter((question) => question.overTarget).length,
    measured: questions.length,
    slowest: [...questions].sort((a, b) => b.seconds - a.seconds || a.position - b.position).slice(0, 3),
    questions,
    speedAccuracy,
  };
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function pacingInsight(summary: PacingSummary): string {
  const pace = summary.averageSeconds <= summary.targetSeconds
    ? `On pace: ${formatSeconds(summary.averageSeconds)} per question against a ${formatSeconds(summary.targetSeconds)} budget.`
    : `Over pace: ${formatSeconds(summary.averageSeconds)} per question against a ${formatSeconds(summary.targetSeconds)} budget.`;
  if (!summary.speedAccuracy) return pace;
  const { faster, slower } = summary.speedAccuracy;
  if (slower + 15 < faster) return `${pace} Your slower questions were less accurate (${slower}% vs ${faster}%) — long hesitation may signal a gap worth reviewing.`;
  if (faster + 15 < slower) return `${pace} Your faster answers were less accurate (${faster}% vs ${slower}%) — slowing down on the first read may help.`;
  return pace;
}
