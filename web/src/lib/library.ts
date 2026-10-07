// ===========================================================================
// Source Library + Question Sets (Import rehaul, layers 3). Uploaded documents
// and parsed question sets are SEPARATE but linked records: a file can live as
// a reference document only, become a question set, or both. Stable IDs
// everywhere; persistence in store.ts (schema v30).
// ===========================================================================
import type { ID } from "./types";
import {
  questionCollectionMetrics,
  summarizeQuestionMappings,
  type QuestionCollectionMetrics,
  type QuestionMappingSummary,
  type QuestionRecord,
} from "./questions";
import { applyQuestionFilter, normalizeQuestionFilter, type QuestionFilterCriteria } from "./questionFilters";
import { orderQuestions, type QuestionOrdering } from "./questionOrdering";
import { normalizeTagList } from "./questionTags";

export interface SourceDocument {
  id: ID;
  title: string;
  fileName: string;
  fileType: string; // mime or extension label
  uploadedAt: string;
  /** Extracted text (capped in extractText.ts). Empty for scans/no-text files. */
  rawText: string;
  /** Per-page text for formats that have pages (PDF). */
  pageTexts?: string[];
  sizeBytes: number;
  /** SHA-256 of the original file bytes; used for non-destructive duplicate detection. */
  checksum?: string;
  tags: string[];
  linkedQuestionSetIds: ID[];
  /** True when the user chose "library document only" (no question set). */
  libraryOnly: boolean;
}

export interface QuestionSetDigest {
  summary: string;
  pitfalls: string[];
  suggestedReview: string[];
  generatedBy: string;
  generatedAt: string;
}

export interface QuestionSet {
  id: ID;
  title: string;
  sourceDocumentIds: ID[];
  createdAt: string;
  /** IMMUTABLE membership snapshot. Later tag/filter changes never mutate this. */
  questionIds: ID[];
  tags: string[];
  aiEnhanced: boolean;
  parserWarnings: string[];
  /** AI-generated digest (review-gated feature output, clearly labeled). */
  digest?: QuestionSetDigest;
  // --- Q2b-3: sets built from a Bank filter capture how they were made so the
  // membership is reproducible and explainable (the snapshot itself never moves).
  /** The filter that produced this set, recorded for display/provenance. */
  filterSnapshot?: QuestionFilterCriteria;
  /** Ordering used to sequence questionIds at creation time. */
  ordering?: QuestionOrdering;
  /** Seed for `ordering: "random"` — re-running the seed reproduces the order. */
  seed?: string;
  /** Where the set sits in the course. Its questions inherit this unless they say otherwise. */
  scope?: { module?: string; week?: number; courseId?: ID };
  /** What the set is. Absent on sets saved before this was recorded: treat as "source". */
  kind?: QuestionSetKind;
  /** The set this one was drawn from, for review and custom sets. */
  parentSetId?: ID;
}

/**
 * A set never copies questions: it lists their ids. So a review set, a custom
 * mix and the source set it came from all point at the same question records.
 */
export type QuestionSetKind = "source" | "custom" | "review" | "generated";

export const QUESTION_SET_KIND_LABEL: Record<QuestionSetKind, string> = {
  source: "Source",
  custom: "Custom",
  review: "Review",
  generated: "AXOM generated",
};

/** Older review sets are recognised by the tag the block results gave them. */
export function questionSetKind(set: Pick<QuestionSet, "kind" | "tags">): QuestionSetKind {
  return set.kind ?? (set.tags.includes("missed-review") ? "review" : "source");
}

/** Build a deterministic static snapshot from a live filter over the bank.
 * Applies the filter, orders the survivors, and freezes their ids as membership.
 * Pure — the caller persists the returned set via the store. */
export function buildQuestionSetFromFilter(input: {
  id: ID;
  title: string;
  questions: readonly QuestionRecord[];
  criteria: QuestionFilterCriteria;
  ordering: QuestionOrdering;
  seed?: string;
  now: string;
  tags?: readonly string[];
  /** Injected for deterministic tests; defaults to Date.parse of `now`. */
  filterNow?: number;
}): QuestionSet {
  const criteria = normalizeQuestionFilter(input.criteria);
  const filterNow = input.filterNow ?? (Number.isFinite(Date.parse(input.now)) ? Date.parse(input.now) : Date.now());
  const matched = applyQuestionFilter(input.questions, criteria, filterNow);
  const ordered = orderQuestions(matched, input.ordering, input.seed);
  return {
    id: input.id,
    title: input.title.trim() || "Untitled set",
    sourceDocumentIds: [],
    createdAt: input.now,
    questionIds: ordered.map((question) => question.id),
    tags: normalizeTagList(input.tags),
    aiEnhanced: false,
    parserWarnings: [],
    filterSnapshot: criteria,
    ordering: input.ordering,
    seed: input.ordering === "random" ? input.seed : undefined,
  };
}

/** Historical accuracy for a set across every recorded attempt. */
export function setAccuracy(
  set: QuestionSet,
  attemptsByQuestion: Map<ID, { correct: number; total: number }>,
): { correct: number; total: number; pct: number | null } {
  let correct = 0;
  let total = 0;
  for (const qid of set.questionIds) {
    const a = attemptsByQuestion.get(qid);
    if (!a) continue;
    correct += a.correct;
    total += a.total;
  }
  return { correct, total, pct: total ? Math.round((correct / total) * 100) : null };
}

export type AccuracyTone = "green" | "gold" | "orange" | "red" | "neutral";

/** Product-specified percentage thresholds. Bar length represents completion;
 * this tone represents current mastery, so the two signals never compete. */
export function accuracyTone(pct: number | null): AccuracyTone {
  if (pct === null) return "neutral";
  if (pct >= 90) return "green";
  if (pct >= 80) return "gold";
  if (pct >= 70) return "orange";
  return "red";
}

export interface QuestionSetMetrics extends QuestionCollectionMetrics {
  currentMasteryTone: AccuracyTone;
  /** Backwards-compatible headline count; includes both mapping categories. */
  needsReview: number;
  /** Present on every value returned by questionSetMetrics. Optional only so
   * static UI fixtures from older callers remain source-compatible. */
  mapping?: QuestionMappingSummary;
  importConfidence: number | null;
  category?: string;
  sourceTitle?: string;
}

export type CalculatedQuestionSetMetrics = QuestionSetMetrics & { mapping: QuestionMappingSummary };

/** One canonical calculation shared by set cards, preview, and tests. */
export function questionSetMetrics(
  set: QuestionSet,
  questions: readonly QuestionRecord[],
  documents: readonly SourceDocument[] = [],
): CalculatedQuestionSetMetrics {
  const ids = new Set(set.questionIds);
  const inSet = questions.filter((question) => ids.has(question.id));
  const collection = questionCollectionMetrics(inSet, set.questionIds.length);
  const mapping = summarizeQuestionMappings(inSet);
  const confidenceScores = inSet
    .map((question) => question.extraction?.overallImportConfidence)
    .filter((value): value is number => typeof value === "number");
  const categories = new Map<string, number>();
  for (const question of inSet) {
    const category = question.category ?? question.system;
    if (category) categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const category = [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const source = documents.find((document) => set.sourceDocumentIds.includes(document.id));
  return {
    ...collection,
    currentMasteryTone: accuracyTone(collection.currentMasteryPct),
    needsReview: mapping.issueCount,
    mapping,
    importConfidence: confidenceScores.length
      ? Math.round((confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length) * 100)
      : null,
    category,
    sourceTitle: source?.title,
  };
}

function validTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Newest activity first without mutating persisted set order. A valid study
 * instant wins; otherwise the set creation instant is used. Missing/invalid and
 * equal dates preserve the stable input order.
 */
export function sortQuestionSetsByRecency(
  sets: readonly QuestionSet[],
  questions: readonly QuestionRecord[],
): QuestionSet[] {
  return sets
    .map((set, index) => {
      const lastStudiedAt = questionSetMetrics(set, questions).lastStudiedAt;
      return {
        set,
        index,
        activityTime: validTimestamp(lastStudiedAt) ?? validTimestamp(set.createdAt),
      };
    })
    .sort((a, b) => {
      if (a.activityTime !== undefined && b.activityTime !== undefined) {
        return b.activityTime - a.activityTime || a.index - b.index;
      }
      if (a.activityTime !== undefined) return -1;
      if (b.activityTime !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ set }) => set);
}

export function documentTitleFromFile(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || fileName;
}
