// ===========================================================================
// The one way reviewed questions are saved. The review screen and mass
// import's "Accept" both come through here, so a question accepted from the
// queue is checked, shaped, de-duplicated and written exactly as one finalized
// from the editor is.
//
// Two steps. `prepareReviewedImport` is pure: it refuses anything that is not
// ready, and otherwise returns the records to write. `saveReviewedImport`
// writes them once (reusing an identical earlier import instead of writing it
// again) and then attaches the images the questions name.
// ===========================================================================
import type { QuestionSet, SourceDocument } from "./library";
import type { ParsedQuestionDraft } from "./questionParse";
import {
  validateQuestionRecord,
  type ExtractionConfidence, type QuestionDifficulty, type QuestionExamType, type QuestionRecord, type QuestionSource,
} from "./questions";
import {
  findEquivalentReviewedSet,
  isReviewedImportInFlight,
  persistReviewedImportOnce,
  reviewedImportFingerprint,
  type ImportDocumentWrite,
  type QuestionImportPersistence,
  type ReviewedImportPersistencePlan,
  type ReviewedQuestionInput,
} from "./questionImportFinalization";
import type { ImportLibrary } from "./questionImportHistory";
import { attachNamedImages, matchNamedImages } from "./questionImportImages";
import { evaluateImportDrafts, type DraftImportEvaluation } from "./questionImportTrust";
import { normalizeTags, suggestCategory } from "./taxonomy";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "./localVault";

export type ImportDestination = "set" | "doc" | "both";

/** A question as it stands at the end of review. */
export interface ReviewedDraft extends ParsedQuestionDraft {
  source: QuestionSource;
  aiGenerated?: boolean;
  /** The learner has looked at a draft that still carries a review note, and accepts it. */
  reviewAcknowledged?: boolean;
}

/** The file the questions came from, when there is one. */
export interface ImportSourceFile {
  existingDocumentId?: string;
  title: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  rawText: string;
  pageTexts?: string[];
  checksum?: string;
}

export interface ReviewedImportRequest {
  /** Only the questions to save. */
  drafts: readonly ReviewedDraft[];
  destination: ImportDestination;
  document: ImportSourceFile | null;
  /** Where the questions came from when there is no file: pasted, or generated. */
  sourceType: QuestionSource;
  setTitle: string;
  /** Where the set sits in the course. */
  scope?: { module: string; week?: number };
  /** A category for every question that has none of its own. */
  category?: string;
  examType?: QuestionExamType;
  difficulty?: QuestionDifficulty;
  parserWarnings: readonly string[];
  /** The provider that generated the drafts marked as AI. */
  aiProviderLabel?: string;
}

export type ReviewedImportRefusal =
  | { ok: false; reason: "nothing-to-save" }
  /** Indexes into `request.drafts`: invalid, or needing review and not acknowledged. */
  | { ok: false; reason: "review-incomplete"; blocked: number[] }
  | { ok: false; reason: "invalid-question"; errors: string[] };

export interface PreparedReviewedImport {
  ok: true;
  fingerprint: string;
  plan: ReviewedImportPersistencePlan;
  /** A set that already holds exactly these reviewed questions. Saving reuses it. */
  equivalent?: { setId: string; questionIds: string[] };
  wantsSet: boolean;
  wantsDoc: boolean;
  setTitle: string;
  /** The library's record of this file, when it already has one. */
  existingDocumentId?: string;
  /** The image names each question asks for, in question order. */
  attachmentNames: string[][];
}

const draftText = (draft: ReviewedDraft) => `${draft.stem} ${draft.options.map((option) => option.text).join(" ")} ${draft.explanation ?? ""}`;

function resolveCategory(draft: ReviewedDraft, batchCategory: string | undefined): string | undefined {
  if (draft.category) return draft.category;
  if (batchCategory) return batchCategory;
  const suggestion = suggestCategory(draftText(draft));
  return suggestion.autoAssign ? suggestion.category : undefined;
}

const extractionConfidence = (evaluation: DraftImportEvaluation): ExtractionConfidence => (
  evaluation.level === "High" ? "high" : "medium"
);

/** The drafts that cannot be saved yet: invalid, or needing review and not acknowledged. */
export function blockedDraftIndexes(drafts: readonly ReviewedDraft[]): number[] {
  const evaluations = evaluateImportDrafts(drafts);
  return drafts.flatMap((draft, index) => (
    !evaluations[index].isValid || (evaluations[index].level === "Needs Review" && !draft.reviewAcknowledged) ? [index] : []
  ));
}

export function prepareReviewedImport(
  request: ReviewedImportRequest,
  library: ImportLibrary,
  make: { id: () => string; now: () => string } = { id: () => crypto.randomUUID(), now: () => new Date().toISOString() },
): PreparedReviewedImport | ReviewedImportRefusal {
  const { drafts, document, destination } = request;
  const evaluations = evaluateImportDrafts(drafts);
  const wantsSet = destination !== "doc" && drafts.length > 0;
  const wantsDoc = destination !== "set" && document !== null;
  if (!wantsSet && !wantsDoc) return { ok: false, reason: "nothing-to-save" };

  if (wantsSet) {
    const blocked = blockedDraftIndexes(drafts);
    if (blocked.length > 0) return { ok: false, reason: "review-incomplete", blocked };
  }

  const duplicateDoc = document
    ? library.documents.find((entry) => entry.id === document.existingDocumentId)
      ?? (document.checksum ? library.documents.find((entry) => entry.checksum === document.checksum) : undefined)
    : undefined;
  const documentId = document ? (duplicateDoc?.id ?? (wantsDoc ? make.id() : undefined)) : undefined;
  const setId = wantsSet ? make.id() : undefined;
  const reviewedAt = make.now();
  const setTitle = request.setTitle.trim() || "Untitled set";
  const scope = request.scope?.module ? request.scope : undefined;

  const questions: ReviewedQuestionInput[] = drafts.map((draft, index) => ({
    id: make.id(),
    source: draft.source,
    stem: draft.stem,
    options: draft.options,
    correctKey: draft.correctKey,
    // Always derive this from the current edited option list at the boundary.
    correctAnswerText: draft.options.find((option) => option.key === draft.correctKey)?.text,
    explanation: draft.explanation,
    choiceRationales: draft.choiceRationales,
    needsReview: undefined,
    topic: draft.topic,
    system: draft.system,
    objective: draft.objective,
    category: resolveCategory(draft, request.category),
    bank: setTitle,
    // Stamped on each question as well as the set, so a question keeps its
    // place in the course when it is later drawn into another set.
    module: scope?.module,
    week: scope?.week,
    setId,
    sourceDocumentId: documentId,
    sourceFile: document ? {
      name: document.fileName,
      type: document.fileType,
      size: document.sizeBytes,
      addedAt: reviewedAt,
    } : undefined,
    questionNumber: draft.questionNumber,
    sourcePage: draft.sourcePage,
    examType: request.examType,
    difficulty: request.difficulty,
    citation: draft.reference !== undefined
      ? (draft.reference.trim() || undefined)
      : draft.sourceLabel ?? document?.fileName,
    tags: normalizeTags([...(draft.tags ?? []), ...suggestCategory(draftText(draft)).tags]),
    status: "unseen",
    ai: draft.aiGenerated ? { generated: true, provider: request.aiProviderLabel } : undefined,
    extraction: {
      confidence: extractionConfidence(evaluations[index]),
      reviewed: true,
      reviewedAt,
      questionDetectionConfidence: draft.questionDetectionConfidence,
      answerDetectionConfidence: draft.answerDetectionConfidence,
      explanationDetectionConfidence: draft.explanationDetectionConfidence,
      overallImportConfidence: draft.overallImportConfidence,
      warnings: draft.warnings,
      parserRuleIds: [...new Set([
        ...(draft.parserRuleIds ?? []),
        ...(draft.reviewAcknowledged ? ["import.user-reviewed"] : []),
      ])],
      sourceSnippet: draft.sourceSnippet,
      questionSourceSnippet: draft.questionSourceSnippet,
      questionSourcePage: draft.questionSourcePage,
      answerEvidence: draft.answerEvidence,
      answerEvidenceSnippet: draft.answerEvidenceSnippet,
      answerEvidencePage: draft.answerEvidencePage,
      explanationSourceSnippet: draft.explanationSourceSnippet,
      explanationSourcePage: draft.explanationSourcePage,
      explanationSource: draft.explanationSource,
      explanationRawCandidate: draft.explanationRawCandidate,
      explanationCleanupOperations: draft.explanationCleanupOperations,
    },
  }));

  if (wantsSet) {
    const errors = questions.flatMap((input, index) => {
      const result = validateQuestionRecord(input);
      return result.ok ? [] : result.errors.map((error) => `Question ${input.questionNumber ?? index + 1}: ${error}`);
    });
    if (errors.length > 0) return { ok: false, reason: "invalid-question", errors };
  }

  const fingerprint = reviewedImportFingerprint({
    title: setTitle,
    destination,
    sourceIdentity: document
      ? document.checksum
        ? `checksum:${document.checksum}`
        : `file:${document.fileName}:${document.fileType}:${document.sizeBytes}`
      : `source:${request.sourceType}`,
    candidates: wantsSet ? questions : [],
  });
  const equivalent = wantsSet && !isReviewedImportInFlight(fingerprint)
    ? findEquivalentReviewedSet({
        sets: library.questionSets,
        questions: library.questions,
        title: setTitle,
        sourceDocumentId: duplicateDoc?.id,
        candidates: questions,
      })
    : undefined;

  const questionSet: QuestionSet | undefined = wantsSet ? {
    id: setId!,
    title: setTitle,
    sourceDocumentIds: documentId ? [documentId] : [],
    createdAt: reviewedAt,
    questionIds: questions.map((question) => question.id),
    tags: request.category ? [request.category] : [],
    aiEnhanced: false,
    parserWarnings: [...request.parserWarnings],
    kind: "source",
    ...(scope ? { scope } : {}),
  } : undefined;

  let documentWrite: ImportDocumentWrite | undefined;
  if (document && duplicateDoc && (wantsDoc || Boolean(setId))) {
    documentWrite = {
      kind: "update",
      id: duplicateDoc.id,
      original: duplicateDoc,
      patch: {
        linkedQuestionSetIds: setId
          ? [...new Set([...duplicateDoc.linkedQuestionSetIds, setId])]
          : duplicateDoc.linkedQuestionSetIds,
        libraryOnly: duplicateDoc.libraryOnly && !setId,
      },
    };
  } else if (wantsDoc && document && documentId) {
    const created: SourceDocument = {
      id: documentId,
      title: document.title,
      fileName: document.fileName,
      fileType: document.fileType,
      uploadedAt: reviewedAt,
      rawText: document.rawText,
      pageTexts: document.pageTexts,
      sizeBytes: document.sizeBytes,
      checksum: document.checksum,
      tags: request.category ? [request.category] : [],
      linkedQuestionSetIds: setId ? [setId] : [],
      libraryOnly: !setId,
    };
    documentWrite = { kind: "create", document: created };
  }

  return {
    ok: true,
    fingerprint,
    plan: { questions: wantsSet ? questions : [], questionSet, documentWrite },
    equivalent: equivalent ? { setId: equivalent.set.id, questionIds: equivalent.questionIds } : undefined,
    wantsSet,
    wantsDoc,
    setTitle,
    existingDocumentId: duplicateDoc?.id,
    attachmentNames: drafts.map((draft) => draft.attachmentNames ?? []),
  };
}

export interface ReviewedImportStore extends QuestionImportPersistence {
  updateQuestion(id: string, patch: Partial<QuestionRecord>): unknown;
}

export type SavedReviewedImport =
  | { ok: false; message: string; rollbackFailures: string[] }
  | {
      ok: true;
      /** An identical earlier import was found and reused: nothing was written. */
      reused: boolean;
      /** Another caller was already writing this same import, and this one waited for it. */
      joined: boolean;
      setId?: string;
      documentId?: string;
      questionIds: string[];
      /** The file was already in the library, so its record was linked, not copied. */
      reusedDocument: boolean;
      images: { attached: number; missing: number; problems: string[] };
    };

export async function saveReviewedImport(
  prepared: PreparedReviewedImport,
  store: ReviewedImportStore,
  images: readonly File[] = [],
): Promise<SavedReviewedImport> {
  const noImages = { attached: 0, missing: 0, problems: [] as string[] };
  if (prepared.equivalent) {
    return {
      ok: true, reused: true, joined: false,
      setId: prepared.equivalent.setId,
      documentId: prepared.wantsDoc ? prepared.existingDocumentId : undefined,
      questionIds: prepared.equivalent.questionIds,
      reusedDocument: Boolean(prepared.existingDocumentId),
      images: noImages,
    };
  }

  const coordinated = await persistReviewedImportOnce(prepared.fingerprint, store, prepared.plan);
  const persisted = coordinated.result;
  if (!persisted.ok) return persisted;

  // Named images: each file becomes its question's exhibit. A file that cannot
  // be saved is reported; it never undoes the import.
  const report = { ...noImages, problems: [] as string[] };
  if (persisted.questionSetId && !coordinated.joined && persisted.questionIds.length === prepared.attachmentNames.length) {
    for (const [index, names] of prepared.attachmentNames.entries()) {
      // Saved ids come back in the order the questions were given.
      const questionId = persisted.questionIds[index];
      if (!names.length || !questionId) continue;
      report.missing += matchNamedImages(names, images).filter((match) => !match.file).length;
      if (!images.length) continue;
      const result = await attachNamedImages({ names, files: images, questionId });
      if (result.attachments.length) {
        try {
          const checkpoint = getVaultWriteCheckpoint();
          await store.updateQuestion(questionId, { attachments: result.attachments });
          await flushLocalVaultWrites();
          assertVaultWritesSince(checkpoint);
          report.attached += result.attachments.length;
        } catch {
          report.problems.push(`Question ${index + 1}: its images could not be linked on this device. Keep the source files and export a backup before closing AXOM.`);
        }
      }
      report.problems.push(...result.problems);
    }
  }
  return {
    ok: true, reused: false, joined: coordinated.joined,
    setId: persisted.questionSetId,
    documentId: persisted.documentId,
    questionIds: persisted.questionIds,
    reusedDocument: Boolean(prepared.existingDocumentId),
    images: report,
  };
}
