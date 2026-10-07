// ===========================================================================
// AXOM's difficulty. Two different things, never blended:
//
//   Structural: read from the question's wording (how many steps it hides,
//   how alike its options are, how much it makes you sift). Available for any
//   question, and an inference.
//
//   Empirical: what happened when the question was answered. Only stated when
//   there are enough answers to mean something; otherwise it says how many
//   more it needs.
// ===========================================================================
import type { QuestionRecord } from "../questions";
import { tally, type AttemptEvent, type Tally } from "./attempts";
import { questionFeatures, type QuestionFeatures } from "./questionFeatures";

export interface DifficultySignature {
  /** Steps between the stem and the answer. */
  reasoningSteps: number;
  /** How alike the options are. */
  distractorSimilarity: number;
  /** How much the stem makes the reader sift. */
  informationLoad: number;
  /** A stem that asks for the exception. */
  trap: number;
}

export type DifficultyTier = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_TIER_LABEL: Record<DifficultyTier, string> = {
  1: "Direct",
  2: "Light",
  3: "Moderate",
  4: "Demanding",
  5: "Hard",
};

export interface StructuralDifficulty {
  signature: DifficultySignature;
  /** 0..1 */
  score: number;
  tier: DifficultyTier;
  /** The one dimension contributing most, for a one-line reason. */
  driver: keyof DifficultySignature;
}

const WEIGHTS: Record<keyof DifficultySignature, number> = {
  reasoningSteps: 0.45,
  distractorSimilarity: 0.25,
  informationLoad: 0.2,
  trap: 0.1,
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function structuralDifficulty(question: QuestionRecord, features: QuestionFeatures = questionFeatures(question)): StructuralDifficulty {
  const signature: DifficultySignature = {
    reasoningSteps: (features.reasoningDepth - 1) / 2,
    // Options sharing half their words are about as alike as options get.
    distractorSimilarity: clamp(features.optionSimilarity / 0.5),
    informationLoad: clamp((features.stemWords - 30) / 150) * 0.6 + clamp(features.dataPoints / 8) * 0.4,
    trap: features.negativeStem ? 1 : 0,
  };
  const keys = Object.keys(WEIGHTS) as Array<keyof DifficultySignature>;
  const score = keys.reduce((total, key) => total + signature[key] * WEIGHTS[key], 0);
  const driver = keys.reduce((best, key) => (signature[key] * WEIGHTS[key] > signature[best] * WEIGHTS[best] ? key : best), keys[0]);
  return {
    signature,
    score: Math.round(score * 100) / 100,
    tier: (Math.min(4, Math.floor(score * 5)) + 1) as DifficultyTier,
    driver,
  };
}

/** Answers needed before a question's own record says anything about it. */
export const MIN_ATTEMPTS_FOR_EMPIRICAL = 3;

export type EmpiricalDifficulty =
  | { status: "insufficient"; attempts: number; needed: number }
  | { status: "estimated"; attempts: number; missRate: number; firstTimeCorrect: boolean };

/** One learner's record on one question. Three answers is a floor, not a guarantee. */
export function empiricalDifficulty(events: readonly AttemptEvent[]): EmpiricalDifficulty {
  const scored = events.filter((event) => event.correct !== undefined);
  if (scored.length < MIN_ATTEMPTS_FOR_EMPIRICAL) {
    return { status: "insufficient", attempts: scored.length, needed: MIN_ATTEMPTS_FOR_EMPIRICAL - scored.length };
  }
  const first = [...scored].sort((left, right) => left.exposure - right.exposure)[0];
  return {
    status: "estimated",
    attempts: scored.length,
    missRate: Math.round((scored.filter((event) => !event.correct).length / scored.length) * 100) / 100,
    firstTimeCorrect: first.correct === true,
  };
}

/** First-time answers needed in a tier before its accuracy is shown. */
export const MIN_ANSWERS_PER_TIER = 8;

export interface TierCalibration {
  tier: DifficultyTier;
  firstTime: Tally;
  sufficient: boolean;
}

/**
 * Does structural difficulty track how the learner actually does? First-time
 * answers only, grouped by tier. If accuracy does not fall as tiers rise, the
 * structural reading is not predicting much for this learner, and says so.
 */
export function calibrateDifficulty(
  questions: readonly QuestionRecord[],
  events: readonly AttemptEvent[],
): { tiers: TierCalibration[]; tracks: boolean | undefined } {
  const tierOf = new Map(questions.map((question) => [question.id, structuralDifficulty(question).tier]));
  const tiers = ([1, 2, 3, 4, 5] as DifficultyTier[]).map((tier) => {
    const firstTime = tally(events.filter((event) => event.exposure === 1 && tierOf.get(event.questionId) === tier));
    return { tier, firstTime, sufficient: firstTime.attempts >= MIN_ANSWERS_PER_TIER };
  });
  const usable = tiers.filter((entry) => entry.sufficient);
  const tracks = usable.length >= 2
    ? usable[0].firstTime.accuracy! > usable[usable.length - 1].firstTime.accuracy!
    : undefined;
  return { tiers, tracks };
}
