// ===========================================================================
// Analyses as they come back from storage, a backup or another device. This
// file imports nothing from the question model, so the question model can use
// it without a cycle.
//
// A malformed analysis is dropped whole. Keeping a reviewed statement while
// quietly dropping the citation it rested on would claim more than the source
// supports.
// ===========================================================================
import { ANALYSIS_LIMITS, type DistractorNote, type QuestionAnalysis, type SourceTrace } from "./types";

const ROLES = new Set<SourceTrace["role"]>(["question", "answer", "teaching", "slide"]);
const ORIGINS = new Set<QuestionAnalysis["origin"]>(["source", "ai"]);
const STATUSES = new Set<QuestionAnalysis["status"]>(["proposed", "reviewed", "rejected"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
};
const isoDate = (value: unknown): string | undefined => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined);
const pageNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined);

/** A list of short strings: empty entries go, repeats go, and it is cut at the limit. */
function shortList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kept = value.flatMap((entry) => {
    const item = text(entry, ANALYSIS_LIMITS.listItem);
    return item ? [item] : [];
  });
  return [...new Set(kept)].slice(0, ANALYSIS_LIMITS.listLength);
}

/** One whitespace-normalized excerpt, cut to what is kept. A cut excerpt is still verbatim. */
export function traceQuote(value: string): string | undefined {
  return text(value.replace(/\s+/g, " "), ANALYSIS_LIMITS.quote);
}

function trace(value: unknown): SourceTrace | undefined {
  if (!isRecord(value)) return undefined;
  const documentId = text(value.documentId, 250);
  const page = pageNumber(value.page);
  if (!documentId || !page || !ROLES.has(value.role as SourceTrace["role"])) return undefined;
  const quote = typeof value.quote === "string" ? traceQuote(value.quote) : undefined;
  return { documentId, page, role: value.role as SourceTrace["role"], ...(quote ? { quote } : {}) };
}

function distractor(value: unknown): DistractorNote | undefined {
  if (!isRecord(value)) return undefined;
  const key = text(value.key, 20)?.toUpperCase();
  const whyWrong = text(value.whyWrong, ANALYSIS_LIMITS.listItem * 2);
  if (!key || !whyWrong) return undefined;
  const wouldFitIf = text(value.wouldFitIf, ANALYSIS_LIMITS.listItem);
  return { key, whyWrong, ...(wouldFitIf ? { wouldFitIf } : {}) };
}

/** Every entry must be well formed, or the list as a whole is refused. */
function strictList<T>(value: unknown, parse: (entry: unknown) => T | undefined, limit: number): T[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const parsed = value.flatMap((entry) => {
    const item = parse(entry);
    return item ? [item] : [];
  });
  return parsed.length === value.length ? parsed : undefined;
}

export function normalizeQuestionAnalysis(value: unknown): QuestionAnalysis | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const id = text(value.id, 250);
  const questionId = text(value.questionId, 250);
  const sourceFingerprint = text(value.sourceFingerprint, 250);
  const concept = text(value.concept, ANALYSIS_LIMITS.concept);
  const generatedAt = isoDate(value.generatedAt);
  if (!id || !questionId || !sourceFingerprint || !concept || !generatedAt) return undefined;
  if (!ORIGINS.has(value.origin as QuestionAnalysis["origin"]) || !STATUSES.has(value.status as QuestionAnalysis["status"])) return undefined;
  const references = strictList(value.references, trace, ANALYSIS_LIMITS.references);
  const distractors = strictList(value.distractors, distractor, 12);
  if (!references || !distractors) return undefined;
  const task = text(value.task, ANALYSIS_LIMITS.task);
  const rule = text(value.rule, ANALYSIS_LIMITS.rule);
  const explanation = text(value.explanation, ANALYSIS_LIMITS.explanation);
  // An analysis that teaches nothing is not kept.
  if (!rule && !explanation && distractors.length === 0) return undefined;
  const lecture = text(value.lecture, ANALYSIS_LIMITS.lecture);
  const provider = text(value.provider, 120);
  const promptVersion = text(value.promptVersion, 120);
  return {
    id, questionId, sourceFingerprint, version: 1,
    origin: value.origin as QuestionAnalysis["origin"],
    status: value.status as QuestionAnalysis["status"],
    concept,
    ...(task ? { task } : {}),
    ...(rule ? { rule } : {}),
    ...(explanation ? { explanation } : {}),
    decisiveClues: shortList(value.decisiveClues),
    mechanism: shortList(value.mechanism),
    distractors,
    ...(lecture ? { lecture } : {}),
    references,
    ...(provider ? { provider } : {}),
    ...(promptVersion ? { promptVersion } : {}),
    generatedAt,
  };
}

/**
 * A question's analyses, one per id: reviewed ones first, then the newest, at
 * most a few. Undefined when there are none, so a question without teaching
 * stores nothing.
 */
export function normalizeQuestionAnalyses(value: unknown): QuestionAnalysis[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, QuestionAnalysis>();
  for (const entry of value) {
    const analysis = normalizeQuestionAnalysis(entry);
    // A later entry with the same id replaces an earlier one.
    if (analysis) byId.set(analysis.id, analysis);
  }
  const kept = [...byId.values()]
    // When there are too many, a reviewed analysis is the last to go.
    .sort((a, b) => Number(b.status === "reviewed") - Number(a.status === "reviewed")
      || Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
      || a.id.localeCompare(b.id))
    .slice(0, ANALYSIS_LIMITS.perQuestion);
  return kept.length ? kept : undefined;
}

/** Two copies of a question's analyses: both sides are kept, and the newer copy of an id wins. */
export function mergeQuestionAnalyses(older: unknown, newer: unknown): QuestionAnalysis[] | undefined {
  return normalizeQuestionAnalyses([...(Array.isArray(older) ? older : []), ...(Array.isArray(newer) ? newer : [])]);
}
