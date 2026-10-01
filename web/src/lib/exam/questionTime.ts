// ===========================================================================
// How AXOM counts the time spent on a question. This is the one place the
// rules live; every player (the AXOM player and each exam interface) keeps
// its times in this ledger, so "time spent" means the same thing everywhere.
//
//   1. Time belongs to the question on screen. A visit opens when a question
//      is shown and closes when the learner leaves it, reveals its answer,
//      suspends the block, or the block ends.
//   2. Visits add up. Coming back to a question adds to its time.
//   3. Revealing an answer seals the question. Reading the explanation
//      afterwards is not time spent answering, so it is not counted.
//   4. Time is only counted while the question can be seen: not while the
//      block is suspended, and not while AXOM is hidden behind another tab
//      or app. (A block's own clock is a separate thing and keeps running,
//      as it does in an exam hall.)
//   5. Fractions are kept while adding. Whole seconds are produced only when
//      a time is shown or written to a record, so short visits are not lost.
//
// Pure: every function takes the time as an argument and returns a new ledger.
// ===========================================================================

export interface QuestionTimes {
  /** Seconds counted so far, by question id. */
  readonly seconds: Readonly<Record<string, number>>;
  /** Questions whose answer has been revealed: their time no longer grows. */
  readonly sealed: readonly string[];
  /** The question on screen and when its visit opened (epoch ms). */
  readonly open?: { readonly id: string; readonly since: number };
}

export const NO_QUESTION_TIME: QuestionTimes = { seconds: {}, sealed: [] };

/** Start from times recorded earlier (a resumed block, a restored session). */
export function questionTimesFrom(seconds: Readonly<Record<string, number | undefined>>, sealed: readonly string[] = []): QuestionTimes {
  const kept: Record<string, number> = {};
  for (const [id, value] of Object.entries(seconds)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) kept[id] = value;
  }
  return { seconds: kept, sealed: [...new Set(sealed)] };
}

const isSealed = (times: QuestionTimes, id: string) => times.sealed.includes(id);

/** Seconds of the open visit that count (rules 3 and 4). A clock that jumped backwards counts nothing. */
function openSeconds(times: QuestionTimes, id: string, now: number): number {
  if (!times.open || times.open.id !== id || isSealed(times, id)) return 0;
  return Math.max(0, (now - times.open.since) / 1000);
}

/** The visit ends: bank what it counted. Safe to call when nothing is open. */
export function closeVisit(times: QuestionTimes, now: number): QuestionTimes {
  if (!times.open) return times;
  const { id } = times.open;
  const counted = openSeconds(times, id, now);
  const { open: _closed, ...rest } = times;
  return counted > 0 ? { ...rest, seconds: { ...times.seconds, [id]: (times.seconds[id] ?? 0) + counted } } : rest;
}

/** A question comes on screen. Any visit still open is closed first. */
export function openVisit(times: QuestionTimes, id: string, now: number): QuestionTimes {
  return { ...closeVisit(times, now), open: { id, since: now } };
}

/** The question's answer is revealed: bank the visit and stop counting it for good. */
export function sealQuestion(times: QuestionTimes, id: string, now: number): QuestionTimes {
  if (isSealed(times, id)) return times;
  const counted = openSeconds(times, id, now);
  return {
    ...times,
    seconds: counted > 0 ? { ...times.seconds, [id]: (times.seconds[id] ?? 0) + counted } : times.seconds,
    sealed: [...times.sealed, id],
  };
}

/** Seconds counted for a question so far, including the visit still open. */
export function secondsOn(times: QuestionTimes, id: string, now: number): number {
  return (times.seconds[id] ?? 0) + openSeconds(times, id, now);
}

/** The whole seconds to write to a record (rule 5). */
export function recordedSeconds(times: QuestionTimes, id: string, now: number): number {
  return Math.round(secondsOn(times, id, now));
}

/** "00:47", "12:05", "1:02:09": the way every player shows a question's time. */
export function formatQuestionTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
