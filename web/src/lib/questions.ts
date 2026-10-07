// ===========================================================================
// Question Workspace domain model (directive Phase 4). Typed practice-question
// records with provenance, an error taxonomy that surfaces recurring patterns
// (not just wrong-answer counts), review scheduling, weak-topic aggregation,
// and the faculty style analyzer (Phase 6 §13). Pure + testable.
// ===========================================================================
import type { ID } from "./types";
import { normalizeTagList } from "./questionTags";
import {
  normalizeQuestionAnnotations,
  reconcileQuestionAnnotationSources,
  type QuestionTextAnnotation,
} from "./questionAnnotations";
import { normalizeQuestionAttachments, type QuestionImageAttachment } from "./questionAttachments";
import { normalizeQuestionAnalyses } from "./decode/normalize";
import type { QuestionAnalysis } from "./decode/types";

export type QuestionStatus =
  | "unseen"
  | "in-progress"
  | "correct"
  | "incorrect"
  | "guessed"
  | "flagged"
  | "needs-review";

export type QuestionSource = "pasted" | "screenshot" | "image" | "pdf" | "imported" | "manual" | "ai-generated";

/** Broad exam-style buckets for filtering and exam-mode pools. */
export type QuestionExamType = "imcq" | "esop" | "board" | "mcat" | "shelf" | "lecture" | "custom";

export const EXAM_TYPE_LABEL: Record<QuestionExamType, string> = {
  imcq: "IMCQ",
  esop: "ESOP",
  board: "Board-style",
  mcat: "MCAT-style",
  shelf: "Shelf-style",
  lecture: "Lecture-based",
  custom: "Custom",
};

export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface QuestionTaxonomy {
  system?: string;
  discipline?: string;
  topic?: string;
  subtopic?: string;
  facultyStyle?: string;
  errorPattern?: string;
}

/** Suggested category vocabulary — users can type anything; these seed the pickers. */
// Restrained USMLE-style buckets (see lib/taxonomy.ts for the canonical set +
// the keyless auto-categorizer). Kept here as the picker vocabulary.
export const QUESTION_CATEGORIES = [
  "Biochemistry", "Immunology", "Microbiology", "Pathology", "Pharmacology",
  "Physiology", "Anatomy", "Behavioral Science", "Biostatistics / Epidemiology",
  "Ethics", "Genetics", "Embryology", "Neuroscience", "Cardiovascular",
  "Respiratory", "Renal", "Gastrointestinal", "Endocrine", "Reproductive",
  "Hematology / Oncology", "Musculoskeletal / Dermatology", "Psychiatry",
  "Public Health", "Custom",
] as const;

/** Structured error taxonomy (directive §9) — why a question was missed. */
export type QuestionErrorType =
  | "knowledge-gap"
  | "misread-stem"
  | "missed-clue"
  | "wrong-differential"
  | "incorrect-mechanism"
  | "management-error"
  | "timing-error"
  | "changed-correct-answer"
  | "overthinking"
  | "memorization-failure"
  | "data-interpretation"
  | "test-strategy";

export const ERROR_TYPE_LABEL: Record<QuestionErrorType, string> = {
  "knowledge-gap": "Knowledge gap",
  "misread-stem": "Misread the stem",
  "missed-clue": "Missed a clue",
  "wrong-differential": "Wrong differential",
  "incorrect-mechanism": "Incorrect mechanism",
  "management-error": "Management error",
  "timing-error": "Ran out of time",
  "changed-correct-answer": "Changed a correct answer",
  overthinking: "Overthinking",
  "memorization-failure": "Memorization failure",
  "data-interpretation": "Image/data interpretation",
  "test-strategy": "Test-taking strategy",
};

export interface QuestionOption {
  key: string; // "A", "B", …
  text: string;
}

/** How the question was presented. Absent on attempts logged before it was recorded. */
export type QuestionAttemptMode = "tutor" | "exam" | "simulation" | "manual";

/** How sure the learner said they were BEFORE seeing the result. Never inferred. */
export type AnswerCertainty = "guess" | "unsure" | "sure";

export const ANSWER_CERTAINTY_LABEL: Record<AnswerCertainty, string> = {
  guess: "Guessing",
  unsure: "Not sure",
  sure: "Sure",
};

export interface QuestionAttempt {
  at: string; // ISO
  answerKey?: string;
  status: QuestionStatus;
  /** Confidence in the material after review. The tutor asks this after a miss,
   * so it is not a measure of how sure the answer was: see `certainty`. */
  confidence?: 1 | 2 | 3 | 4 | 5;
  timeSpentSeconds?: number;
  changedFromKey?: string;
  errorType?: QuestionErrorType;
  note?: string;
  /** The block run (QuizSession id) that produced this attempt. A run holds one
   * attempt per question: a later write for the same run amends it. */
  quizSessionId?: ID;
  mode?: QuestionAttemptMode;
  /** Stated before the answer was checked; the only basis for calibration. */
  certainty?: AnswerCertainty;
}

export type ExtractionConfidence = "high" | "medium" | "low";

/**
 * Parser diagnostics are persisted with imported questions so a user can
 * inspect why a mapping was accepted, repair it later, and keep that evidence
 * across backup/export cycles. Numeric scores are conservative 0..1 values;
 * `confidence` remains as the backwards-compatible display bucket.
 */
export interface QuestionImportDiagnostics {
  confidence: ExtractionConfidence;
  reviewed: boolean;
  reviewedAt?: string;
  questionDetectionConfidence?: number;
  answerDetectionConfidence?: number;
  explanationDetectionConfidence?: number;
  overallImportConfidence?: number;
  warnings?: string[];
  parserRuleIds?: string[];
  /** Legacy combined excerpt retained for backwards-compatible imports. */
  sourceSnippet?: string;
  /** Exact question/options excerpt, separate from answer and explanation evidence. */
  questionSourceSnippet?: string;
  questionSourcePage?: number;
  /** Exact source text that supported the selected answer mapping. */
  answerEvidence?: string;
  answerEvidenceSnippet?: string;
  answerEvidencePage?: number;
  /** Exact explanation excerpt when the source exposed one. */
  explanationSourceSnippet?: string;
  explanationSourcePage?: number;
  explanationSource?: "inline" | "answer-section" | "feedback" | "manual";
  /** Raw parser candidate retained alongside the cleaned `explanation` field. */
  explanationRawCandidate?: string;
  /** Stable deterministic cleanup operations applied to the raw candidate. */
  explanationCleanupOperations?: string[];
}

export interface QuestionRecord {
  id: ID;
  source: QuestionSource;
  /** Original upload metadata — the file itself is not stored, its identity is. */
  sourceFile?: { name: string; type: string; size: number; addedAt: string };
  stem: string;
  options: QuestionOption[];
  correctKey?: string;
  /** Derived from correctKey + options at validation/update time. */
  correctAnswerText?: string;
  explanation?: string;
  /** Per-choice rationales ("A is incorrect because…"), keyed by letter. */
  choiceRationales?: Record<string, string>;
  /** Parser flagged an unresolved conflict/ambiguity — surfaces a review badge. */
  needsReview?: boolean;
  /** Latest attempt state, denormalized for filtering. */
  userAnswerKey?: string;
  status: QuestionStatus;
  confidence?: 1 | 2 | 3 | 4 | 5;
  timeSpentSeconds?: number;
  courseId?: ID;
  module?: string;
  /** Week of the module this question belongs to (lib/course-engine/scope). */
  week?: number;
  system?: string;
  topic?: string;
  objective?: string;
  /** Named question bank / set this question belongs to (user-defined label). */
  bank?: string;
  /** Formal links into the library (schema v30): set + source document. */
  setId?: ID;
  sourceDocumentId?: ID;
  /** The source document's own numbering and page, when known. */
  questionNumber?: number;
  sourcePage?: number;
  category?: string;
  subcategory?: string;
  taxonomy?: QuestionTaxonomy;
  examType?: QuestionExamType;
  difficulty?: QuestionDifficulty;
  /** User-marked for review — independent of status. */
  marked?: boolean;
  tags: string[];
  errorType?: QuestionErrorType;
  notes?: string;
  /** Learner-owned overlays; imported source text remains immutable. */
  annotations?: QuestionTextAnnotation[];
  /** Note image metadata only — bytes live in the questionAttachmentBlobs store. */
  attachments?: QuestionImageAttachment[];
  /**
   * What the question's source teaches about it (lib/decode): the rule, why
   * each other option is wrong, the pages it rests on. About the question,
   * never about the learner.
   */
  analyses?: QuestionAnalysis[];
  attempts: QuestionAttempt[];
  attemptedAt?: string;
  reviewDueAt?: string;
  ai?: { generated: boolean; provider?: string; model?: string; promptVersion?: string };
  extraction?: QuestionImportDiagnostics;
  citation?: string;
  createdAt: string;
  updatedAt: string;
}

// --- collection metrics + mapping review --------------------------------------

/** User-facing readiness of a saved question's imported answer mapping. */
export type QuestionMappingStatus = "ready" | "review-suggested" | "unresolved";

export const QUESTION_MAPPING_STATUS_LABEL: Record<QuestionMappingStatus, string> = {
  ready: "Ready",
  "review-suggested": "Review suggested",
  unresolved: "Unresolved",
};

export interface QuestionMappingSummary {
  ready: number;
  reviewSuggested: number;
  unresolved: number;
  issueCount: number;
  issueQuestionIds: ID[];
  reviewSuggestedQuestionIds: ID[];
  unresolvedQuestionIds: ID[];
}

/**
 * Canonical mapping readiness. Explicit uncertainty or a missing key is always
 * unresolved. A keyed imported question is merely suggested for review until
 * its extraction metadata is confirmed. Legacy/manual keyed questions have no
 * extraction review gate and are therefore ready.
 *
 * Deliberately do not consult `question.status`: it is the latest practice
 * outcome and can remain `needs-review` after a user repairs the mapping.
 */
export function questionMappingStatus(question: QuestionRecord): QuestionMappingStatus {
  if (!question.correctKey || question.needsReview === true) return "unresolved";
  if (question.extraction && question.extraction.reviewed !== true) return "review-suggested";
  return "ready";
}

/** One canonical issue count and routing list for landing, cards, and filters. */
export function summarizeQuestionMappings(
  questions: readonly QuestionRecord[],
): QuestionMappingSummary {
  const summary: QuestionMappingSummary = {
    ready: 0,
    reviewSuggested: 0,
    unresolved: 0,
    issueCount: 0,
    issueQuestionIds: [],
    reviewSuggestedQuestionIds: [],
    unresolvedQuestionIds: [],
  };

  for (const question of questions) {
    const status = questionMappingStatus(question);
    if (status === "ready") {
      summary.ready += 1;
      continue;
    }
    summary.issueCount += 1;
    summary.issueQuestionIds.push(question.id);
    if (status === "review-suggested") {
      summary.reviewSuggested += 1;
      summary.reviewSuggestedQuestionIds.push(question.id);
    } else {
      summary.unresolved += 1;
      summary.unresolvedQuestionIds.push(question.id);
    }
  }
  return summary;
}

export interface QuestionCollectionMetrics {
  total: number;
  completed: number;
  remaining: number;
  completionPct: number;
  currentMasteryCorrect: number;
  currentMasteryQuestions: number;
  currentMasteryPct: number | null;
  historicalCorrectAttempts: number;
  historicalAttemptCount: number;
  historicalAccuracyPct: number | null;
  lastStudiedAt?: string;
  missedQuestionIds: ID[];
}

function parsedTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function latestAttempt(question: QuestionRecord): QuestionAttempt | undefined {
  return question.attempts.reduce<QuestionAttempt | undefined>((current, attempt) => {
    if (!current) return attempt;
    const currentTime = parsedTimestamp(current.at);
    const attemptTime = parsedTimestamp(attempt.at);
    if (currentTime !== undefined && attemptTime !== undefined) {
      return attemptTime >= currentTime ? attempt : current;
    }
    if (attemptTime !== undefined) return attempt;
    if (currentTime !== undefined) return current;
    // Imported malformed timestamps still have a deterministic append order.
    return attempt;
  }, undefined);
}

function latestValidTimestamp(values: readonly (string | undefined)[]): string | undefined {
  let latest: string | undefined;
  let latestTime: number | undefined;
  for (const value of values) {
    const time = parsedTimestamp(value);
    if (time === undefined) continue;
    if (latestTime === undefined || time >= latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

/**
 * Frozen Question Bank semantics shared by the whole-bank landing and set
 * summaries: latest attempt per active question drives current mastery, while
 * every stored attempt drives historical accuracy. Unattempted questions do
 * not enter either accuracy denominator.
 */
export function questionCollectionMetrics(
  questions: readonly QuestionRecord[],
  totalQuestions = questions.length,
): QuestionCollectionMetrics {
  const latestAttempts = questions.flatMap((question) => {
    const latest = latestAttempt(question);
    return latest ? [{ question, attempt: latest }] : [];
  });
  const historicalAttempts = questions.flatMap((question) => question.attempts);
  const currentMasteryCorrect = latestAttempts.filter(({ attempt }) => attempt.status === "correct").length;
  const currentMasteryPct = latestAttempts.length
    ? Math.round((currentMasteryCorrect / latestAttempts.length) * 100)
    : null;
  const historicalCorrectAttempts = historicalAttempts.filter((attempt) => attempt.status === "correct").length;
  const historicalAccuracyPct = historicalAttempts.length
    ? Math.round((historicalCorrectAttempts / historicalAttempts.length) * 100)
    : null;
  const total = Number.isFinite(totalQuestions)
    ? Math.max(0, Math.floor(totalQuestions))
    : questions.length;
  const completed = latestAttempts.length;

  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
    completionPct: total ? Math.round((completed / total) * 100) : 0,
    currentMasteryCorrect,
    currentMasteryQuestions: latestAttempts.length,
    currentMasteryPct,
    historicalCorrectAttempts,
    historicalAttemptCount: historicalAttempts.length,
    historicalAccuracyPct,
    lastStudiedAt: latestValidTimestamp(questions.flatMap((question) => [
      question.attemptedAt,
      ...question.attempts.map((attempt) => attempt.at),
    ])),
    missedQuestionIds: latestAttempts
      .filter(({ attempt }) => attempt.status === "incorrect" || attempt.status === "guessed")
      .map(({ question }) => question.id),
  };
}

// --- validation ---------------------------------------------------------------

export interface ValidationResult<T> {
  ok: boolean;
  errors: string[];
  value?: T;
}

const STATUSES: QuestionStatus[] = ["unseen", "in-progress", "correct", "incorrect", "guessed", "flagged", "needs-review"];
const SOURCES: QuestionSource[] = ["pasted", "screenshot", "image", "pdf", "imported", "manual", "ai-generated"];
const ERROR_TYPES = Object.keys(ERROR_TYPE_LABEL) as QuestionErrorType[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an unknown payload into a QuestionRecord. Used at every boundary
 * (paste parser, import, AI generation) so broken extraction can never corrupt
 * saved records. Missing safe fields are defaulted; structural problems fail.
 */
export function validateQuestionRecord(input: unknown, now: Date = new Date()): ValidationResult<QuestionRecord> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Question must be an object."] };

  const stem = typeof input.stem === "string" ? input.stem.trim() : "";
  if (!stem) errors.push("Question stem is required.");
  if (stem.length > 8000) errors.push("Question stem is unreasonably long (>8000 chars).");

  const rawOptions = Array.isArray(input.options) ? input.options : [];
  const options: QuestionOption[] = [];
  for (const opt of rawOptions) {
    if (!isRecord(opt) || typeof opt.text !== "string" || !opt.text.trim()) continue;
    const key = typeof opt.key === "string" && opt.key.trim()
      ? opt.key.trim().toUpperCase()
      : String.fromCharCode(65 + options.length);
    options.push({ key, text: opt.text.trim() });
  }
  const keys = new Set(options.map((o) => o.key));
  if (keys.size !== options.length) errors.push("Answer option keys must be unique.");

  const correctKey = typeof input.correctKey === "string" && input.correctKey.trim()
    ? input.correctKey.trim().toUpperCase()
    : undefined;
  if (correctKey && options.length > 0 && !keys.has(correctKey)) {
    errors.push(`Correct answer "${correctKey}" does not match any option.`);
  }

  const status = STATUSES.includes(input.status as QuestionStatus) ? input.status as QuestionStatus : "unseen";
  const source = SOURCES.includes(input.source as QuestionSource) ? input.source as QuestionSource : "manual";
  const errorType = ERROR_TYPES.includes(input.errorType as QuestionErrorType) ? input.errorType as QuestionErrorType : undefined;

  if (errors.length) return { ok: false, errors };

  const iso = now.toISOString();
  return {
    ok: true,
    errors: [],
    value: reconcileQuestionAnnotationSources({
      id: typeof input.id === "string" && input.id ? input.id : crypto.randomUUID(),
      source,
      sourceFile: isRecord(input.sourceFile) && typeof input.sourceFile.name === "string"
        ? {
            name: input.sourceFile.name,
            type: typeof input.sourceFile.type === "string" ? input.sourceFile.type : "unknown",
            size: typeof input.sourceFile.size === "number" ? input.sourceFile.size : 0,
            addedAt: typeof input.sourceFile.addedAt === "string" ? input.sourceFile.addedAt : iso,
          }
        : undefined,
      stem,
      options,
      correctKey,
      correctAnswerText: correctKey ? options.find((option) => option.key === correctKey)?.text : undefined,
      explanation: typeof input.explanation === "string" && input.explanation.trim() ? input.explanation.trim() : undefined,
      choiceRationales: isRecord(input.choiceRationales)
        ? Object.fromEntries(Object.entries(input.choiceRationales)
            .filter(([, v]) => typeof v === "string" && v.trim())
            .map(([k, v]) => [k.toUpperCase(), String(v).trim()]))
        : undefined,
      needsReview: input.needsReview === true ? true : undefined,
      userAnswerKey: typeof input.userAnswerKey === "string" ? input.userAnswerKey.toUpperCase() : undefined,
      status,
      confidence: isConfidence(input.confidence) ? input.confidence : undefined,
      timeSpentSeconds: typeof input.timeSpentSeconds === "number" && input.timeSpentSeconds >= 0 ? input.timeSpentSeconds : undefined,
      courseId: typeof input.courseId === "string" ? input.courseId : undefined,
      module: cleanString(input.module),
      week: weekNumber(input.week),
      system: cleanString(input.system),
      topic: cleanString(input.topic),
      objective: cleanString(input.objective),
      bank: cleanString(input.bank),
      setId: typeof input.setId === "string" && input.setId ? input.setId : undefined,
      sourceDocumentId: typeof input.sourceDocumentId === "string" && input.sourceDocumentId ? input.sourceDocumentId : undefined,
      questionNumber: typeof input.questionNumber === "number" && input.questionNumber > 0 ? Math.floor(input.questionNumber) : undefined,
      sourcePage: typeof input.sourcePage === "number" && input.sourcePage > 0 ? Math.floor(input.sourcePage) : undefined,
      category: cleanString(input.category),
      subcategory: cleanString(input.subcategory),
      taxonomy: normalizeQuestionTaxonomy(input.taxonomy, input),
      examType: (Object.keys(EXAM_TYPE_LABEL) as QuestionExamType[]).includes(input.examType as QuestionExamType)
        ? input.examType as QuestionExamType
        : undefined,
      difficulty: (["easy", "medium", "hard"] as const).includes(input.difficulty as QuestionDifficulty)
        ? input.difficulty as QuestionDifficulty
        : undefined,
      marked: input.marked === true,
      tags: normalizeTagList(input.tags),
      errorType,
      notes: cleanString(input.notes),
      annotations: normalizeQuestionAnnotations(input.annotations),
      attachments: normalizeQuestionAttachments(input.attachments),
      analyses: normalizeQuestionAnalyses(input.analyses),
      attempts: Array.isArray(input.attempts) ? (input.attempts as QuestionAttempt[]) : [],
      attemptedAt: typeof input.attemptedAt === "string" ? input.attemptedAt : undefined,
      reviewDueAt: typeof input.reviewDueAt === "string" ? input.reviewDueAt : undefined,
      ai: isRecord(input.ai)
        ? {
            generated: input.ai.generated === true,
            provider: cleanString(input.ai.provider),
            model: cleanString(input.ai.model),
            promptVersion: cleanString(input.ai.promptVersion),
          }
        : source === "ai-generated" ? { generated: true } : undefined,
      extraction: isRecord(input.extraction)
        ? {
            confidence: (["high", "medium", "low"] as const).includes(input.extraction.confidence as ExtractionConfidence)
              ? input.extraction.confidence as ExtractionConfidence
              : "low",
            reviewed: input.extraction.reviewed === true,
            reviewedAt: cleanString(input.extraction.reviewedAt),
            questionDetectionConfidence: confidenceScore(input.extraction.questionDetectionConfidence),
            answerDetectionConfidence: confidenceScore(input.extraction.answerDetectionConfidence),
            explanationDetectionConfidence: confidenceScore(input.extraction.explanationDetectionConfidence),
            overallImportConfidence: confidenceScore(input.extraction.overallImportConfidence),
            warnings: stringArray(input.extraction.warnings),
            parserRuleIds: stringArray(input.extraction.parserRuleIds),
            sourceSnippet: cleanString(input.extraction.sourceSnippet),
            questionSourceSnippet: cleanString(input.extraction.questionSourceSnippet),
            questionSourcePage: positiveInteger(input.extraction.questionSourcePage),
            answerEvidence: cleanString(input.extraction.answerEvidence),
            answerEvidenceSnippet: cleanString(input.extraction.answerEvidenceSnippet),
            answerEvidencePage: positiveInteger(input.extraction.answerEvidencePage),
            explanationSourceSnippet: cleanString(input.extraction.explanationSourceSnippet),
            explanationSourcePage: positiveInteger(input.extraction.explanationSourcePage),
            explanationRawCandidate: cleanString(input.extraction.explanationRawCandidate),
            explanationCleanupOperations: stringArray(input.extraction.explanationCleanupOperations),
            explanationSource: (["inline", "answer-section", "feedback", "manual"] as const)
              .includes(input.extraction.explanationSource as "inline")
              ? input.extraction.explanationSource as QuestionImportDiagnostics["explanationSource"]
              : undefined,
          }
        : undefined,
      citation: cleanString(input.citation),
      createdAt: typeof input.createdAt === "string" ? input.createdAt : iso,
      updatedAt: iso,
    }),
  };
}

function cleanString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function confidenceScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/** A week number, also read from "Week 3" so older exports and pasted metadata survive. */
function weekNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value.match(/\d{1,2}/)?.[0]) : value;
  const week = positiveInteger(parsed);
  return week !== undefined && week < 100 ? week : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
  return result.length ? [...new Set(result)] : undefined;
}

/** Keep duplicated display text synchronized whenever an answer/options edit occurs. */
export function withCorrectAnswerText(question: QuestionRecord): QuestionRecord {
  return {
    ...question,
    correctAnswerText: question.correctKey
      ? question.options.find((option) => option.key === question.correctKey)?.text
      : undefined,
  };
}

export function normalizeQuestionTaxonomy(
  value: unknown,
  fallback: {
    system?: unknown;
    topic?: unknown;
    category?: unknown;
    subcategory?: unknown;
    errorType?: unknown;
  } = {},
): QuestionTaxonomy | undefined {
  const record = isRecord(value) ? value : {};
  const taxonomy: QuestionTaxonomy = {
    system: cleanString(record.system) ?? cleanString(fallback.system),
    discipline: cleanString(record.discipline) ?? cleanString(fallback.category),
    topic: cleanString(record.topic) ?? cleanString(fallback.topic),
    subtopic: cleanString(record.subtopic) ?? cleanString(fallback.subcategory),
    facultyStyle: cleanString(record.facultyStyle),
    errorPattern: cleanString(record.errorPattern) ?? cleanString(fallback.errorType),
  };
  const entries = Object.entries(taxonomy).filter(([, field]) => Boolean(field));
  return entries.length ? Object.fromEntries(entries) as QuestionTaxonomy : undefined;
}

function isConfidence(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === "number" && [1, 2, 3, 4, 5].includes(v);
}

// --- attempts + review scheduling ----------------------------------------------

/** Days until the next review, keyed by how the attempt went. */
const REVIEW_INTERVALS: Partial<Record<QuestionStatus, number>> = {
  incorrect: 2,
  guessed: 3,
  "needs-review": 2,
  flagged: 4,
  correct: 10,
};

export function applyAttempt(question: QuestionRecord, attempt: Omit<QuestionAttempt, "at">, now: Date = new Date()): QuestionRecord {
  const amendIndex = attempt.quizSessionId
    ? question.attempts.findIndex((item) => item.quizSessionId === attempt.quizSessionId)
    : -1;
  if (amendIndex >= 0) return amendAttempt(question, amendIndex, attempt, now);

  const at = now.toISOString();
  const full: QuestionAttempt = { ...attempt, at };
  const interval = REVIEW_INTERVALS[attempt.status];
  const reviewDueAt = interval
    ? new Date(now.getTime() + interval * 24 * 60 * 60 * 1000).toISOString()
    : question.reviewDueAt;
  return {
    ...question,
    userAnswerKey: attempt.answerKey ?? question.userAnswerKey,
    status: attempt.status,
    confidence: attempt.confidence ?? question.confidence,
    timeSpentSeconds: attempt.timeSpentSeconds ?? question.timeSpentSeconds,
    errorType: attempt.errorType ?? question.errorType,
    attempts: [...question.attempts, full],
    attemptedAt: at,
    reviewDueAt,
    updatedAt: at,
  };
}

/**
 * The same block run answering the same question again replaces its attempt:
 * the answer keeps its original time and nothing is counted twice. This is what
 * lets the tutor save at "Check answer" and add the error type afterwards, and
 * what makes a resumed or re-committed block safe to write again.
 */
function amendAttempt(
  question: QuestionRecord,
  index: number,
  attempt: Omit<QuestionAttempt, "at">,
  now: Date,
): QuestionRecord {
  const previous = question.attempts[index];
  const full: QuestionAttempt = { ...attempt, at: previous.at };
  const attempts = question.attempts.map((item, position) => (position === index ? full : item));
  const updatedAt = now.toISOString();
  // An older attempt being corrected must not overwrite the latest outcome.
  if (index !== question.attempts.length - 1) return { ...question, attempts, updatedAt };

  const answeredAt = parsedTimestamp(previous.at) ?? now.getTime();
  const interval = REVIEW_INTERVALS[attempt.status];
  return {
    ...question,
    userAnswerKey: attempt.answerKey ?? question.userAnswerKey,
    status: attempt.status,
    confidence: carriedValue(attempt.confidence, previous.confidence, question.confidence),
    timeSpentSeconds: attempt.timeSpentSeconds ?? question.timeSpentSeconds,
    errorType: carriedValue(attempt.errorType, previous.errorType, question.errorType),
    attempts,
    reviewDueAt: interval
      ? new Date(answeredAt + interval * 24 * 60 * 60 * 1000).toISOString()
      : question.reviewDueAt,
    updatedAt,
  };
}

/** A value the amended attempt set and has now cleared is cleared on the question too. */
function carriedValue<T>(next: T | undefined, before: T | undefined, current: T | undefined): T | undefined {
  return next ?? (current === before ? undefined : current);
}

export function dueQuestions(questions: QuestionRecord[], now: Date = new Date()): QuestionRecord[] {
  const iso = now.toISOString();
  return questions.filter((q) => q.reviewDueAt && q.reviewDueAt <= iso);
}

// --- modes ----------------------------------------------------------------------

export type QuestionMode =
  | "study"
  | "mapping-review"
  | "timed-block"
  | "review"
  | "weakness"
  | "faculty-style"
  | "incorrects-only"
  | "guessed-correctly"
  | "changed-answer"
  | "repeat-offenders"
  | "exam-simulation";

export const MODE_META: Record<QuestionMode, { label: string; note: string; ready: boolean }> = {
  study: { label: "Study Mode", note: "Untimed, explanation after each answer.", ready: true },
  "mapping-review": { label: "Mapping Review", note: "Unresolved and review-suggested imported mappings.", ready: true },
  review: { label: "Review Mode", note: "Everything due for another look.", ready: true },
  "incorrects-only": { label: "Incorrects Only", note: "Only questions you missed.", ready: true },
  "guessed-correctly": { label: "Guessed Correctly", note: "Right answer, shaky ground.", ready: true },
  "changed-answer": { label: "Changed Answer", note: "Attempts where you switched answers.", ready: true },
  "repeat-offenders": { label: "Repeat Offenders", note: "Missed more than once.", ready: true },
  weakness: { label: "Weakness Mode", note: "Focused on your weakest topics.", ready: true },
  "timed-block": { label: "Timed Block", note: "Block timing — in development.", ready: false },
  "faculty-style": { label: "Faculty Style", note: "Filtered by analyzed style patterns — in development.", ready: false },
  "exam-simulation": { label: "Exam Simulation", note: "Full simulated block — in development.", ready: false },
};

export function filterForMode(questions: QuestionRecord[], mode: QuestionMode, now: Date = new Date()): QuestionRecord[] {
  switch (mode) {
    case "study":
      return questions.filter((q) => q.status === "unseen" || q.status === "in-progress");
    case "mapping-review":
      return questions.filter((q) => questionMappingStatus(q) !== "ready");
    case "review":
      return dueQuestions(questions, now);
    case "incorrects-only":
      return questions.filter((q) => q.status === "incorrect");
    case "guessed-correctly":
      return questions.filter((q) => q.attempts.some((a) => a.status === "guessed") && q.status !== "incorrect");
    case "changed-answer":
      return questions.filter((q) => q.attempts.some((a) => a.changedFromKey));
    case "repeat-offenders":
      return questions.filter((q) => q.attempts.filter((a) => a.status === "incorrect").length >= 2);
    case "weakness": {
      const weak = new Set(weakTopics(questions, 5).map((w) => w.topic));
      return questions.filter((q) => q.topic && weak.has(q.topic));
    }
    default:
      return [];
  }
}

// --- pattern surfacing ------------------------------------------------------------

export interface WeakTopic {
  topic: string;
  attempts: number;
  incorrect: number;
  missRate: number;
}

export function weakTopics(questions: QuestionRecord[], limit = 5): WeakTopic[] {
  const byTopic = new Map<string, { attempts: number; incorrect: number }>();
  for (const q of questions) {
    const topic = q.topic ?? q.system;
    if (!topic || !q.attempts.length) continue;
    const agg = byTopic.get(topic) ?? { attempts: 0, incorrect: 0 };
    for (const a of q.attempts) {
      agg.attempts++;
      if (a.status === "incorrect" || a.status === "guessed") agg.incorrect++;
    }
    byTopic.set(topic, agg);
  }
  return [...byTopic.entries()]
    .filter(([, v]) => v.attempts >= 2 && v.incorrect > 0)
    .map(([topic, v]) => ({ topic, ...v, missRate: v.incorrect / v.attempts }))
    .sort((a, b) => b.missRate - a.missRate || b.incorrect - a.incorrect)
    .slice(0, limit);
}

export interface ErrorPattern {
  errorType: QuestionErrorType;
  count: number;
  share: number; // 0..1 of classified errors
}

/** Recurring error patterns — the point is the WHY, not the count of wrongs. */
export function errorPatterns(questions: QuestionRecord[]): ErrorPattern[] {
  const counts = new Map<QuestionErrorType, number>();
  let total = 0;
  for (const q of questions) {
    for (const a of q.attempts) {
      if (!a.errorType) continue;
      counts.set(a.errorType, (counts.get(a.errorType) ?? 0) + 1);
      total++;
    }
  }
  return [...counts.entries()]
    .map(([errorType, count]) => ({ errorType, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

// --- faculty style analyzer (Phase 6 §13) -------------------------------------------
// Broad, non-identifying structural patterns only. Output language is hedged —
// never claims certainty about an instructor's intent.

export interface StyleFinding {
  observation: string;
  detail: string;
}

export interface FacultyStyleReport {
  sampleSize: number;
  reliable: boolean;
  findings: StyleFinding[];
  suggestion: string;
}

export function analyzeQuestionStyle(questions: QuestionRecord[]): FacultyStyleReport {
  const sample = questions.filter((q) => q.stem.trim().length > 0);
  const n = sample.length;
  if (n < 5) {
    return {
      sampleSize: n,
      reliable: false,
      findings: [],
      suggestion: "Add at least 5 questions from the same source to see structural patterns.",
    };
  }

  const findings: StyleFinding[] = [];
  const avgStemWords = Math.round(sample.reduce((a, q) => a + q.stem.split(/\s+/).length, 0) / n);
  findings.push({
    observation: avgStemWords > 80 ? "Long, vignette-style stems" : avgStemWords > 35 ? "Moderate stem length" : "Short, direct stems",
    detail: `Average stem length is about ${avgStemWords} words across ${n} questions.`,
  });

  const optionCounts = sample.filter((q) => q.options.length > 0).map((q) => q.options.length);
  if (optionCounts.length) {
    const modal = mode(optionCounts);
    findings.push({ observation: `${modal}-option format appears most often`, detail: `Most questions here carry ${modal} answer choices.` });
  }

  const nextStep = countMatching(sample, /next (best )?step|most appropriate (next )?management/i);
  const mostLikely = countMatching(sample, /most likely|most probable/i);
  const mechanism = countMatching(sample, /mechanism|pathophysiolog|enzyme|receptor|pathway/i);
  const dataHeavy = countMatching(sample, /\blab(s|oratory)?\b|\bimag(e|ing)\b|x-ray|ct |mri|figure|table|shown below/i);

  if (mostLikely / n > 0.3) findings.push({ observation: `"Most likely" phrasing is frequent`, detail: `${pct(mostLikely, n)} of stems ask for the most likely diagnosis/finding — this dataset appears to emphasize recognition.` });
  if (nextStep / n > 0.2) findings.push({ observation: `"Next best step" questions recur`, detail: `${pct(nextStep, n)} of stems ask about management sequencing — questions frequently test application, not just recall.` });
  if (mechanism / n > 0.3) findings.push({ observation: "Mechanism emphasis", detail: `${pct(mechanism, n)} of stems reference mechanisms/pathways — a reasonable preparation focus may be first-principles physiology.` });
  if (dataHeavy / n > 0.25) findings.push({ observation: "Data/image interpretation load", detail: `${pct(dataHeavy, n)} of stems reference labs, imaging, or figures.` });

  const topics = new Map<string, number>();
  for (const q of sample) {
    const t = q.topic ?? q.system;
    if (t) topics.set(t, (topics.get(t) ?? 0) + 1);
  }
  const topTopic = [...topics.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTopic && topTopic[1] / n > 0.2) {
    findings.push({ observation: `Topic weighting toward ${topTopic[0]}`, detail: `${pct(topTopic[1], n)} of tagged questions fall under ${topTopic[0]}.` });
  }

  return {
    sampleSize: n,
    reliable: n >= 12,
    findings,
    suggestion: n >= 12
      ? "These are structural observations of this dataset, not statements about intent. A reasonable preparation focus may be the patterns above plus your own error log."
      : "Patterns from small samples are unstable — treat these as hints until the set grows past ~12 questions.",
  };
}

function countMatching(qs: QuestionRecord[], re: RegExp): number {
  return qs.filter((q) => re.test(q.stem)).length;
}
function pct(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}
function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const v of nums) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
