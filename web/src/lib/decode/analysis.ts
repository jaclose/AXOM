// ===========================================================================
// Reading and changing a question's analyses. Pure: a question and its source
// document go in, a value comes out. Nothing here touches the store.
// ===========================================================================
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import { normalizeQuestionAnalyses } from "./normalize";
import type { QuestionAnalysis } from "./types";

type SourceBearing = Pick<QuestionRecord,
  "id" | "stem" | "options" | "correctKey" | "explanation" | "choiceRationales" | "objective" | "sourceDocumentId" | "sourcePage" | "extraction" | "content" | "attachments">;
type PageSource = Pick<SourceDocument, "id" | "checksum" | "pageTexts">;

function hash(value: unknown): string {
  const json = JSON.stringify(value);
  let left = 2166136261;
  let right = 5381;
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right, 33) ^ code;
  }
  return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}:${json.length}`;
}

/** The pages a question's own provenance points at, in order, each once. */
export function questionSourcePages(question: Pick<QuestionRecord, "sourcePage" | "extraction">): number[] {
  const pages = [
    question.sourcePage,
    question.extraction?.questionSourcePage,
    question.extraction?.answerEvidencePage,
    question.extraction?.explanationSourcePage,
  ].filter((page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0);
  return [...new Set(pages)].sort((a, b) => a - b);
}

const QUESTION_VISUAL_ROLES = new Set(["question", "stem", "choice"]);

/**
 * Evidence identity, not a storage lookup key. A local asset ID / blobKey
 * can change when the SAME image is imported twice. Only a canonical
 * SHA-256 digest can distinguish source figures for recurrence estimates.
 * An unverified image is deliberately not counted as a second instance.
 * Metadata is retained separately by questionSourceFingerprint, which
 * must still make prior reviewed teaching stale on replacement.
 */
export function questionVisualIdentity(question: Pick<QuestionRecord, "content" | "attachments">): string {
  const sourceImages = (question.content?.assets ?? [])
    .filter((asset) => QUESTION_VISUAL_ROLES.has(asset.role));
  const boundIds = new Set((question.content?.assets ?? []).map((asset) => asset.id));
  const sourceBindings = new Set((question.attachments ?? [])
    .filter((attachment) => attachment.assetId
      && (attachment.role === "exhibit" || QUESTION_VISUAL_ROLES.has(attachment.role ?? "")))
    .map((attachment) => attachment.assetId));
  const unboundExhibits = (question.attachments ?? [])
    .filter((attachment) => (attachment.role === "exhibit" || QUESTION_VISUAL_ROLES.has(attachment.role ?? ""))
      && (!attachment.assetId || !boundIds.has(attachment.assetId)));
  if (!sourceImages.length && !unboundExhibits.length) return "text-only";
  // Unverified is one conservative identity, regardless of locally allocated
  // blob/asset keys, file names, byte counts or image render roles.
  if (!sourceImages.length || unboundExhibits.length
    || sourceImages.some((asset) => !sourceBindings.has(asset.id)
      || !/^sha256:[0-9a-f]{64}$/i.test(asset.checksum?.trim() ?? ""))) {
    return "unverified-figure";
  }
  // Crop is a semantic tuple. JSON serialization of the raw object changes
  // when equivalent fields arrive in a different property insertion order.
  // Identical image bytes in a different labeled answer choice represent a
  // different displayed question. Asset IDs and attachment blob keys cannot
  // express that: they are reallocated on import, while ordered source blocks
  // preserve the actual location the learner sees. Absent block placement
  // remains unknown, not an invented source location.
  const placements = new Map<string, Set<string>>();
  const record = (assetId: string, at: string) => {
    const existing = placements.get(assetId) ?? new Set<string>();
    existing.add(at);
    placements.set(assetId, existing);
  };
  const scan = (blocks: NonNullable<typeof question.content>["stem"], location: string) => {
    blocks.forEach((block, index) => {
      if (block.type === "image") record(block.assetId, `${location}:image:${index}`);
      if (block.type === "table" && block.sourceImageAssetId) {
        record(block.sourceImageAssetId, `${location}:table:${index}`);
      }
    });
  };
  scan(question.content?.stem ?? [], "stem");
  for (const choice of question.content?.choices ?? []) scan(choice.blocks, `choice:${choice.label}`);
  if (question.content?.choiceTable?.sourceImageAssetId) {
    record(question.content.choiceTable.sourceImageAssetId, "choice-table");
  }
  const verified = sourceImages.map((asset) => JSON.stringify([
    asset.checksum!.trim().toLowerCase(),
    asset.crop ? [asset.crop.left, asset.crop.top, asset.crop.right, asset.crop.bottom] : null,
    [...(placements.get(asset.id) ?? [])].sort(),
  ]));
  return JSON.stringify([...new Set(verified)].sort());
}

/**
 * Only source-linked exhibits/figures are source-bearing; adding an image
 * solely to the learner's personal notes must not revoke reviewed teaching.
 * This becomes part of the fingerprint only when real source media exists,
 * retaining existing fingerprints for text-only questions after upgrades.
 */
function sourceVisualRevision(question: SourceBearing): unknown[] | undefined {
  const content = question.content;
  const associated = (question.attachments ?? []).filter((attachment) => (
    Boolean(attachment.assetId) || Boolean(attachment.role)
  ));
  if (!content?.assets.length && associated.length === 0) return undefined;
  return [
    content ? [
      content.source,
      content.stem,
      content.choices,
      content.choiceTable,
      content.explanation,
      content.correctAnswer,
      content.assets,
    ] : null,
    associated.map((attachment) => [
      attachment.id, attachment.assetId, attachment.role, attachment.blobKey,
      attachment.mimeType, attachment.byteSize, attachment.width, attachment.height,
    ]),
  ];
}

/**
 * What an analysis was written about: the question's wording, its key, its
 * explanation, and the text of the pages it came from. Only source-bearing
 * content takes part, so an attempt, a tag, a note or a move to another week
 * never makes teaching stale. A corrected answer key or a re-imported source
 * does.
 */
export function questionSourceFingerprint(question: SourceBearing, document?: PageSource): string {
  const source = document && document.id === question.sourceDocumentId ? document : undefined;
  // Asked for on every render of a question's teaching. A question and a
  // document are replaced, never changed in place, so the pair is the key.
  const known = FINGERPRINTS.get(question);
  if (known && known.source === source) return known.value;
  const value = computeFingerprint(question, source);
  FINGERPRINTS.set(question, { source, value });
  return value;
}

const FINGERPRINTS = new WeakMap<object, { source: PageSource | undefined; value: string }>();

function computeFingerprint(question: SourceBearing, source: PageSource | undefined): string {
  const visualRevision = sourceVisualRevision(question);
  return hash([
    question.id,
    question.stem,
    question.options.map((option) => [option.key, option.text]),
    question.correctKey,
    question.explanation,
    question.choiceRationales,
    question.objective,
    question.sourceDocumentId,
    question.sourcePage,
    question.extraction?.questionSourceSnippet,
    question.extraction?.answerEvidenceSnippet,
    question.extraction?.answerEvidence,
    question.extraction?.explanationSourceSnippet,
    source?.checksum,
    questionSourcePages(question).map((page) => [page, source?.pageTexts?.[page - 1]]),
    ...(visualRevision === undefined ? [] : [visualRevision]),
  ]);
}

export function analysisIsCurrent(analysis: QuestionAnalysis, question: SourceBearing, document?: PageSource): boolean {
  return analysis.questionId === question.id && analysis.sourceFingerprint === questionSourceFingerprint(question, document);
}

/**
 * The analysis to teach from: reviewed, and written about the question as it
 * is now. The source's own teaching comes before a model's reading of it, and
 * a newer one before an older one. A proposal is never teaching.
 */
export function currentTeaching(
  question: SourceBearing & Pick<QuestionRecord, "analyses">,
  document?: PageSource,
): QuestionAnalysis | undefined {
  return (question.analyses ?? [])
    .filter((analysis) => analysis.status === "reviewed" && analysisIsCurrent(analysis, question, document))
    .sort((a, b) => Number(b.origin === "source") - Number(a.origin === "source") || Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
}

/** Proposals waiting for the learner, written about the question as it is now. */
export function pendingAnalyses(
  question: SourceBearing & Pick<QuestionRecord, "analyses">,
  document?: PageSource,
): QuestionAnalysis[] {
  return (question.analyses ?? []).filter((analysis) => analysis.status === "proposed" && analysisIsCurrent(analysis, question, document));
}

/** The pages an analysis cites, in order, each once. */
export function analysisPages(analysis: Pick<QuestionAnalysis, "references">): number[] {
  return [...new Set(analysis.references.map((reference) => reference.page))].sort((a, b) => a - b);
}

/**
 * A question's analyses with one added. A new proposal replaces the older
 * proposal from the same origin, so proposals do not pile up; what the learner
 * has reviewed or rejected is left as it is.
 */
export function withAnalysis(existing: readonly QuestionAnalysis[] | undefined, analysis: QuestionAnalysis): QuestionAnalysis[] | undefined {
  const kept = (existing ?? []).filter((entry) => (
    entry.id !== analysis.id && !(analysis.status === "proposed" && entry.status === "proposed" && entry.origin === analysis.origin)
  ));
  return normalizeQuestionAnalyses([...kept, analysis]);
}

/**
 * The learner's verdict on one analysis. Reviewing one retires the reviewed
 * analysis of the same origin that it replaces.
 */
export function withAnalysisStatus(
  existing: readonly QuestionAnalysis[] | undefined,
  analysisId: string,
  status: "reviewed" | "rejected",
): QuestionAnalysis[] | undefined {
  const target = (existing ?? []).find((entry) => entry.id === analysisId);
  if (!target) return existing ? [...existing] : undefined;
  return normalizeQuestionAnalyses((existing ?? []).flatMap((entry) => {
    if (entry.id === analysisId) return [{ ...entry, status }];
    return status === "reviewed" && entry.status === "reviewed" && entry.origin === target.origin ? [] : [entry];
  }));
}
