// ===========================================================================
// What to look at again, and why. After a block, each answered question is
// read for the reasons it deserves a second look. The reasons are facts about
// the attempt; the order they are worked through is a judgement, kept in one
// small function so it can be argued with.
//
// Retry timing: an answer the learner was sure of and got wrong is corrected
// readily when the explanation is read at once, but tends to return about a
// week later if it is not met again (Butler, Fazio and Marsh, 2011). So those
// come back twice: the same day and a week on.
// ===========================================================================
import type { ID } from "../types";
import type { QuestionSet } from "../library";
import type { AnswerCertainty, QuestionErrorType, QuestionRecord } from "../questions";
import { attemptEvents, median, type AttemptEvent } from "./attempts";

export type ReviewReason = "sure-and-wrong" | "repeat-miss" | "wrong" | "unsure-right" | "slow-right" | "unscored";

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  "sure-and-wrong": "Sure, and wrong",
  "repeat-miss": "Missed again",
  wrong: "Wrong",
  "unsure-right": "Right, but not sure",
  "slow-right": "Right, but slow",
  unscored: "No answer key to check against",
};

export type RetryWhen = "today" | "tomorrow" | "this-week" | "in-a-week";

export const RETRY_WHEN_LABEL: Record<RetryWhen, string> = {
  today: "Later today",
  tomorrow: "Tomorrow",
  "this-week": "Later this week",
  "in-a-week": "In a week",
};

export interface ReviewCandidate {
  questionId: ID;
  reasons: ReviewReason[];
  /** Higher is worked through first. */
  priority: number;
  /** When to meet it again, soonest first. */
  retry: RetryWhen[];
}

/** A right answer this much slower than the learner's usual counts as slow. */
const SLOW_FACTOR = 1.75;

/**
 * How urgently a question should be seen again, from the reasons it was
 * flagged. Higher goes first. A question with no reason scores 0.
 */
export function reviewPriority(reasons: readonly ReviewReason[]): number {
  // TODO(human): rank the reasons. See the Learn by Doing note for the trade-offs.
  return reasons.length;
}

/**
 * Everything the order of review may be decided from, for one answered
 * question of a block. This is the whole boundary between what happened and
 * how it is ranked: a ranker reads these facts and returns a number, and it
 * reads nothing else. So the rule below can be replaced, by a better rule or
 * one day by a ranker fitted to the learner's own history, without touching
 * the course engine, Decode or the screens. The reasons stay beside the
 * number, so a ranking can always say why.
 *
 * The optional fields at the end are not supplied yet. A ranker must work
 * without them.
 */
export interface ReviewSignals {
  questionId: ID;
  /** Why the question was flagged, as facts about the attempt. */
  reasons: readonly ReviewReason[];
  /** Undefined when the answer could not be scored. */
  correct: boolean | undefined;
  /** Whether the first answer the learner ever gave to this question was right. */
  firstAttemptCorrect?: boolean;
  /** 1 the first time the learner answered this question. */
  exposure: number;
  /** Misses on this question before this block. */
  earlierMisses: number;
  /** What the learner said before the answer was checked. */
  certainty?: AnswerCertainty;
  /** The reason the learner gave for a miss. */
  errorType?: QuestionErrorType;
  seconds?: number;
  /** The learner's usual time on a right answer, once enough answers are timed. */
  usualSeconds?: number;
  /** When it was answered. */
  at: string;
  /** Not supplied yet: how hard the question is, where it sits in the course, and how near the exam is. */
  difficulty?: "easier" | "middle" | "harder";
  module?: string;
  week?: number;
  daysToExam?: number;
}

/** Higher is worked through first. */
export type ReviewRanker = (signals: ReviewSignals) => number;

/** Today's ranking: by the reasons alone. */
export const rankByReasons: ReviewRanker = (signals) => reviewPriority(signals.reasons);

function retryFor(reasons: readonly ReviewReason[]): RetryWhen[] {
  if (reasons.includes("sure-and-wrong")) return ["today", "in-a-week"];
  if (reasons.includes("repeat-miss")) return ["today", "this-week"];
  if (reasons.includes("wrong")) return ["tomorrow"];
  if (reasons.includes("unsure-right") || reasons.includes("slow-right")) return ["this-week"];
  return [];
}

/**
 * A saved status alone cannot establish a trustworthy pace observation after
 * answer-key revisions. For timing advice require a recorded selected option
 * that can still be checked against the currently reviewed key. This does not
 * regrade or erase legacy status-only attempts used elsewhere in analytics.
 */
function hasVerifiableCorrectChoice(event: AttemptEvent): boolean {
  return event.correct === true && event.answerKey !== undefined
    && event.correctKey !== undefined && event.answerKey === event.correctKey;
}

/** Imported or legacy attempt durations are untrusted at runtime. Invalid
 * duration values must not establish either a pace baseline or slow-right
 * advice; this does not change stored answers or ordinary score tallies. */
function hasValidDurationSeconds(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0;
}

/**
 * The questions of one block worth a second look. `history` is every earlier
 * event for the same questions, so a miss can be told from a repeat miss and
 * "slow" is judged against the learner's own pace.
 */
export function reviewCandidates(
  block: readonly AttemptEvent[],
  history: readonly AttemptEvent[] = block,
  rank: ReviewRanker = rankByReasons,
): ReviewCandidate[] {
  // Require six positive, finite, currently verifiable saved correct choices.
  // Legacy status-only, key-held and contradictory outcomes retain their
  // recorded times, but cannot substantiate a diagnostic pace benchmark.
  const trustedTimed = history
    .filter((event) => hasVerifiableCorrectChoice(event) && hasValidDurationSeconds(event.seconds));
  const trustedCorrectSeconds = trustedTimed.map((event) => event.seconds!).sort((a, b) => a - b);
  const overallUsualSeconds = trustedCorrectSeconds.length >= 6 ? median(trustedCorrectSeconds) : undefined;
  // Session history can contain the block being reviewed. A candidate cannot
  // be its own sixth supporting observation; duplicate identities are held.
  const identity = (event: AttemptEvent) => JSON.stringify([event.questionId, event.at, event.exposure, event.quizSessionId]);
  const paceIdentityCounts = new Map<string, number>();
  for (const event of trustedTimed) {
    const key = identity(event);
    paceIdentityCounts.set(key, (paceIdentityCounts.get(key) ?? 0) + 1);
  }
  const usualWithoutSelf = (event: AttemptEvent): number | undefined => {
    const matches = paceIdentityCounts.get(identity(event)) ?? 0;
    if (matches === 0) return overallUsualSeconds;
    if (matches !== 1 || trustedCorrectSeconds.length < 7 || event.seconds === undefined) return undefined;
    const index = trustedCorrectSeconds.indexOf(event.seconds);
    if (index < 0) return undefined;
    const remaining = trustedCorrectSeconds.length - 1;
    const at = (position: number) => trustedCorrectSeconds[position + (position >= index ? 1 : 0)];
    const mid = Math.floor(remaining / 2);
    return remaining % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
  };
  const earlierMisses = new Map<ID, number>();
  const firstAnswers = new Map<ID, boolean | undefined>();
  const blockKeys = new Set(block.map((event) => `${event.questionId}\u001f${event.at}`));
  for (const event of [...history, ...block]) {
    if (event.exposure === 1) firstAnswers.set(event.questionId, event.correct);
  }
  for (const event of history) {
    if (event.correct === false && !blockKeys.has(`${event.questionId}\u001f${event.at}`)) {
      earlierMisses.set(event.questionId, (earlierMisses.get(event.questionId) ?? 0) + 1);
    }
  }

  const candidates: ReviewCandidate[] = [];
  for (const event of block) {
    const usualSeconds = usualWithoutSelf(event);
    const reasons: ReviewReason[] = [];
    if (event.correct === undefined) reasons.push("unscored");
    else if (event.correct === false) {
      if (event.certainty === "sure") reasons.push("sure-and-wrong");
      if (earlierMisses.has(event.questionId)) reasons.push("repeat-miss");
      if (!reasons.length) reasons.push("wrong");
    } else {
      if (event.certainty === "guess" || event.certainty === "unsure") reasons.push("unsure-right");
      if (hasVerifiableCorrectChoice(event) && hasValidDurationSeconds(event.seconds)
        && usualSeconds !== undefined && event.seconds >= usualSeconds * SLOW_FACTOR) reasons.push("slow-right");
    }
    if (reasons.length) {
      const signals: ReviewSignals = {
        questionId: event.questionId,
        reasons,
        correct: event.correct,
        firstAttemptCorrect: firstAnswers.get(event.questionId),
        exposure: event.exposure,
        earlierMisses: earlierMisses.get(event.questionId) ?? 0,
        certainty: event.certainty,
        errorType: event.errorType,
        seconds: event.seconds,
        usualSeconds,
        at: event.at,
      };
      candidates.push({ questionId: event.questionId, reasons, priority: rank(signals), retry: retryFor(reasons) });
    }
  }
  return candidates.sort((left, right) => right.priority - left.priority);
}

/**
 * The review candidates of a finished block, read from the workspace.
 * A historical block must be read against its own past, not future answers:
 * opening an old result after more practice must never rewrite its reasons.
 *
 * Equal or malformed timestamps are not proof that another event preceded
 * this block. Keep the block itself for scoring, but fail closed on ambiguous
 * external history instead of inventing repeat misses or a faster baseline.
 */
export function reviewCandidatesForSession(
  quizSessionId: ID,
  questions: readonly QuestionRecord[],
): ReviewCandidate[] {
  // Events retain canonical question IDs, not the imported source-row identity.
  // If two records claim an ID, neither its attempts nor its history can be
  // assigned to a defensible retry target. Quarantine both from actionable
  // session review without modifying their saved attempts or scored history.
  const seen = new Set<ID>();
  const ambiguousIds = new Set<ID>();
  for (const question of questions) {
    if (seen.has(question.id)) ambiguousIds.add(question.id);
    seen.add(question.id);
  }
  const attributable = ambiguousIds.size
    ? questions.filter((question) => !ambiguousIds.has(question.id))
    : questions;
  const events = attemptEvents(attributable);
  const block = events.filter((event) => event.quizSessionId === quizSessionId);
  if (!block.length) return [];

  // Use the first answer in the selected session as a conservative cutoff.
  // Events from other sessions interleaved with this one are not prior
  // knowledge of the whole block, even if they precede its final answer.
  const blockTimes = block.map((event) => Date.parse(event.at));
  const start = blockTimes.every(Number.isFinite) ? Math.min(...blockTimes) : undefined;
  const inBlock = new Set(block.map((event) => event.questionId));
  const history = events.filter((event) => {
    if (event.quizSessionId === quizSessionId) return true;
    const at = Date.parse(event.at);
    return start !== undefined && Number.isFinite(at) && at < start
      && (inBlock.has(event.questionId) || event.seconds);
  });
  return reviewCandidates(block, history);
}

/**
 * A review set made from a block. It lists question ids, so the questions and
 * their attempts stay where they are, and it carries the place in the course
 * of the set it came from.
 */
export function buildReviewSet(input: {
  id: ID;
  candidates: readonly ReviewCandidate[];
  reasons: readonly ReviewReason[];
  parent?: Pick<QuestionSet, "id" | "title" | "scope">;
  now: string;
}): QuestionSet {
  const wanted = new Set(input.reasons);
  const picked = input.candidates.filter((candidate) => candidate.reasons.some((reason) => wanted.has(reason)));
  return {
    id: input.id,
    title: `${input.parent ? `${input.parent.title}: ` : ""}review, ${new Date(input.now).toLocaleDateString()}`,
    sourceDocumentIds: [],
    createdAt: input.now,
    // One retry target per canonical question ID, even if this block includes
    // multiple attempts for the same question. Keep the first selected order;
    // source attempts and their independent review reasons remain untouched.
    questionIds: [...new Set(picked.map((candidate) => candidate.questionId))],
    // The existing "missed-review" tag keeps older filters and cards working.
    tags: ["missed-review"],
    aiEnhanced: false,
    parserWarnings: [],
    ordering: "import",
    kind: "review",
    parentSetId: input.parent?.id,
    scope: input.parent?.scope,
  };
}
