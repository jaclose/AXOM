// ===========================================================================
// Source Library + Question Sets (Import rehaul, layers 3). Uploaded documents
// and parsed question sets are SEPARATE but linked records: a file can live as
// a reference document only, become a question set, or both. Stable IDs
// everywhere; persistence in store.ts (schema v30).
// ===========================================================================
import type { ID } from "./types";
import { sha256 } from "@noble/hashes/sha2.js";
import type { SourceOriginalFile } from "./sourceOriginal";
import {
  questionCollectionMetrics,
  summarizeQuestionMappings,
  questionMappingStatus,
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
  /** Verified local original; account protection requires its separate file acknowledgement. */
  originalFile?: SourceOriginalFile;
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
  /** Absent on legacy AI output. A digest without this exact current source hash
   * must never supply actionable teaching or Course Tracker suggestions. */
  sourceFingerprint?: { version: 1; sha256: string };
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
  /** Non-destructive audit trail for earlier or stale AI teaching replaced by a
   * reviewed-source rebuild. Legacy records remain intact until explicitly resolved. */
  digestHistory?: QuestionSetDigest[];
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
  /** Durable replay guard for a bearer-link import. Never stores the bearer token. */
  importProvenance?: {
    version: 1;
    shareId: string;
    contentDigest: string;
  };
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
  // QuestionSet membership is by canonical ID, never by the number of stored
  // rows. Imported aliases with a collided ID cannot be attributed to one
  // source question, even when the rows happen to have identical answers.
  // Keep all original records intact; hold that membership for source review
  // instead of inflating completion above 100% or borrowing a wrong key/topic.
  const ids = new Set(set.questionIds);
  const inSet = questions.filter((question) => ids.has(question.id));
  const rowCounts = new Map<ID, number>();
  for (const question of inSet) {
    rowCounts.set(question.id, (rowCounts.get(question.id) ?? 0) + 1);
  }
  const scorable = inSet.filter((question) => rowCounts.get(question.id) === 1);
  const collection = questionCollectionMetrics(scorable, ids.size);
  const mapping = summarizeQuestionMappings(scorable);
  for (const id of ids) {
    if ((rowCounts.get(id) ?? 0) < 2) continue;
    mapping.unresolved += 1;
    mapping.issueCount += 1;
    mapping.issueQuestionIds.push(id);
    mapping.unresolvedQuestionIds.push(id);
  }
  const confidenceScores = scorable
    .map((question) => question.extraction?.overallImportConfidence)
    .filter((value): value is number => typeof value === "number");
  const categories = new Map<string, number>();
  for (const question of scorable) {
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

// Reviewed-source AI digest revision and membership contracts are shared by
// post-import generation and QBank display/Tracker activation.
export interface DigestMembership {
  records: QuestionRecord[];
  holdReason: string | null;
}

/** The saved set is an ID snapshot, not authority to pick an arbitrary imported
 * row. Never send an ambiguous or incomplete membership to an AI provider. */
export function digestMembership(set: QuestionSet, questions: readonly QuestionRecord[]): DigestMembership {
  const ids = new Set(set.questionIds);
  const byId = new Map<string, QuestionRecord>();
  const collisions = new Set<string>();
  for (const question of questions) {
    if (!ids.has(question.id)) continue;
    if (byId.has(question.id)) collisions.add(question.id);
    else byId.set(question.id, question);
  }
  if (collisions.size > 0) return {
    records: [],
    holdReason: `AI digest on hold: ${collisions.size} question ID${collisions.size === 1 ? " has" : "s have"} conflicting question records. Review source mapping first.`,
  };
  const missing = [...ids].filter((id) => !byId.has(id));
  if (ids.size === 0 || missing.length > 0) return {
    records: [],
    holdReason: `AI digest on hold: ${missing.length || 1} missing question records or empty membership. Restore the original questions first.`,
  };
  const records = [...ids].map((id) => byId.get(id)!);
  const held = records.filter((question) => questionMappingStatus(question) !== "ready");
  if (held.length > 0) return {
    records: [],
    holdReason: `AI digest on hold: ${held.length} question answer mapping${held.length === 1 ? " needs" : "s need"} source review or a required figure. Review the original key and media before AI teaching.`,
  };
  return { records, holdReason: null };
}

/** A versioned SHA-256 of *source* inputs only. Never persist the original
 * question text in metadata; never include digest/history, attempts, status,
 * activity timestamps, or mutable progress in a teaching revision hash.
 * The stable account owner makes identical IDs from different accounts
 * non-interchangeable without storing a raw account ID in the digest. */
export function digestSourceFingerprint(set: QuestionSet, records: readonly QuestionRecord[], owner: string): string {
  const serialized = JSON.stringify({
    version: 1, owner,
    set: {
      id: set.id, title: set.title, questionIds: set.questionIds,
      sourceDocumentIds: set.sourceDocumentIds, scope: set.scope, tags: set.tags,
      parserWarnings: set.parserWarnings, kind: set.kind, parentSetId: set.parentSetId,
      filterSnapshot: set.filterSnapshot, ordering: set.ordering, seed: set.seed,
      importProvenance: set.importProvenance,
    },
    records: records.map((q) => ({
      id: q.id, source: q.source, sourceFile: q.sourceFile, sourceDocumentId: q.sourceDocumentId,
      sourcePage: q.sourcePage, questionNumber: q.questionNumber, stem: q.stem,
      options: q.options, correctKey: q.correctKey, correctAnswerText: q.correctAnswerText,
      explanation: q.explanation, choiceRationales: q.choiceRationales, needsReview: q.needsReview,
      extraction: q.extraction, content: q.content, attachments: q.attachments,
      citation: q.citation, objective: q.objective,
    })),
  });
  return Array.from(sha256(new TextEncoder().encode(serialized)), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

/** Persisted AI output is advice, never primary source evidence. Unknown legacy
 * signatures and changed reviewed source both fail closed until regenerated. */
export function digestHoldReason(set: QuestionSet, membership: DigestMembership, owner: string): string | null {
  if (membership.holdReason) return membership.holdReason;
  if (!set.digest) return null;
  const saved = set.digest.sourceFingerprint;
  if (saved?.version !== 1 || !/^[a-f0-9]{64}$/.test(saved.sha256)
    || saved.sha256 !== digestSourceFingerprint(set, membership.records, owner)) {
    return "AI digest source revision/verification required: this older teaching may not match the currently reviewed source. Its original content is preserved; rebuild the digest before using its advice or Tracker suggestions.";
  }
  return null;
}

