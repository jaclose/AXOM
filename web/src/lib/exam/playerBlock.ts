// ===========================================================================
// The AXOM player on the exam engine. The player (the tutor and exam modes in
// ExamRunner) keeps its block in lib/exam/engine like every exam interface.
// Two things are its own, and they live here:
//
//   1. What counts as an answer. In an exam the pick is the answer. In tutor
//      mode a pick is an answer only once it has been checked, and what was
//      saved at that moment stands. A question with no answer is left
//      unscored (an exam interface counts a blank in a submitted exam as wrong).
//   2. The resume snapshot it writes to this device. Its shape is older than
//      the engine and is kept as it is, so a block in progress survives an
//      update, and a build from before the engine can still read it.
//
// Pure: time is always passed in.
// ===========================================================================
import type { AnswerCertainty } from "../questions";
import type { QuizAnswer, QuizMode } from "../quiz";
import { itemState, restoreBlock, type ExamBlock, type RestoredItem } from "./engine";
import { recordedSeconds } from "./questionTime";

/** The part of the player's resume snapshot that describes the block. */
export interface PlayerSnapshot {
  mode: QuizMode;
  index: number;
  /** Answered or flagged questions only. */
  answers: readonly QuizAnswer[];
  /** The pick on the question on screen. In tutor mode it may not be checked yet. */
  picked?: string;
  /** Tutor mode: the question on screen has been checked. */
  revealed: boolean;
  startedAt: string;
  /** How sure the learner said they were about the question on screen. */
  certainty?: AnswerCertainty;
}

const clampIndex = (index: number, length: number) => Math.min(Math.max(0, Math.floor(index) || 0), Math.max(0, length - 1));

/** The block a snapshot describes, picked up again now. */
export function blockFromPlayerSnapshot(snapshot: PlayerSnapshot, ids: readonly string[], now: number): ExamBlock {
  const tutor = snapshot.mode === "tutor";
  const items: Record<string, RestoredItem> = {};
  for (const answer of snapshot.answers) {
    items[answer.questionId] = {
      answerKey: answer.answerKey,
      marked: answer.flagged,
      visited: true,
      // A tutor answer is only ever recorded by checking it.
      revealed: tutor && Boolean(answer.answerKey),
      seconds: answer.seconds,
    };
  }
  const index = clampIndex(snapshot.index, ids.length);
  const current = ids[index];
  if (current) {
    const known = items[current];
    items[current] = tutor
      // A checked answer stands. Otherwise the pick on screen comes back, checked only if the snapshot says so.
      ? known?.answerKey
        ? known
        : { ...known, answerKey: snapshot.picked, revealed: snapshot.revealed && Boolean(snapshot.picked) }
      // In an exam the pick on screen is the answer, newer than any recorded on an earlier visit.
      : { ...known, answerKey: snapshot.picked ?? known?.answerKey };
  }
  return restoreBlock({ ids, mode: snapshot.mode, index, items, startedAt: snapshot.startedAt, now });
}

/** How sure the learner said they were, by question, as a snapshot recorded it. */
export function certaintiesFromPlayerSnapshot(snapshot: PlayerSnapshot, ids: readonly string[]): Record<string, AnswerCertainty> {
  const known: Record<string, AnswerCertainty> = {};
  for (const answer of snapshot.answers) if (answer.certainty) known[answer.questionId] = answer.certainty;
  const current = ids[clampIndex(snapshot.index, ids.length)];
  if (current && snapshot.certainty) known[current] = snapshot.certainty;
  return known;
}

/**
 * One question's record as the AXOM player counts it. `correctKey` is the
 * trusted key, or undefined when the question has none. `checked` is the
 * record made when a tutor answer was checked: it was saved as an attempt at
 * that moment, so its verdict, time and certainty stand even if the learner
 * disputes the answer key afterwards. Only the flag can still change.
 */
export function playerAnswer(
  block: ExamBlock,
  id: string,
  now: number,
  correctKey: string | undefined,
  known: { certainty?: AnswerCertainty; checked?: QuizAnswer } = {},
): QuizAnswer {
  const item = itemState(block, id);
  if (block.mode === "tutor") {
    if (known.checked?.answerKey) return { ...known.checked, flagged: item.marked };
    if (!item.revealed) return { questionId: id, flagged: item.marked };
  }
  if (!item.answerKey) return { questionId: id, flagged: item.marked };
  return {
    questionId: id,
    answerKey: item.answerKey,
    correct: correctKey ? item.answerKey === correctKey : undefined,
    flagged: item.marked,
    seconds: recordedSeconds(block.times, id, now),
    ...(known.certainty ? { certainty: known.certainty } : {}),
  };
}

/** The tutor answers a snapshot holds, by question: each was checked and saved when it was recorded. */
export function checkedFromPlayerSnapshot(snapshot: PlayerSnapshot): Record<string, QuizAnswer> {
  if (snapshot.mode !== "tutor") return {};
  return Object.fromEntries(snapshot.answers.filter((answer) => answer.answerKey).map((answer) => [answer.questionId, answer]));
}
