// ===========================================================================
// The exam block engine: one question engine under every exam interface.
//
//   shared engine (this file)  ->  exam profile (profiles.ts)  ->  renderer
//
// The engine knows what a block is: an ordered pool, the item on screen, each
// item's answer / flag / strike-outs, the time spent on each (questionTime.ts)
// and the block clock. It does not know what anything looks like. A profile
// says how an exam behaves (how a block ends, whether a second click clears an
// answer, what the navigator can filter). A renderer draws it. UWorld, NBME,
// Examplify and the AXOM player differ in the last two layers only, so they
// cannot drift apart in how they record an answer, a flag or a second.
//
// Pure: a reducer plus selectors. Time is always passed in.
// ===========================================================================
import type { QuizAnswer } from "../quiz";
import type { BlockClock, ExamItemState, ExamSkin, SuspendedBlock } from "../examSim";
import { clockElapsedMs, pauseClock } from "../examSim";
import {
  NO_QUESTION_TIME, closeVisit, openVisit, questionTimesFrom, recordedSeconds, sealQuestion, secondsOn, type QuestionTimes,
} from "./questionTime";

/** Testing: answers can change and nothing about correctness is shown. Review: the finished block, read-only, results shown. */
export type ExamPhase = "testing" | "review";

export interface ItemState {
  readonly answerKey?: string;
  readonly marked: boolean;
  readonly struck: readonly string[];
  readonly visited: boolean;
  /** Tutor mode: this item's answer has been submitted and its result shown. */
  readonly revealed: boolean;
}

export const BLANK_ITEM: ItemState = { marked: false, struck: [], visited: false, revealed: false };

export interface ExamBlock {
  readonly ids: readonly string[];
  readonly mode: "exam" | "tutor";
  readonly phase: ExamPhase;
  readonly index: number;
  readonly items: Readonly<Record<string, ItemState>>;
  readonly times: QuestionTimes;
  readonly clock: BlockClock;
  readonly notes: string;
  readonly startedAt: string;
}

export type ExamAction =
  /** The item on screen can be seen (the block opened, or AXOM came back to the front). */
  | { type: "show"; now: number }
  /** The item on screen cannot be seen (AXOM hidden): its time stops. */
  | { type: "hide"; now: number }
  | { type: "go"; index: number; now: number }
  /** `toggle`: choosing the chosen answer again clears it (profile behaviour). */
  | { type: "pick"; key: string; toggle?: boolean }
  | { type: "strike"; key: string }
  | { type: "mark" }
  /** Tutor mode: submit the item on screen and show its result. */
  | { type: "reveal"; now: number }
  | { type: "note"; text: string };

// --- starting points -----------------------------------------------------------

export function startBlock(input: { ids: readonly string[]; mode: "exam" | "tutor"; now: number; startedAt?: string }): ExamBlock {
  const first = input.ids[0];
  return {
    ids: input.ids,
    mode: input.mode,
    phase: "testing",
    index: 0,
    items: first ? { [first]: { ...BLANK_ITEM, visited: true } } : {},
    times: first ? openVisit(NO_QUESTION_TIME, first, input.now) : NO_QUESTION_TIME,
    clock: { elapsedMs: 0, runningSince: input.now },
    notes: "",
    startedAt: input.startedAt ?? new Date(input.now).toISOString(),
  };
}

/** Pick a suspended block back up. The clock and the item on screen start again from now. */
export function resumeBlock(block: SuspendedBlock, ids: readonly string[], now: number): ExamBlock {
  const index = Math.min(Math.max(0, block.index), Math.max(0, ids.length - 1));
  const items: Record<string, ItemState> = {};
  const seconds: Record<string, number> = {};
  const sealed: string[] = [];
  for (const id of ids) {
    const saved = block.items[id];
    if (!saved) continue;
    items[id] = { answerKey: saved.answerKey, marked: Boolean(saved.marked), struck: saved.struck ?? [], visited: Boolean(saved.visited), revealed: Boolean(saved.submitted) };
    seconds[id] = saved.seconds;
    if (saved.submitted) sealed.push(id);
  }
  const current = ids[index];
  if (current) items[current] = { ...(items[current] ?? BLANK_ITEM), visited: true };
  const times = questionTimesFrom(seconds, sealed);
  return {
    ids,
    mode: block.mode,
    phase: "testing",
    index,
    items,
    times: current ? openVisit(times, current, now) : times,
    clock: { elapsedMs: Math.max(0, block.elapsedMs), runningSince: now },
    notes: block.notes ?? "",
    startedAt: block.startedAt,
  };
}

/** A finished block opened for review: read-only, every result shown, no clock. */
export function reviewBlock(input: { ids: readonly string[]; answers: readonly QuizAnswer[]; mode: "exam" | "tutor"; startedAt: string; elapsedSeconds?: number; index?: number }): ExamBlock {
  const byId = new Map(input.answers.map((answer) => [answer.questionId, answer]));
  const items: Record<string, ItemState> = {};
  const seconds: Record<string, number | undefined> = {};
  for (const id of input.ids) {
    const answer = byId.get(id);
    items[id] = { answerKey: answer?.answerKey, marked: Boolean(answer?.flagged), struck: [], visited: true, revealed: true };
    seconds[id] = answer?.seconds;
  }
  return {
    ids: input.ids,
    mode: input.mode,
    phase: "review",
    index: Math.min(Math.max(0, input.index ?? 0), Math.max(0, input.ids.length - 1)),
    items,
    times: questionTimesFrom(seconds, input.ids),
    clock: { elapsedMs: Math.max(0, (input.elapsedSeconds ?? 0) * 1000) },
    notes: "",
    startedAt: input.startedAt,
  };
}

// --- the reducer -----------------------------------------------------------------

const itemOf = (block: ExamBlock, id: string | undefined): ItemState => (id && block.items[id]) || BLANK_ITEM;

function patchItem(block: ExamBlock, id: string, patch: Partial<ItemState>): ExamBlock {
  return { ...block, items: { ...block.items, [id]: { ...itemOf(block, id), ...patch } } };
}

export function examReducer(block: ExamBlock, action: ExamAction): ExamBlock {
  const id = block.ids[block.index];
  const testing = block.phase === "testing";
  switch (action.type) {
    case "show":
      return testing && id && block.times.open?.id !== id ? { ...block, times: openVisit(block.times, id, action.now) } : block;
    case "hide":
      return testing && block.times.open ? { ...block, times: closeVisit(block.times, action.now) } : block;
    case "go": {
      const target = action.index;
      if (!Number.isInteger(target) || target < 0 || target >= block.ids.length || target === block.index) return block;
      const next = block.ids[target];
      const moved = patchItem({ ...block, index: target }, next, { visited: true });
      return testing ? { ...moved, times: openVisit(block.times, next, action.now) } : moved;
    }
    case "pick": {
      const item = itemOf(block, id);
      if (!testing || !id || item.revealed) return block;
      if (item.answerKey === action.key) return action.toggle ? patchItem(block, id, { answerKey: undefined }) : block;
      // Choosing an answer that was struck out brings it back.
      return patchItem(block, id, { answerKey: action.key, struck: item.struck.filter((key) => key !== action.key) });
    }
    case "strike": {
      const item = itemOf(block, id);
      if (!testing || !id || item.revealed) return block;
      const already = item.struck.includes(action.key);
      return patchItem(block, id, {
        struck: already ? item.struck.filter((key) => key !== action.key) : [...item.struck, action.key],
        // Striking out the chosen answer un-chooses it.
        answerKey: !already && item.answerKey === action.key ? undefined : item.answerKey,
      });
    }
    case "mark":
      return id && testing ? patchItem(block, id, { marked: !itemOf(block, id).marked }) : block;
    case "reveal": {
      const item = itemOf(block, id);
      if (!testing || block.mode !== "tutor" || !id || !item.answerKey || item.revealed) return block;
      return { ...patchItem(block, id, { revealed: true }), times: sealQuestion(block.times, id, action.now) };
    }
    case "note":
      return testing ? { ...block, notes: action.text } : block;
    default:
      return block;
  }
}

// --- reading a block ---------------------------------------------------------------

export function currentId(block: ExamBlock): string | undefined {
  return block.ids[block.index];
}

export function itemState(block: ExamBlock, id: string | undefined): ItemState {
  return itemOf(block, id);
}

export interface BlockCounts { answered: number; unanswered: number; flagged: number; seen: number; total: number }

export function countBlock(block: ExamBlock): BlockCounts {
  let answered = 0;
  let flagged = 0;
  let seen = 0;
  for (const id of block.ids) {
    const item = block.items[id];
    if (item?.answerKey) answered += 1;
    if (item?.marked) flagged += 1;
    if (item?.visited) seen += 1;
  }
  return { answered, unanswered: block.ids.length - answered, flagged, seen, total: block.ids.length };
}

export type ItemResult = "correct" | "incorrect" | "omitted" | "unscored";

/**
 * An item's result, or undefined while it must not be shown. This is the one
 * rule that keeps testing and review apart: in testing nothing about
 * correctness is known to the screen, except for an item a tutor-mode learner
 * has already submitted. `correctKey` is the trusted key, or undefined when
 * the question has none.
 */
export function shownResult(block: ExamBlock, id: string, correctKey: string | undefined): ItemResult | undefined {
  const item = itemOf(block, id);
  const shown = block.phase === "review" || (block.mode === "tutor" && item.revealed);
  if (!shown) return undefined;
  if (!item.answerKey) return "omitted";
  if (!correctKey) return "unscored";
  return item.answerKey === correctKey ? "correct" : "incorrect";
}

export type NavigatorFilter = "all" | "flagged" | "unanswered" | "answered" | "incorrect" | "correct";

export interface NavigatorEntry {
  /** Zero-based place in the block. */
  readonly position: number;
  readonly id: string;
  readonly current: boolean;
  readonly answered: boolean;
  readonly flagged: boolean;
  readonly visited: boolean;
  /** Present only when the result may be shown (see shownResult). */
  readonly result?: ItemResult;
}

/** Every item as the navigator shows it, in block order. */
export function navigatorEntries(block: ExamBlock, correctKeyFor: (id: string) => string | undefined): NavigatorEntry[] {
  return block.ids.map((id, position) => {
    const item = itemOf(block, id);
    const result = shownResult(block, id, correctKeyFor(id));
    return {
      position, id,
      current: position === block.index,
      answered: Boolean(item.answerKey),
      flagged: item.marked,
      visited: item.visited,
      ...(result ? { result } : {}),
    };
  });
}

export function matchesFilter(entry: NavigatorEntry, filter: NavigatorFilter): boolean {
  switch (filter) {
    case "flagged": return entry.flagged;
    case "unanswered": return !entry.answered;
    case "answered": return entry.answered;
    case "incorrect": return entry.result === "incorrect";
    case "correct": return entry.result === "correct";
    default: return true;
  }
}

/** How many items each filter would show. Result filters count nothing while results are hidden. */
export function filterCounts(entries: readonly NavigatorEntry[]): Record<NavigatorFilter, number> {
  const counts: Record<NavigatorFilter, number> = { all: entries.length, flagged: 0, unanswered: 0, answered: 0, incorrect: 0, correct: 0 };
  for (const entry of entries) {
    for (const filter of ["flagged", "unanswered", "answered", "incorrect", "correct"] as const) {
      if (matchesFilter(entry, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/** Whole seconds spent on an item so far (the item on screen keeps counting). */
export function itemSeconds(block: ExamBlock, id: string, now: number): number {
  return recordedSeconds(block.times, id, now);
}

export function elapsedSeconds(block: ExamBlock, now: number): number {
  return Math.floor(clockElapsedMs(block.clock, now) / 1000);
}

// --- leaving a block -----------------------------------------------------------------

/** The answers in block order, scored only where the answer key is trusted. */
export function blockAnswers(block: ExamBlock, now: number, correctKeyFor: (id: string) => string | undefined): QuizAnswer[] {
  return block.ids.map((id) => {
    const item = itemOf(block, id);
    const correctKey = correctKeyFor(id);
    return {
      questionId: id,
      answerKey: item.answerKey,
      correct: correctKey ? item.answerKey === correctKey : undefined,
      flagged: item.marked,
      seconds: recordedSeconds(block.times, id, now),
    };
  });
}

/** Everything needed to pick the block up later, with the clock and the open visit stopped at `now`. */
export function suspendBlock(block: ExamBlock, now: number, extra: { skin: ExamSkin; timeLimitSeconds?: number }): SuspendedBlock {
  const times = closeVisit(block.times, now);
  const items: Record<string, ExamItemState> = {};
  for (const id of block.ids) {
    const item = block.items[id];
    const seconds = secondsOn(times, id, now);
    if (!item && !seconds) continue;
    const state = item ?? BLANK_ITEM;
    items[id] = {
      answerKey: state.answerKey,
      marked: state.marked,
      struck: [...state.struck],
      seconds,
      visited: state.visited,
      ...(state.revealed ? { submitted: true } : {}),
    };
  }
  return {
    version: 1,
    skin: extra.skin,
    mode: block.mode,
    poolIds: [...block.ids],
    index: block.index,
    items,
    elapsedMs: pauseClock(block.clock, now).elapsedMs,
    timeLimitSeconds: extra.timeLimitSeconds,
    notes: block.notes,
    startedAt: block.startedAt,
    suspendedAt: new Date(now).toISOString(),
  };
}
