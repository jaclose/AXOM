// ===========================================================================
// Q2b-3: deterministic, composable Question Bank filtering. A QuestionFilter is a
// small serializable record; applyQuestionFilter is a pure, stable pass (input
// order preserved) so the same filter over the same bank always yields the same
// questions. Every facet ANDs with the others; multi-value facets (tags,
// difficulty, status, sources) match by set membership. Normalizers make saved
// presets and question-set snapshots safe to persist and re-import.
// ===========================================================================
import {
  type QuestionDifficulty, type QuestionRecord, type QuestionSource, type QuestionStatus,
} from "./questions";
import { normalizeTagList } from "./questionTags";
import { type QuestionOrdering, isQuestionOrdering } from "./questionOrdering";

const DIFFICULTIES: readonly QuestionDifficulty[] = ["easy", "medium", "hard"];
const STATUSES: readonly QuestionStatus[] = [
  "unseen", "in-progress", "correct", "incorrect", "guessed", "flagged", "needs-review",
];
const SOURCES: readonly QuestionSource[] = [
  "pasted", "screenshot", "image", "pdf", "imported", "manual", "ai-generated",
];

export interface QuestionFilterCriteria {
  /** Free text over stem, options, tags, source, and notes. */
  search?: string;
  /** Canonical tags. `tagMatch` decides ALL (default) vs ANY. */
  tags?: string[];
  tagMatch?: "all" | "any";
  difficulty?: QuestionDifficulty[];
  status?: QuestionStatus[];
  sources?: QuestionSource[];
  courseId?: string;
  /** true → has ≥1 attempt; false → no attempts; undefined → ignore. */
  answered?: boolean;
  /** Boolean facets: true → require; undefined → ignore. */
  bookmarked?: boolean;
  incorrect?: boolean;
  reviewDue?: boolean;
  hasAttachment?: boolean;
  hasNotes?: boolean;
}

export function emptyQuestionFilter(): QuestionFilterCriteria {
  return {};
}

/** A user-saved filter preset. Persisted locally in workspace state. */
export interface SavedQuestionFilter {
  id: string;
  name: string;
  criteria: QuestionFilterCriteria;
  ordering?: QuestionOrdering;
  createdAt: string;
  updatedAt: string;
}

/** Coerce persisted/imported preset lists into valid, deduped-by-id records. */
export function normalizeSavedQuestionFilters(value: unknown): SavedQuestionFilter[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, SavedQuestionFilter>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "";
    if (!id || !name) continue;
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    byId.set(id, {
      id,
      name,
      criteria: normalizeQuestionFilter(raw.criteria),
      ordering: isQuestionOrdering(raw.ordering) ? raw.ordering : undefined,
      createdAt,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
    });
  }
  return [...byId.values()];
}

function sanitizeEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set(allowed);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && set.has(item as T) && !seen.has(item as T)) {
      seen.add(item as T);
      out.push(item as T);
    }
  }
  return out.length ? out : undefined;
}

/** Coerce arbitrary (persisted / imported) input into a valid criteria record.
 * Unknown enum members and stray keys are dropped; empty facets become absent so
 * two equivalent filters serialize identically. */
export function normalizeQuestionFilter(value: unknown): QuestionFilterCriteria {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const criteria: QuestionFilterCriteria = {};
  const search = typeof raw.search === "string" ? raw.search.trim().slice(0, 200) : "";
  if (search) criteria.search = search;
  const tags = normalizeTagList(raw.tags);
  if (tags.length) {
    criteria.tags = tags;
    criteria.tagMatch = raw.tagMatch === "any" ? "any" : "all";
  }
  const difficulty = sanitizeEnumList(raw.difficulty, DIFFICULTIES);
  if (difficulty) criteria.difficulty = difficulty;
  const status = sanitizeEnumList(raw.status, STATUSES);
  if (status) criteria.status = status;
  const sources = sanitizeEnumList(raw.sources, SOURCES);
  if (sources) criteria.sources = sources;
  if (typeof raw.courseId === "string" && raw.courseId.trim()) criteria.courseId = raw.courseId.trim();
  // `answered` is tri-state (true/false/absent); the rest are require-only, so a
  // stored `false` is meaningless — drop it (keeps countActiveFilters honest).
  if (typeof raw.answered === "boolean") criteria.answered = raw.answered;
  for (const key of ["bookmarked", "incorrect", "reviewDue", "hasAttachment", "hasNotes"] as const) {
    if (raw[key] === true) criteria[key] = true;
  }
  return criteria;
}

/** How many facets are active — for the "N filters" affordance and empty checks. */
export function countActiveFilters(criteria: QuestionFilterCriteria): number {
  let n = 0;
  if (criteria.search?.trim()) n += 1;
  if (criteria.tags?.length) n += 1;
  if (criteria.difficulty?.length) n += 1;
  if (criteria.status?.length) n += 1;
  if (criteria.sources?.length) n += 1;
  if (criteria.courseId) n += 1;
  for (const key of ["answered", "bookmarked", "incorrect", "reviewDue", "hasAttachment", "hasNotes"] as const) {
    if (criteria[key] !== undefined) n += 1;
  }
  return n;
}

export function isEmptyQuestionFilter(criteria: QuestionFilterCriteria): boolean {
  return countActiveFilters(criteria) === 0;
}

function matchesSearch(question: QuestionRecord, term: string): boolean {
  if (question.stem.toLowerCase().includes(term)) return true;
  if (question.options.some((option) => option.text.toLowerCase().includes(term))) return true;
  if (question.explanation?.toLowerCase().includes(term)) return true;
  if (question.objective?.toLowerCase().includes(term)) return true;
  if ((question.tags ?? []).some((tag) => tag.includes(term))) return true;
  if (question.notes?.toLowerCase().includes(term)) return true;
  if (question.topic?.toLowerCase().includes(term)) return true;
  const source = `${question.sourceFile?.name ?? ""} ${question.bank ?? ""}`.toLowerCase();
  return source.includes(term);
}

/** Pure, stable filter. Preserves input order; `now` is injected for testability. */
export function applyQuestionFilter(
  questions: readonly QuestionRecord[],
  criteria: QuestionFilterCriteria,
  now: number = Date.now(),
): QuestionRecord[] {
  const term = criteria.search?.trim().toLowerCase() ?? "";
  const tags = criteria.tags ?? [];
  const tagMatch = criteria.tagMatch ?? "all";
  const difficulty = criteria.difficulty?.length ? new Set(criteria.difficulty) : undefined;
  const status = criteria.status?.length ? new Set(criteria.status) : undefined;
  const sources = criteria.sources?.length ? new Set(criteria.sources) : undefined;

  return questions.filter((question) => {
    if (term && !matchesSearch(question, term)) return false;
    if (tags.length) {
      const owned = new Set(question.tags ?? []);
      if (tagMatch === "all") {
        if (!tags.every((tag) => owned.has(tag))) return false;
      } else if (!tags.some((tag) => owned.has(tag))) {
        return false;
      }
    }
    if (difficulty && !(question.difficulty && difficulty.has(question.difficulty))) return false;
    if (status && !status.has(question.status)) return false;
    if (sources && !sources.has(question.source)) return false;
    if (criteria.courseId && question.courseId !== criteria.courseId) return false;
    if (criteria.answered !== undefined && (question.attempts.length > 0) !== criteria.answered) return false;
    if (criteria.bookmarked && !question.marked) return false;
    if (criteria.incorrect && question.status !== "incorrect") return false;
    if (criteria.reviewDue) {
      const due = question.reviewDueAt ? Date.parse(question.reviewDueAt) : NaN;
      if (!Number.isFinite(due) || due > now) return false;
    }
    if (criteria.hasAttachment && !(question.attachments?.length)) return false;
    if (criteria.hasNotes && !question.notes?.trim()) return false;
    return true;
  });
}
