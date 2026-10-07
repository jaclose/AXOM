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
import type { QuestionRecord } from "../questions";
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

function retryFor(reasons: readonly ReviewReason[]): RetryWhen[] {
  if (reasons.includes("sure-and-wrong")) return ["today", "in-a-week"];
  if (reasons.includes("repeat-miss")) return ["today", "this-week"];
  if (reasons.includes("wrong")) return ["tomorrow"];
  if (reasons.includes("unsure-right") || reasons.includes("slow-right")) return ["this-week"];
  return [];
}

/**
 * The questions of one block worth a second look. `history` is every earlier
 * event for the same questions, so a miss can be told from a repeat miss and
 * "slow" is judged against the learner's own pace.
 */
export function reviewCandidates(
  block: readonly AttemptEvent[],
  history: readonly AttemptEvent[] = block,
): ReviewCandidate[] {
  const usual = median(history.filter((event) => event.correct && event.seconds).map((event) => event.seconds!));
  const earlierMisses = new Set<ID>();
  const blockKeys = new Set(block.map((event) => `${event.questionId}\u001f${event.at}`));
  for (const event of history) {
    if (event.correct === false && !blockKeys.has(`${event.questionId}\u001f${event.at}`)) earlierMisses.add(event.questionId);
  }

  const candidates: ReviewCandidate[] = [];
  for (const event of block) {
    const reasons: ReviewReason[] = [];
    if (event.correct === undefined) reasons.push("unscored");
    else if (event.correct === false) {
      if (event.certainty === "sure") reasons.push("sure-and-wrong");
      if (earlierMisses.has(event.questionId)) reasons.push("repeat-miss");
      if (!reasons.length) reasons.push("wrong");
    } else {
      if (event.certainty === "guess" || event.certainty === "unsure") reasons.push("unsure-right");
      // Needs a few timed answers before "usual" means anything.
      if (usual && event.seconds && event.seconds >= usual * SLOW_FACTOR && history.filter((item) => item.seconds).length >= 6) reasons.push("slow-right");
    }
    if (reasons.length) {
      candidates.push({ questionId: event.questionId, reasons, priority: reviewPriority(reasons), retry: retryFor(reasons) });
    }
  }
  return candidates.sort((left, right) => right.priority - left.priority);
}

/** The review candidates of a finished block, read from the workspace. */
export function reviewCandidatesForSession(
  quizSessionId: ID,
  questions: readonly QuestionRecord[],
): ReviewCandidate[] {
  const events = attemptEvents(questions);
  const block = events.filter((event) => event.quizSessionId === quizSessionId);
  const inBlock = new Set(block.map((event) => event.questionId));
  return reviewCandidates(block, events.filter((event) => inBlock.has(event.questionId) || event.seconds));
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
    questionIds: picked.map((candidate) => candidate.questionId),
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
