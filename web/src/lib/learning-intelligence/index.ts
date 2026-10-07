// ===========================================================================
// Learning intelligence. Everything here is derived from the questions and the
// attempts the workspace already holds: nothing is stored, so there is no
// second copy of anyone's progress to fall out of step, and any result can be
// recomputed and checked.
//
//   attempts          answers as a time-ordered stream, with first and repeat
//   questionFeatures  what a question asks for, read from its wording
//   difficulty        structural (from wording) and empirical (from answers)
//   patterns          findings a learner can act on, each with its footing
//   style             how a source asks its questions
//   review            what to look at again after a block, and when
// ===========================================================================
export { attemptEvents, median, tally, type AttemptEvent, type Tally } from "./attempts";
export {
  ITEM_CUE_LABEL, QUESTION_TASK_LABEL, questionFeatures,
  type ItemCue, type QuestionFeatures, type QuestionTask,
} from "./questionFeatures";
export {
  DIFFICULTY_TIER_LABEL, MIN_ANSWERS_PER_TIER, MIN_ATTEMPTS_FOR_EMPIRICAL,
  calibrateDifficulty, empiricalDifficulty, structuralDifficulty,
  type DifficultySignature, type DifficultyTier, type EmpiricalDifficulty, type StructuralDifficulty, type TierCalibration,
} from "./difficulty";
export {
  EVIDENCE_BASIS_LABEL, MIN_GAP_POINTS, MIN_GROUP_ANSWERS, buildPatternReport,
  type ConfusionPair, type EvidenceBasis, type Finding, type FindingKind, type GroupStat, type PatternReport,
} from "./patterns";
export {
  MIN_STYLE_SAMPLE, describeQuestionStyle, styleObservations,
  type CueRate, type Share, type StyleSignature,
} from "./style";
export {
  RETRY_WHEN_LABEL, REVIEW_REASON_LABEL, buildReviewSet, reviewCandidates, reviewCandidatesForSession, reviewPriority,
  type RetryWhen, type ReviewCandidate, type ReviewReason,
} from "./review";
