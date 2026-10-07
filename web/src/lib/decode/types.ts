// ===========================================================================
// Decode: what a source teaches about a question.
//
// Where it sits, and what each layer owns:
//
//   course engine          where a question belongs        lib/course-engine/scope
//   provenance             which page it came from         QuestionRecord.extraction, SourceDocument
//   source analysis        what the source teaches         QuestionRecord.analyses   (this folder)
//   attempts               what the learner did            QuestionRecord.attempts
//   learning intelligence  what the attempts show          lib/learning-intelligence
//
// An analysis is about the question and its source. Nothing in it is about the
// learner: no attempt, error reason, confidence or priority. Those are read
// from the attempts when they are needed. An analysis holds ids and page
// numbers, never a copy of a course, a module or a page of text.
//
// Analyses live on the question, like its highlights and images, so they
// travel with it through save, backup, merge and deletion. There is no Decode
// store, and Decode defines no scope of its own.
// ===========================================================================

/** Where a statement comes from: a page of a stored source document. */
export interface SourceTrace {
  documentId: string;
  /** 1-based. */
  page: number;
  role: "question" | "answer" | "teaching" | "slide";
  /** A short verbatim excerpt. The page's full text stays on the document. */
  quote?: string;
}

export interface DistractorNote {
  /** The option's letter, as the question has it. */
  key: string;
  whyWrong: string;
  /** What would have to be different for this option to be right. */
  wouldFitIf?: string;
}

export type AnalysisOrigin = "source" | "ai";
/** A proposal is not teaching until the learner has reviewed it. */
export type AnalysisStatus = "proposed" | "reviewed" | "rejected";

export interface QuestionAnalysis {
  id: string;
  questionId: string;
  /**
   * The question's source-bearing content when this was written
   * (questionSourceFingerprint). An analysis of a question that has since
   * changed is stale and is not shown as teaching.
   */
  sourceFingerprint: string;
  version: 1;
  /** Read out of the source's own explanation slides, or proposed by a model that was given them. */
  origin: AnalysisOrigin;
  status: AnalysisStatus;
  /** What the question is about, in a few words. */
  concept: string;
  /** What the question asks the learner to do. */
  task?: string;
  /** The rule to carry to the next question of this kind. */
  rule?: string;
  explanation?: string;
  decisiveClues: string[];
  mechanism: string[];
  distractors: DistractorNote[];
  /** The lecture the source names for this question, in the source's words. */
  lecture?: string;
  references: SourceTrace[];
  provider?: string;
  promptVersion?: string;
  generatedAt: string;
}

/** Bounds on what is kept, so teaching cannot swell a workspace past what sync will carry. */
export const ANALYSIS_LIMITS = {
  perQuestion: 4,
  concept: 250,
  task: 500,
  rule: 1200,
  explanation: 2500,
  listItem: 800,
  listLength: 8,
  lecture: 250,
  quote: 400,
  references: 8,
} as const;
