import { SOUNDSCAPES, isSoundscapeId, type SoundscapeId } from "./presets";

/**
 * A device-only record of when each soundscape played, so the learner can
 * judge a track by results (question accuracy, Anki "again" rate) instead of
 * by how focused it feels — the one practice the research clearly supports.
 */
export interface ListeningInterval {
  presetId: SoundscapeId;
  start: string;
  end: string;
}

export const LISTENING_LOG_KEY = "axom.soundscapes.log.v1";
const MAX_INTERVALS = 2000;
/** Shorter plays are previews, not study conditions. */
export const MIN_INTERVAL_MS = 60_000;

export function readListeningLog(): ListeningInterval[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LISTENING_LOG_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is ListeningInterval => Boolean(entry)
      && isSoundscapeId((entry as ListeningInterval).presetId)
      && Number.isFinite(Date.parse((entry as ListeningInterval).start))
      && Number.isFinite(Date.parse((entry as ListeningInterval).end)));
  } catch {
    return [];
  }
}

export function appendListeningInterval(interval: ListeningInterval): void {
  if (Date.parse(interval.end) - Date.parse(interval.start) < MIN_INTERVAL_MS) return;
  try {
    const log = [...readListeningLog(), interval].slice(-MAX_INTERVALS);
    window.localStorage.setItem(LISTENING_LOG_KEY, JSON.stringify(log));
  } catch { /* storage unavailable: the log is optional */ }
}

export type Condition = SoundscapeId | "quiet";

export interface ConditionStats {
  condition: Condition;
  label: string;
  minutes: number;
  questions: { answered: number; correct: number; accuracy: number | null };
  cards: { reviewed: number; again: number; againRate: number | null };
}

/** Enough attempts for a comparison to mean anything at all. */
export const MIN_COMPARISON_SAMPLE = 20;

function conditionAt(time: number, intervals: Array<{ presetId: SoundscapeId; start: number; end: number }>): Condition {
  for (const interval of intervals) if (time >= interval.start && time < interval.end) return interval.presetId;
  return "quiet";
}

/**
 * Split question attempts and card reviews by what was playing at the time.
 * "Quiet" only counts activity after the first logged play, so the baseline
 * covers the same period of study rather than months before the experiment.
 */
export function compareListeningConditions(input: {
  log: ListeningInterval[];
  attempts: Array<{ at: string; status: string }>;
  reviews: Array<{ at: string; rating: string }>;
  since?: Date;
}): ConditionStats[] {
  const intervals = input.log
    .map((entry) => ({ presetId: entry.presetId, start: Date.parse(entry.start), end: Date.parse(entry.end) }))
    .sort((a, b) => a.start - b.start);
  if (!intervals.length) return [];
  const from = Math.max(intervals[0].start, input.since?.getTime() ?? 0);
  const stats = new Map<Condition, ConditionStats>();
  const bucket = (condition: Condition) => {
    let entry = stats.get(condition);
    if (!entry) {
      entry = {
        condition,
        label: condition === "quiet" ? "Quiet" : SOUNDSCAPES[condition].name,
        minutes: 0,
        questions: { answered: 0, correct: 0, accuracy: null },
        cards: { reviewed: 0, again: 0, againRate: null },
      };
      stats.set(condition, entry);
    }
    return entry;
  };
  for (const interval of intervals) {
    if (interval.end >= from) bucket(interval.presetId).minutes += Math.max(0, interval.end - Math.max(interval.start, from)) / 60_000;
  }
  for (const attempt of input.attempts) {
    const time = Date.parse(attempt.at);
    if (!(time >= from) || !["correct", "incorrect", "guessed"].includes(attempt.status)) continue;
    const entry = bucket(conditionAt(time, intervals)).questions;
    entry.answered += 1;
    if (attempt.status === "correct") entry.correct += 1;
  }
  for (const review of input.reviews) {
    const time = Date.parse(review.at);
    if (!(time >= from)) continue;
    const entry = bucket(conditionAt(time, intervals)).cards;
    entry.reviewed += 1;
    if (review.rating === "again") entry.again += 1;
  }
  return [...stats.values()]
    .map((entry) => ({
      ...entry,
      minutes: Math.round(entry.minutes),
      questions: { ...entry.questions, accuracy: entry.questions.answered >= MIN_COMPARISON_SAMPLE ? entry.questions.correct / entry.questions.answered : null },
      cards: { ...entry.cards, againRate: entry.cards.reviewed >= MIN_COMPARISON_SAMPLE ? entry.cards.again / entry.cards.reviewed : null },
    }))
    .sort((a, b) => (a.condition === "quiet" ? -1 : b.condition === "quiet" ? 1 : b.minutes - a.minutes));
}
