// The on-board "how to play" (JD, Ideas 3): type a sample word into the first
// row, explain green / yellow / grey on its tiles, reveal the answer on the
// second row, then clear the board for the real game. Pure data so the timing
// and wording are testable; DailyWordDemo.tsx only plays it back.
import { scoreGuess, type LetterEvaluation } from "./dailyWord";

export const DEMO_GUESS = "ENVOY";
export const DEMO_ANSWER = "EBONY";

export interface DemoFrame {
  /** ms from the start */
  at: number;
  rows: [string, string];
  /** whether each row shows its colours yet */
  scored: [boolean, boolean];
  caption: string;
  /** tile the caption points at (row 0), or null for a centred caption */
  focusCol: number | null;
}

const TYPE_MS = 150;

export function buildDemoTimeline(wordCount: number): { frames: DemoFrame[]; duration: number; evaluations: [LetterEvaluation[], LetterEvaluation[]] } {
  const guessEval = scoreGuess(DEMO_GUESS, DEMO_ANSWER);
  const answerEval = scoreGuess(DEMO_ANSWER, DEMO_ANSWER);
  const frames: DemoFrame[] = [];
  const intro = `Six tries to find today's word. Any of the ${wordCount.toLocaleString()} words could be it.`;
  frames.push({ at: 0, rows: ["", ""], scored: [false, false], caption: intro, focusCol: null });
  for (let i = 1; i <= 5; i += 1) {
    frames.push({ at: 500 + (i - 1) * TYPE_MS, rows: [DEMO_GUESS.slice(0, i), ""], scored: [false, false], caption: intro, focusCol: null });
  }
  const typedRow1 = 500 + 5 * TYPE_MS;
  const firstOf = (kind: LetterEvaluation) => guessEval.indexOf(kind);
  frames.push({ at: typedRow1 + 250, rows: [DEMO_GUESS, ""], scored: [true, false], caption: "Green: the right letter in the right spot.", focusCol: firstOf("correct") });
  frames.push({ at: typedRow1 + 1650, rows: [DEMO_GUESS, ""], scored: [true, false], caption: "Yellow: in the word, but in another spot.", focusCol: firstOf("present") });
  frames.push({ at: typedRow1 + 3050, rows: [DEMO_GUESS, ""], scored: [true, false], caption: "Grey: not in the word at all.", focusCol: firstOf("absent") });
  const row2Start = typedRow1 + 4250;
  for (let i = 1; i <= 5; i += 1) {
    frames.push({ at: row2Start + (i - 1) * TYPE_MS, rows: [DEMO_GUESS, DEMO_ANSWER.slice(0, i)], scored: [true, false], caption: "Use the colours to narrow it down.", focusCol: null });
  }
  const typedRow2 = row2Start + 5 * TYPE_MS;
  frames.push({ at: typedRow2 + 250, rows: [DEMO_GUESS, DEMO_ANSWER], scored: [true, true], caption: "All green: that's the answer.", focusCol: null });
  frames.push({ at: typedRow2 + 1850, rows: ["", ""], scored: [false, false], caption: "Your turn.", focusCol: null });
  return { frames, duration: typedRow2 + 2550, evaluations: [guessEval, answerEval] };
}

/** The frame showing at `elapsed` ms. */
export function demoFrameAt(frames: readonly DemoFrame[], elapsed: number): DemoFrame {
  let current = frames[0];
  for (const frame of frames) {
    if (frame.at <= elapsed) current = frame;
    else break;
  }
  return current;
}
