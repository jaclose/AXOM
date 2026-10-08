// ===========================================================================
// Import Center (question-bank rehaul, layers 1–2). Upload PDF/DOCX/TXT/MD/
// CSV/JSON or paste text → extract → parse (stems, choices, answer keys,
// numbering, pages) → MANDATORY review screen with per-question editing →
// choose how to save: library document only, question set, or both — with
// optional review-gated AI enhancement (digest, pitfalls, review targets).
// Scanned PDFs with no text layer are stored as source records and say so
// honestly; no fake OCR.
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ClipboardPaste, FileUp, ImagePlus, Save, Sparkles,
  RefreshCw, ChevronDown, ChevronUp, Trash2, X,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { createImportMappingLedger, parseQuestionBlocks, type ParsedQuestionDraft } from "../../lib/questionParse";
import { detectImportFormat, importFromCsv, importFromJson, importFromText } from "../../lib/questionImport";
import { extractDocxText, extractPdfText, extractPlainText } from "../../lib/extractText";
import { proposePdfMarkedAnswers } from "../../lib/pdfMarkedAnswers";
import { attachPdfFigures } from "../../lib/pdfFigures";
import { parsePdfQuestions } from "../../lib/pdfQuestionImport";
import { documentTitleFromFile, type SourceDocument } from "../../lib/library";
import {
  EXAM_TYPE_LABEL, QUESTION_CATEGORIES,
  type QuestionDifficulty, type QuestionExamType, type QuestionRecord, type QuestionSource,
} from "../../lib/questions";
import {
  checkProviderHealth, cleanExplanation as cleanExplanationWithAi, enhanceQuestionSet,
  generateQuestionDrafts, loadAiSettings, mapAnswerFromText, resolveActiveProvider,
} from "../../lib/ai";
import { hashGenerationInput, saveAiGeneration } from "../../lib/aiGenerations";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { Field, SelectField, TextAreaField } from "../ui/Modal";
import { MAPPING_STATUS_LABEL, inferSourceMapping } from "../../lib/course-engine/sourceMapping";
import { moduleAliases } from "../../lib/course-engine/templateParse";
import { vocabularyFromCourses } from "../../lib/course-engine/vocabulary";
import { pushToast } from "../../lib/toast";
import { sha256Hex } from "../../lib/checksum";
import { assignDraftProvenancePages } from "../../lib/questionProvenance";
import { evaluateImportDraft, evaluateImportDrafts, summarizeImportDrafts } from "../../lib/questionImportTrust";
import { ALREADY_IMPORTED_RULE, applyPriorImport } from "../../lib/questionImportHistory";
import { hasReviewedImportInFlight } from "../../lib/questionImportFinalization";
import { prepareReviewedImport, saveReviewedImport, type ImportSourceFile } from "../../lib/questionImportSave";
import { scopeFromMapping } from "../../lib/massImportCandidate";
import { courseForScope } from "../../lib/course-engine/questionBank";
import { ICON_SIZE } from "../../lib/iconSize";
import { MassImport } from "./MassImport";
import { flagImportDuplicates } from "../../lib/questionDuplicates";
import { imageNameKey, matchNamedImages, namedImages } from "../../lib/questionImportImages";

export type ImportTab = "paste" | "file" | "batch" | "ai";
type SaveMode = "set" | "doc" | "both";
type ImportStep = "source" | "review" | "finalize";

interface ReviewDraft extends ParsedQuestionDraft {
  reviewId: string;
  include: boolean;
  aiGenerated?: boolean;
  expanded?: boolean;
  source: QuestionSource;
  /** Explicit acknowledgement for valid drafts whose extraction still needs review. */
  reviewAcknowledged?: boolean;
}

type PendingDocument = ImportSourceFile;

const EXAM_TYPES = Object.keys(EXAM_TYPE_LABEL) as QuestionExamType[];
const uid = () => crypto.randomUUID();

/** Seed the Import Center from elsewhere: a reference doc (AI tab) or a set of
 * already-parsed drafts to review (Mass Import "Inspect"). */
export interface ImportSeed {
  reference?: { title: string; text: string };
  drafts?: ParsedQuestionDraft[];
  rawText?: string;
  fileName?: string;
  title?: string;
  sourceDocumentId?: string;
  fileType?: string;
  sizeBytes?: number;
  pageTexts?: string[];
  checksum?: string;
  warnings?: string[];
  /** Figures already cut from the file, named as the drafts name them. */
  images?: File[];
  source?: QuestionSource;
  /** Internal queue identity used to retire one multi-file row after success. */
  batchQueueId?: string;
}

export interface ImportFinalizationResult {
  setId?: string;
  documentId?: string;
  questionIds: string[];
}

/** Re-open a saved source with the deterministic local parser; no provider is required. */
export function parseStoredDocument(document: SourceDocument): { drafts: ParsedQuestionDraft[]; warnings: string[] } {
  const kind = document.fileType.toLowerCase();
  // A PDF is read again the way it was read at import, so a slide deck comes
  // back as the same questions and not as running text.
  if (kind === "pdf" && document.pageTexts?.length) {
    const read = parsePdfQuestions(document.rawText, document.pageTexts);
    return { drafts: read.drafts, warnings: read.notes };
  }
  const result = kind === "csv"
    ? importFromCsv(document.rawText)
    : kind === "json"
      ? importFromJson(document.rawText)
      : importFromText(document.rawText);
  if (document.pageTexts?.length) assignDraftProvenancePages(result.drafts, document.pageTexts);
  return result;
}

/** User-reviewed mappings outrank deterministic reparse output for the same source question. */
export function preserveUserReviewedMappings(
  drafts: readonly ParsedQuestionDraft[],
  existingQuestions: readonly QuestionRecord[],
  sourceDocumentId: string | undefined,
): ParsedQuestionDraft[] {
  if (!sourceDocumentId) return [...drafts];
  const confirmedByNumber = new Map(existingQuestions
    .filter((question) => (
      question.sourceDocumentId === sourceDocumentId
      && question.questionNumber !== undefined
      && Boolean(question.correctKey)
      && question.extraction?.parserRuleIds?.includes("answer.user-reviewed-mapping")
    ))
    .map((question) => [question.questionNumber!, question]));
  return drafts.map((draft) => {
    const confirmed = draft.questionNumber === undefined ? undefined : confirmedByNumber.get(draft.questionNumber);
    if (!confirmed?.correctKey) return draft;
    if (!draft.options.some((option) => option.key === confirmed.correctKey)) {
      return {
        ...draft,
        correctKey: undefined,
        correctAnswerText: undefined,
        needsReview: true,
        answerDetectionConfidence: 0.05,
        parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "conflict.user-confirmed-mapping-vs-reparse"])],
        warnings: [
          ...draft.warnings,
          `User-confirmed answer ${confirmed.correctKey} is unavailable in the reparsed options — left unset for review.`,
        ],
      };
    }
    const optionKeys = draft.options.map((option) => option.key);
    const hasDuplicateOptionKeys = new Set(optionKeys).size !== optionKeys.length;
    const hasNonSequentialOptionKeys = !hasDuplicateOptionKeys
      && optionKeys.some((key, index) => key !== String.fromCharCode(65 + index));
    const hasNonAnswerReviewGate = (
      (draft.questionDetectionConfidence !== undefined && draft.questionDetectionConfidence < 0.75)
      || hasDuplicateOptionKeys
      || hasNonSequentialOptionKeys
      || (draft.parserRuleIds ?? []).some((ruleId) => (
        ruleId === "question.malformed-boundary"
        || ruleId === "question.ambiguous-explanation-boundary"
        || ruleId === "conflict.duplicate-question-number"
      ))
    );
    const hasSupersededAnswerReviewGate = (draft.parserRuleIds ?? []).some((ruleId) => (
      ruleId === "answer.explicit-letter-text-drift"
      || ruleId === "conflict.answer-letter-vs-text"
      || ruleId === "conflict.explicit-answer"
      || ruleId === "conflict.answer-vs-explanation"
      || ruleId === "conflict.answer-vs-rationale"
      || ruleId === "conflict.inferred-answer"
      || ruleId === "ambiguous.answer-text"
      || ruleId === "answer.text-no-option-match"
    ));
    const stillNeedsReview = hasNonAnswerReviewGate
      || (Boolean(draft.needsReview) && !hasSupersededAnswerReviewGate);
    return {
      ...draft,
      correctKey: confirmed.correctKey,
      correctAnswerText: draft.options.find((option) => option.key === confirmed.correctKey)?.text,
      needsReview: stillNeedsReview || undefined,
      answerDetectionConfidence: 1,
      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "answer.user-reviewed-mapping"])],
      warnings: [
        ...draft.warnings,
        `Preserved user-confirmed answer ${confirmed.correctKey} over re-imported parser output.`,
      ],
    };
  });
}

export function ImportPanel({
  seed,
  initialTab = "file",
  onFinalized,
}: {
  seed?: ImportSeed | null;
  initialTab?: ImportTab;
  onFinalized?: (result: ImportFinalizationResult) => void;
}) {
  const s = useStore();
  const [tab, setTab] = useState<ImportTab>(seed?.reference ? "ai" : initialTab);
  const [step, setStep] = useState<ImportStep>(seed?.drafts ? "review" : "source");
  const library = () => ({ questions: s.questions ?? [], questionSets: s.questionSets ?? [], documents: s.documents ?? [] });
  // What an earlier import brought in is only read from settled state: while a
  // save is still being written, the store may hold records that get rolled back.
  const settledLibrary = () => (hasReviewedImportInFlight() ? { questions: [], questionSets: [], documents: [] } : library());
  // Read once: what the seed's file already brought in, if it was imported before.
  const [seeded] = useState(() => (seed?.drafts
    ? applyPriorImport(
        flagImportDuplicates(preserveUserReviewedMappings(seed.drafts, s.questions ?? [], seed.sourceDocumentId), s.questions ?? []),
        seed.rawText != null ? { checksum: seed.checksum, fileName: seed.fileName ?? "import", existingDocumentId: seed.sourceDocumentId } : null,
        settledLibrary(),
      )
    : undefined));
  const [drafts, setDrafts] = useState<ReviewDraft[]>(() => (seeded
    ? seeded.drafts.map((d, index) => ({ ...d, reviewId: uid(), include: seeded.selected[index], source: seed?.source ?? "imported" }))
    : []));
  const [sourceText, setSourceText] = useState(seed?.rawText ?? "");
  const [sourceType, setSourceType] = useState<QuestionSource>(seed?.source ?? "pasted");
  const [batchWarnings, setBatchWarnings] = useState<string[]>(() => [...(seeded?.note ? [seeded.note] : []), ...(seed?.warnings ?? [])]);
  const [pendingDoc, setPendingDoc] = useState<PendingDocument | null>(() =>
    seed?.drafts && seed.rawText != null
      ? {
          existingDocumentId: seed.sourceDocumentId,
          title: seed.title ?? "Imported",
          fileName: seed.fileName ?? "import",
          fileType: seed.fileType ?? "imported",
          sizeBytes: seed.sizeBytes ?? seed.rawText.length,
          rawText: seed.rawText,
          pageTexts: seed.pageTexts,
          checksum: seed.checksum,
        }
      : null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  // Save options (§save modes): radio for destination, checkbox for AI.
  const [saveMode, setSaveMode] = useState<SaveMode>(() =>
    seed?.drafts ? (seed.drafts.length > 0 ? "both" : "doc") : "both");
  const [aiEnhance, setAiEnhance] = useState(false);
  const [setTitle, setSetTitle] = useState(seed?.title ?? "");
  // Where the set sits in the course. AXOM proposes it from the file's name;
  // once the learner changes either field, their choice stands.
  const [scopeModule, setScopeModule] = useState("");
  const [scopeWeek, setScopeWeek] = useState("");
  const [scopeEdited, setScopeEdited] = useState(false);
  const [category, setCategory] = useState("");
  const [examType, setExamType] = useState<QuestionExamType | "">("");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "">("");
  const [aiBusyDraft, setAiBusyDraft] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [activeBatchQueueId, setActiveBatchQueueId] = useState<string | undefined>(seed?.batchQueueId);
  const [finalizedBatchQueueId, setFinalizedBatchQueueId] = useState<string | undefined>();
  const finalizingRef = useRef(false);
  const mountedRef = useRef(true);
  // Image files the learner adds for questions that name one ("Attachment: ecg.png").
  const [imageFiles, setImageFiles] = useState<File[]>(() => seed?.images ?? []);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const provider = useMemo(() => resolveActiveProvider(), []);
  const reviewing = step === "review" || step === "finalize";

  const courseModules = useMemo(
    () => [...new Set((s.courses ?? []).flatMap((course) => course.modules.map((module) => module.name)))],
    [s.courses],
  );
  const proposedScope = useMemo(() => {
    const name = pendingDoc?.fileName ?? "";
    if (!name) return undefined;
    return inferSourceMapping(name, vocabularyFromCourses(s.terms ?? [], s.courses ?? [], moduleAliases));
  }, [pendingDoc?.fileName, s.courses, s.terms]);
  useEffect(() => {
    if (scopeEdited || !proposedScope) return;
    // The name is matched against the learner's own modules, so the proposal
    // is always one of the choices in the list.
    const proposed = scopeFromMapping(proposedScope, courseModules);
    setScopeModule(proposed?.module ?? "");
    setScopeWeek(proposed?.week ? String(proposed.week) : "");
  }, [courseModules, proposedScope, scopeEdited]);

  function reset(preserveFinalizedGuard = false) {
    setDrafts([]);
    setBatchWarnings([]);
    setPendingDoc(null);
    setSourceText("");
    setSourceType("pasted");
    setActiveBatchQueueId(undefined);
    setSetTitle("");
    setSaveMode("both");
    setAiEnhance(false);
    setStep("source");
    if (!preserveFinalizedGuard) finalizingRef.current = false;
    setFinalizing(false);
  }

  function loadDrafts(parsed: ParsedQuestionDraft[], warnings: string[], source: QuestionSource, doc: PendingDocument | null, ai = false, images: File[] = []) {
    finalizingRef.current = false;
    setFinalizing(false);
    // Figures cut from a PDF arrive with its questions and go through the same
    // path as images the learner adds by hand.
    if (images.length) setImageFiles(images);
    // A file imported before comes in with what it already brought left unselected.
    const known = applyPriorImport(flagImportDuplicates(parsed, s.questions ?? []), doc, settledLibrary());
    setDrafts(known.drafts.map((d, index) => ({ ...d, reviewId: uid(), include: known.selected[index], aiGenerated: ai, source })));
    setBatchWarnings(known.note ? [known.note, ...warnings] : warnings);
    setPendingDoc(doc);
    setSourceType(source);
    if (doc) setSourceText(doc.rawText);
    setSetTitle(doc?.title ?? (ai ? "AI-generated set" : `Pasted set ${new Date().toISOString().slice(0, 10)}`));
    setSaveMode(doc ? (parsed.length > 0 ? "both" : "doc") : "set");
    setStep("review");
  }

  function finishSuccessfulImport(result: ImportFinalizationResult) {
    if (!mountedRef.current) return;
    const continueBatch = Boolean(activeBatchQueueId);
    if (continueBatch) {
      setFinalizedBatchQueueId(activeBatchQueueId);
      setActiveBatchQueueId(undefined);
    }
    reset(true);
    if (continueBatch) {
      setTab("batch");
      return;
    }
    try {
      onFinalized?.(result);
    } catch {
      pushToast({ title: "Import finalized", body: "The reviewed questions were saved, but AXOM could not open the destination automatically.", tone: "warn" });
    }
  }

  async function saveApproved(modeOverride: SaveMode = saveMode) {
    if (finalizingRef.current) return;

    const approved = drafts.filter((draft) => draft.include);
    const week = Number(scopeWeek);
    // Checked, shaped and written by lib/questionImportSave: the same path
    // mass import's "Accept" takes.
    const prepared = prepareReviewedImport({
      drafts: approved,
      destination: modeOverride,
      document: pendingDoc,
      sourceType,
      setTitle,
      scope: scopeModule
        ? { module: scopeModule, courseId: courseForScope({ module: scopeModule }, s.courses)?.id,
            ...(Number.isInteger(week) && week > 0 && week < 100 ? { week } : {}) }
        : undefined,
      category: category || undefined,
      examType: examType || undefined,
      difficulty: difficulty || undefined,
      parserWarnings: batchWarnings,
      aiProviderLabel: provider?.info.label,
    }, library());

    if (!prepared.ok) {
      if (prepared.reason === "nothing-to-save") {
        pushToast({ title: "Nothing to finalize", body: "Include at least one valid question, or keep the source document for later review.", tone: "warn" });
      } else if (prepared.reason === "review-incomplete") {
        const blockedDrafts = new Set(prepared.blocked.map((index) => approved[index]));
        setDrafts((all) => all.map((draft) => blockedDrafts.has(draft) ? { ...draft, expanded: true } : draft));
        pushToast({
          title: "Review is not complete",
          body: `${prepared.blocked.length} included question${prepared.blocked.length === 1 ? " needs" : "s need"} correction or explicit review before finalization.`,
          tone: "warn",
        });
      } else {
        pushToast({ title: "Finalization blocked", body: prepared.errors.slice(0, 2).join(" "), tone: "warn" });
      }
      return;
    }

    finalizingRef.current = true;
    if (prepared.equivalent) {
      pushToast({
        title: "Import already finalized",
        body: "AXOM found the same reviewed questions and reused the existing set instead of creating duplicates.",
        tone: "success",
      });
    } else {
      setFinalizing(true);
      setStep("finalize");
    }
    const saved = await saveReviewedImport(prepared, s, imageFiles);
    if (!saved.ok) {
      if (!mountedRef.current) return;
      finalizingRef.current = false;
      setFinalizing(false);
      setStep("review");
      pushToast({
        title: saved.rollbackFailures.length
          ? "Finalization failed — cleanup incomplete"
          : "Nothing was finalized",
        body: saved.rollbackFailures.length
          ? `${saved.message} AXOM could not confirm cleanup for ${saved.rollbackFailures.join(", ")}. Review the Question Bank and Source Library before retrying.`
          : saved.message,
        tone: "warn",
      });
      return;
    }
    if (saved.reused) {
      finishSuccessfulImport({ setId: saved.setId, documentId: saved.documentId, questionIds: saved.questionIds });
      return;
    }

    const questionIds = saved.questionIds;
    const savedSetId = saved.setId;
    const savedDocumentId = saved.documentId;
    const { attached: attachedImages, missing: missingImages, problems: imageProblems } = saved.images;
    if (mountedRef.current && (attachedImages || missingImages || imageProblems.length)) {
      pushToast({
        title: attachedImages ? `${attachedImages} image${attachedImages === 1 ? "" : "s"} attached to ${attachedImages === 1 ? "its question" : "their questions"}` : "Images still to add",
        body: [
          missingImages ? `${missingImages} named image${missingImages === 1 ? " was" : "s were"} not added. Open the question and add the image there.` : "",
          ...imageProblems.slice(0, 2),
        ].filter(Boolean).join(" ") || undefined,
        tone: imageProblems.length || (missingImages && !attachedImages) ? "warn" : "success",
        duration: 8000,
      });
    }
    if (mountedRef.current) pushToast({
      title: savedSetId
        ? `${questionIds.length} reviewed question${questionIds.length === 1 ? "" : "s"} finalized`
        : "Source document saved for later review",
      body: saved.reusedDocument
        ? "AXOM reused the existing source record and linked the new reviewed set."
        : savedSetId ? "The imported set is available in Question Sets and the Question Bank." : undefined,
      tone: "success",
    });

    // Optional AI enhancement — after save, clearly labeled, never blocking.
    if (aiEnhance && savedSetId && provider && !saved.joined) {
      const forDigest = approved.map((draft) => ({
        stem: draft.stem,
        correct: draft.options.find((option) => option.key === draft.correctKey)?.text,
        explanation: draft.explanation,
      }));
      enhanceQuestionSet(provider, { title: prepared.setTitle, questions: forDigest })
        .then((digest) => {
          s.updateQuestionSet(savedSetId, {
            aiEnhanced: true,
            digest: { ...digest, generatedBy: provider.info.label, generatedAt: new Date().toISOString() },
          });
          void saveAiGeneration({
            kind: "summary",
            title: `${prepared.setTitle} digest`,
            inputHash: hashGenerationInput({ kind: "question-set-digest", setId: savedSetId, questionIds }),
            sourceIds: [savedSetId, ...(savedDocumentId ? [savedDocumentId] : [])],
            model: provider.info.label,
            promptVersion: "question-set-digest-v1",
            content: digest,
            metadata: { provider: provider.info.label, questionCount: questionIds.length },
          });
          if (mountedRef.current) pushToast({ title: "Question Intelligence ready", body: "The set's digest and pitfalls are on its card in Question Sets.", tone: "success" });
        })
        .catch((error) => {
          if (mountedRef.current) pushToast({ title: "AI enhancement failed", body: error instanceof Error ? error.message : "Unknown error.", tone: "warn" });
        });
    }

    finishSuccessfulImport({
      setId: savedSetId,
      documentId: prepared.wantsDoc ? savedDocumentId : undefined,
      questionIds,
    });
  }

  function updateDraft(index: number, patch: Partial<ReviewDraft>) {
    setDrafts((all) => all.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...patch } : draft
    )));
  }

  function editDraft(
    index: number,
    patch: Partial<ReviewDraft>,
    resolvedRules: readonly string[] = [],
  ) {
    setDrafts((all) => all.map((draft, draftIndex) => {
      if (draftIndex !== index) return draft;
      return {
        ...draft,
        ...patch,
        parserRuleIds: resolvedRules.length
          ? (draft.parserRuleIds ?? []).filter((rule) => !resolvedRules.includes(rule))
          : draft.parserRuleIds,
      };
    }));
  }

  function acknowledgeDraftReview(index: number) {
    updateDraft(index, { needsReview: undefined, reviewAcknowledged: true });
  }

  function confirmDraftBoundary(index: number) {
    setDrafts((all) => all.map((draft, draftIndex) => draftIndex === index ? {
      ...draft,
      needsReview: undefined,
      reviewAcknowledged: false,
      parserRuleIds: [
        ...(draft.parserRuleIds ?? []).filter((rule) => (
          rule !== "question.malformed-boundary"
          && rule !== "question.ambiguous-explanation-boundary"
          && rule !== "question.ambiguous-numbered-stem-list"
        )),
        "question.user-reviewed-boundary",
      ],
    } : draft));
  }

  function focusAfterReviewUpdate(...elementIds: Array<string | undefined>) {
    const restore = () => {
      for (const id of elementIds) {
        if (!id) continue;
        const element = document.getElementById(id);
        if (element instanceof HTMLElement) {
          element.focus();
          return;
        }
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    else setTimeout(restore, 0);
  }

  function removeDraft(index: number) {
    const focusDraft = drafts[index + 1] ?? drafts[index - 1];
    setDrafts((all) => all.filter((_, draftIndex) => draftIndex !== index));
    focusAfterReviewUpdate(
      focusDraft ? `import-draft-toggle-${focusDraft.reviewId}` : undefined,
      "import-discard-button",
    );
  }

  function updateOptionKey(index: number, draft: ReviewDraft, optionIndex: number, rawKey: string) {
    const key = rawKey.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase();
    const previousKey = draft.options[optionIndex]?.key;
    const options = draft.options.map((option, currentIndex) => (
      currentIndex === optionIndex ? { ...option, key } : option
    ));
    const keyIsNowAmbiguous = Boolean(key)
      && options.filter((option) => option.key.trim().toUpperCase() === key).length > 1;
    const collisionTouchesAnswer = keyIsNowAmbiguous
      && (draft.correctKey === previousKey || draft.correctKey === key);
    // A clean rename follows the selected option. Once a collision makes that
    // identity ambiguous, clear the mapping and require an explicit reselection;
    // later label edits must never silently retarget the answer to another row.
    const correctKey = collisionTouchesAnswer
      ? undefined
      : draft.correctKey === previousKey ? (key || undefined) : draft.correctKey;
    editDraft(index, {
      options,
      correctKey,
      correctAnswerText: correctKey ? options.find((option) => option.key === correctKey)?.text : undefined,
    });
  }

  function updateOptionText(index: number, draft: ReviewDraft, optionIndex: number, text: string) {
    const options = draft.options.map((option, currentIndex) => (
      currentIndex === optionIndex ? { ...option, text } : option
    ));
    editDraft(index, {
      options,
      correctAnswerText: draft.correctKey
        ? options.find((option) => option.key === draft.correctKey)?.text
        : undefined,
    });
  }

  function moveOption(index: number, draft: ReviewDraft, optionIndex: number, direction: -1 | 1) {
    const targetIndex = optionIndex + direction;
    if (targetIndex < 0 || targetIndex >= draft.options.length) return;
    const options = [...draft.options];
    [options[optionIndex], options[targetIndex]] = [options[targetIndex], options[optionIndex]];
    editDraft(index, {
      options,
      correctAnswerText: draft.correctKey
        ? options.find((option) => option.key === draft.correctKey)?.text
        : undefined,
    });
    focusAfterReviewUpdate(`import-option-text-${draft.reviewId}-${targetIndex}`);
  }

  function removeOption(index: number, draft: ReviewDraft, optionIndex: number) {
    const removedKey = draft.options[optionIndex]?.key;
    const options = draft.options.filter((_, currentIndex) => currentIndex !== optionIndex);
    const correctKey = draft.correctKey === removedKey ? undefined : draft.correctKey;
    editDraft(index, {
      options,
      correctKey,
      correctAnswerText: correctKey ? options.find((option) => option.key === correctKey)?.text : undefined,
    });
    const nextOptionIndex = options.length ? Math.min(optionIndex, options.length - 1) : undefined;
    focusAfterReviewUpdate(
      nextOptionIndex !== undefined ? `import-option-text-${draft.reviewId}-${nextOptionIndex}` : undefined,
      `import-add-option-${draft.reviewId}`,
    );
  }

  function addOption(index: number, draft: ReviewDraft) {
    const used = new Set(draft.options.map((option) => option.key.trim().toUpperCase()));
    const key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((candidate) => !used.has(candidate)) ?? "";
    editDraft(index, { options: [...draft.options, { key, text: "" }] });
  }

  /** Put an image the import could not place on the question the learner picks. */
  function attachImage(name: string, reviewId: string) {
    if (!reviewId) return;
    setDrafts((all) => all.map((draft) => (draft.reviewId === reviewId
      ? { ...draft, attachmentNames: [...new Set([...(draft.attachmentNames ?? []), name])] }
      : draft)));
  }

  /** Take an image off every question that names it. It stays in the import, unplaced. */
  function detachImage(name: string) {
    const key = imageNameKey(name);
    setDrafts((all) => all.map((draft) => ((draft.attachmentNames ?? []).some((entry) => imageNameKey(entry) === key)
      ? { ...draft, attachmentNames: draft.attachmentNames!.filter((entry) => imageNameKey(entry) !== key) }
      : draft)));
  }

  function returnToSource() {
    setStep("source");
    if (tab === "batch") {
      focusAfterReviewUpdate(activeBatchQueueId ? `mass-import-inspect-${activeBatchQueueId}` : undefined);
    } else {
      setTab("paste");
      focusAfterReviewUpdate("import-source-text");
    }
  }

  function confirmDraftAnswer(index: number, draft: ReviewDraft, key: string | undefined) {
    const answerScore = key ? 1 : 0;
    const overall = (draft.questionDetectionConfidence ?? 0) * 0.4
      + answerScore * 0.4
      + (draft.explanationDetectionConfidence ?? 0) * 0.2;
    updateDraft(index, {
      correctKey: key,
      correctAnswerText: key ? draft.options.find((option) => option.key === key)?.text : undefined,
      answerDetectionConfidence: answerScore,
      overallImportConfidence: overall,
      needsReview: !key || (draft.questionDetectionConfidence ?? 0) < 0.75 || undefined,
      confidence: overall >= 0.85 && key ? "high" : overall >= 0.6 ? "medium" : "low",
      parserRuleIds: key
        ? [...new Set([...(draft.parserRuleIds ?? []), "answer.user-reviewed-mapping"])]
        : draft.parserRuleIds,
      reviewAcknowledged: false,
    });
  }

  async function assistDraftMapping(index: number) {
    const draft = drafts[index];
    if (!provider || !draft || !sourceText) return;
    setAiBusyDraft(index);
    try {
      const result = await mapAnswerFromText(provider, {
        stem: draft.stem,
        options: draft.options,
        nearbyText: draft.sourceSnippet ?? sourceText.slice(0, 4000),
      });
      updateDraft(index, {
        correctKey: result.suggestedKey,
        correctAnswerText: result.suggestedKey
          ? draft.options.find((option) => option.key === result.suggestedKey)?.text
          : undefined,
        answerEvidence: result.evidence,
        answerDetectionConfidence: result.confidence,
        overallImportConfidence: Math.min(0.84, Math.max(draft.overallImportConfidence ?? 0, result.confidence)),
        needsReview: result.needsReview || undefined,
        confidence: result.needsReview ? "low" : "medium",
        warnings: [
          ...draft.warnings,
          result.needsReview
            ? "AI mapping assist found no grounded answer — human review is still required."
            : `AI mapping suggestion ${result.suggestedKey} is grounded in the evidence shown below and still requires your approval.`,
        ],
        parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "ai.mapping-assist.reviewed-suggestion"])],
        reviewAcknowledged: false,
      });
    } catch (error) {
      pushToast({ title: "Mapping assist failed", body: error instanceof Error ? error.message : "Unknown error.", tone: "warn" });
    } finally {
      setAiBusyDraft(null);
    }
  }

  async function cleanDraftWithAi(index: number) {
    const draft = drafts[index];
    if (!provider || !draft?.explanation) return;
    setAiBusyDraft(index);
    try {
      const cleaned = await cleanExplanationWithAi(provider, {
        stem: draft.stem,
        correct: draft.correctAnswerText,
        rawExplanation: draft.explanation,
      });
      updateDraft(index, {
        explanation: cleaned,
        explanationDetectionConfidence: Math.max(draft.explanationDetectionConfidence ?? 0, 0.8),
        confidence: draft.confidence === "low" ? "low" : "medium",
        needsReview: true,
        warnings: [...draft.warnings, "AI cleaned this explanation without changing the mapped answer — review before acceptance."],
        parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "ai.explanation-cleaner.review-required"])],
        reviewAcknowledged: false,
      });
    } catch (error) {
      pushToast({ title: "Explanation cleaner failed", body: error instanceof Error ? error.message : "Unknown error.", tone: "warn" });
    } finally {
      setAiBusyDraft(null);
    }
  }

  const evaluations = useMemo(() => evaluateImportDrafts(drafts), [drafts]);
  const includedDrafts = useMemo(() => drafts.filter((draft) => draft.include), [drafts]);
  const includedEvaluations = useMemo(() => evaluateImportDrafts(includedDrafts), [includedDrafts]);
  const displayedEvaluations = useMemo(() => {
    const includedById = new Map(includedDrafts.map((draft, index) => (
      [draft.reviewId, includedEvaluations[index]]
    )));
    return drafts.map((draft, index) => (
      draft.include ? includedById.get(draft.reviewId) ?? evaluations[index] : evaluations[index]
    ));
  }, [drafts, evaluations, includedDrafts, includedEvaluations]);
  const includedCount = includedDrafts.length;
  const imageMatches = matchNamedImages(namedImages(includedDrafts), imageFiles);
  const matchedImageKeys = new Set(imageMatches.filter((match) => match.file).map((match) => imageNameKey(match.name)));
  const usedImages = new Set(imageMatches.map((match) => match.file).filter(Boolean));
  const unusedImages = imageFiles.filter((file) => !usedImages.has(file));
  const blockedCount = includedDrafts.filter((draft, index) => (
    !includedEvaluations[index]?.isValid
    || (includedEvaluations[index]?.level === "Needs Review" && !draft.reviewAcknowledged)
  )).length;
  const levelCounts = displayedEvaluations.reduce((counts, evaluation) => {
    counts[evaluation.level] += 1;
    return counts;
  }, { High: 0, "Needs Review": 0, Invalid: 0 });
  const importSummary = useMemo(() => summarizeImportDrafts(drafts), [drafts]);
  const developerLedger = useMemo(() => import.meta.env.DEV ? createImportMappingLedger(drafts) : [], [drafts]);
  const destinationMissing = saveMode === "doc"
    ? !pendingDoc
    : saveMode === "set"
      ? includedCount === 0
      : !pendingDoc || includedCount === 0;
  const finalizeDisabled = finalizing || destinationMissing || (saveMode !== "doc" && blockedCount > 0);
  const finalizeStatus = finalizing
    ? "Finalization is in progress."
    : !pendingDoc && saveMode !== "set"
      ? "Attach a source document or choose Questions before finalizing."
      : includedCount === 0 && saveMode !== "doc"
        ? "Include at least one question before finalizing."
        : saveMode !== "doc" && blockedCount > 0
          ? `${blockedCount} included question${blockedCount === 1 ? " still needs" : "s still need"} correction or explicit review before finalization.`
          : unusedImages.length > 0 && saveMode !== "doc"
            ? `The reviewed import is ready to finalize. ${unusedImages.length} image${unusedImages.length === 1 ? " is" : "s are"} not on any question and will be left out.`
            : "The reviewed import is ready to finalize.";

  return (
    <GlassCard className="question-import-flow">
      <PanelHeader
        title="Import questions"
        headingLevel={2}
        sub="Bring in structured text, inspect every consequential field, then finalize only valid reviewed questions."
      />

      <nav className="import-steps" aria-label="Question import progress">
        {(["source", "review", "finalize"] as ImportStep[]).map((item, index) => {
          const isCurrent = item === step;
          const isComplete = (item === "source" && reviewing) || (item === "review" && step === "finalize");
          return (
            <div key={item} className={`${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""}`}
              aria-current={isCurrent ? "step" : undefined}>
              <span>{isComplete ? <CheckCircle2 size={ICON_SIZE.microInline} /> : index + 1}</span>
              {item[0].toUpperCase() + item.slice(1)}
            </div>
          );
        })}
      </nav>

      {!reviewing && (
        <div className="stack gap12">
          <div className="row wrap gap6" aria-label="Import source type">
            {([
              ["paste", "Paste text"],
              ["file", "Import one file"],
              ["batch", "Import several files"],
              ["ai", "Generate with AI"],
            ] as Array<[ImportTab, string]>).map(([id, label]) => (
              <button key={id} className={`filter-pill ${tab === id ? "on" : ""}`}
                aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab === "paste" && (
            <PasteTab
              raw={sourceText}
              label={pendingDoc ? `Edit extracted source text from ${pendingDoc.fileName}` : undefined}
              onRawChange={setSourceText}
              parseSource={(raw) => {
                const format = pendingDoc?.fileType.toLowerCase();
                if (format === "pdf" && pendingDoc?.pageTexts?.length && raw === pendingDoc.rawText) {
                  const read = parsePdfQuestions(raw, pendingDoc.pageTexts);
                  return { drafts: read.drafts, warnings: read.notes };
                }
                const result = format === "csv"
                  ? importFromCsv(raw)
                  : format === "json"
                    ? importFromJson(raw)
                    : importFromText(raw);
                if (pendingDoc?.pageTexts?.length && raw === pendingDoc.rawText) {
                  assignDraftProvenancePages(result.drafts, pendingDoc.pageTexts);
                }
                return result;
              }}
              onParsed={(parsed, warnings, raw) => {
                const sourceEdited = Boolean(pendingDoc && raw !== pendingDoc.rawText);
                const reviewedDrafts = sourceEdited
                  ? parsed.map((draft) => ({
                      ...draft,
                      needsReview: true,
                      warnings: [
                        ...draft.warnings,
                        "The extracted source text was edited before parsing — verify this question against the original source.",
                      ],
                      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "import.source-text-edited"])],
                    }))
                  : parsed;
                loadDrafts(reviewedDrafts, warnings, pendingDoc ? sourceType : "pasted", pendingDoc);
                setSourceText(raw);
              }}
            />
          )}
          {tab === "file" && (
            <FileTab busyFile={busyFile} setBusyFile={setBusyFile} onParsed={loadDrafts} />
          )}
          {tab === "ai" && (
            <AiGenerateTab seedReference={seed?.reference} onParsed={(parsed, warnings) => loadDrafts(parsed, warnings, "ai-generated", null, true)} />
          )}
        </div>
      )}

      <div hidden={reviewing || tab !== "batch"}>
        <MassImport finalizedQueueId={finalizedBatchQueueId} onInspect={(payload) => {
          setActiveBatchQueueId(payload.batchQueueId);
          loadDrafts(
            payload.drafts ?? [],
            payload.warnings ?? [],
            payload.source ?? "imported",
            payload.rawText != null
              ? {
                  existingDocumentId: payload.sourceDocumentId,
                  title: payload.title ?? "Imported",
                  fileName: payload.fileName ?? "import",
                  fileType: payload.fileType ?? "imported",
                  sizeBytes: payload.sizeBytes ?? payload.rawText.length,
                  rawText: payload.rawText,
                  pageTexts: payload.pageTexts,
                  checksum: payload.checksum,
                }
              : null,
            false,
            payload.images ?? [],
          );
        }} />
      </div>

      {reviewing && (
        <div className="stack gap12" aria-live="polite">
          <div className="spread wrap gap8">
            <div className="stack" style={{ gap: 2 }}>
              <b>
                {drafts.length > 0
                  ? `Review ${drafts.length} parsed question${drafts.length === 1 ? "" : "s"}`
                  : "No questions were parsed"}
                {pendingDoc ? ` · ${pendingDoc.fileName}` : ""}
              </b>
              <span className="sub">
                {drafts.length > 0
                  ? "Expand a question to correct it. Invalid questions must be repaired or removed before finalization."
                  : "Keep this source for later review, or return to the source text and adjust it."}
              </span>
            </div>
            <div className="row wrap gap6">
              {sourceText && (
                <GhostButton disabled={finalizing} onClick={returnToSource}>
                  <ArrowLeft size={ICON_SIZE.body} /> Back to source
                </GhostButton>
              )}
              <GhostButton id="import-discard-button" disabled={finalizing} onClick={() => reset()}>Discard import</GhostButton>
              {pendingDoc && drafts.length > 0 && (
                <GhostButton disabled={finalizing} onClick={() => void saveApproved("doc")}>Keep source for later</GhostButton>
              )}
              <GButton id="import-finalize-button" variant="primary" disabled={finalizeDisabled}
                aria-describedby="import-finalize-status" onClick={() => void saveApproved()}>
                {finalizing ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <Save size={ICON_SIZE.body} />}
                {finalizing ? "Finalizing…" : "Finalize import"}
              </GButton>
            </div>
          </div>
          <div id="import-finalize-status" className="sub" aria-live="polite">{finalizeStatus}</div>

          {batchWarnings.length > 0 && (
            <ul className="intake-warnings">{batchWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          )}

          {drafts.length > 0 && (
            <section className="import-summary" aria-labelledby="import-summary-title">
              <div className="spread wrap gap8">
                <div>
                  <b id="import-summary-title">Review status</b>
                  <div className="sub">These levels are deterministic checks, not machine-learning certainty.</div>
                  {blockedCount > 0 && <div className="sub">{blockedCount} included question{blockedCount === 1 ? " is" : "s are"} blocking finalization.</div>}
                </div>
                <div className="row wrap gap6" aria-label="Import confidence counts">
                  <Tag tone="green">High {levelCounts.High}</Tag>
                  <Tag tone="orange">Needs Review {levelCounts["Needs Review"]}</Tag>
                  <Tag tone="red">Invalid {levelCounts.Invalid}</Tag>
                </div>
              </div>
              <div className="row wrap gap8 sub">
                <span>Explanations found <b>{importSummary.explanationsFound}</b></span>
                <span>Missing <b>{importSummary.explanationsMissing}</b></span>
                <span>Included <b>{includedCount}</b> of {drafts.length}</span>
              </div>
              <div className="row wrap gap6">
                <GhostButton onClick={() => setDrafts((all) => all.map((draft, index) => ({
                  ...draft, include: displayedEvaluations[index]?.level === "High",
                })))}>Select High ({levelCounts.High})</GhostButton>
                <GhostButton onClick={() => setDrafts((all) => all.map((draft, index) => ({
                  ...draft,
                  include: displayedEvaluations[index]?.level === "Needs Review",
                  expanded: displayedEvaluations[index]?.level === "Needs Review" || draft.expanded,
                })))}>Review flagged ({levelCounts["Needs Review"]})</GhostButton>
                <GhostButton onClick={() => setDrafts((all) => all.map((draft, index) => ({
                  ...draft,
                  include: displayedEvaluations[index]?.level === "Invalid",
                  expanded: displayedEvaluations[index]?.level === "Invalid" || draft.expanded,
                })))}>Repair invalid ({levelCounts.Invalid})</GhostButton>
                <GhostButton onClick={() => setDrafts((all) => all.map((draft) => ({ ...draft, include: true })))}>Include all</GhostButton>
              </div>
            </section>
          )}

          {(imageMatches.length > 0 || imageFiles.length > 0) && (
            <section className="import-images" aria-labelledby="import-images-title">
              <div className="spread wrap gap8">
                <div>
                  <b id="import-images-title">Images</b>
                  <div className="sub">
                    {imageMatches.length > 0
                      ? `${imageMatches.length} image${imageMatches.length === 1 ? " is" : "s are"} named by ${imageMatches.length === 1 ? "a question" : "these questions"}. Add the file${imageMatches.length === 1 ? "" : "s"} and each one is attached to its question by name, to show with the question.`
                      : "No question names an image yet. Attach one below to show it with its question."}
                  </div>
                </div>
                <GButton size="sm" onClick={() => imageInputRef.current?.click()}>
                  <ImagePlus size={ICON_SIZE.body} aria-hidden="true" /> {imageFiles.length ? "Add more images" : "Add images"}
                </GButton>
                <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
                  aria-label="Add image files for this import"
                  onChange={(event) => {
                    const picked = [...(event.target.files ?? [])];
                    event.target.value = "";
                    if (picked.length) setImageFiles((current) => [...current.filter((file) => !picked.some((next) => imageNameKey(next.name) === imageNameKey(file.name))), ...picked]);
                  }} />
              </div>
              {imageMatches.length > 0 && (
                <ul className="import-image-list" aria-label="Named images">
                  {imageMatches.map((match) => (
                    <li key={match.name} className={match.file ? "matched" : "missing"}>
                      {match.file ? <CheckCircle2 size={ICON_SIZE.microInline} aria-hidden="true" /> : <X size={ICON_SIZE.microInline} aria-hidden="true" />}
                      <span>{match.name}</span>
                      <small>{match.file ? (imageNameKey(match.file.name) === imageNameKey(match.name) ? "ready" : `using ${match.file.name}`) : "not added yet"}</small>
                      <button type="button" className="import-image-detach" aria-label={`Take ${match.name} off its question`} title="Take this image off its question"
                        onClick={() => detachImage(match.name)}>
                        <X size={ICON_SIZE.microInline} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {unusedImages.length > 0 && (
                <>
                  <div className="sub">Not named by any question, so left out: {unusedImages.map((file) => file.name).join(", ")}. To keep one, attach it to its question here.</div>
                  <ul className="import-image-list" aria-label="Images not on a question">
                    {unusedImages.map((file) => (
                      <li key={file.name} className="missing">
                        <span>{file.name}</span>
                        <select className="field week-move" aria-label={`Attach ${file.name} to a question`} value=""
                          onChange={(event) => attachImage(file.name, event.target.value)}>
                          <option value="">Attach to a question</option>
                          {drafts.map((draft, index) => (draft.include
                            ? <option key={draft.reviewId} value={draft.reviewId}>Question {draft.questionNumber ?? index + 1}{draft.sourcePage ? `, page ${draft.sourcePage}` : ""}</option>
                            : null))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <fieldset className="import-destination">
            <legend className="field-label">Finalize as</legend>
            <div className="row wrap gap6">
              {([
                ["set", "Questions"],
                ["doc", "Source document only"],
                ["both", "Source document + questions"],
              ] as Array<[SaveMode, string]>).map(([mode, label]) => {
                const disabled = (mode !== "set" && !pendingDoc) || (mode !== "doc" && drafts.length === 0);
                return (
                  <button key={mode} className={`filter-pill ${saveMode === mode ? "on" : ""}`}
                    aria-pressed={saveMode === mode} disabled={disabled}
                    title={disabled ? (pendingDoc ? "No questions were parsed" : "No source file is attached") : undefined}
                    onClick={() => setSaveMode(mode)}>{label}</button>
                );
              })}
              <label className="row" style={{ gap: 6, cursor: provider ? "pointer" : "not-allowed", opacity: provider ? 1 : 0.55 }}>
                <input type="checkbox" checked={aiEnhance} disabled={!provider || saveMode === "doc"}
                  onChange={() => setAiEnhance((value) => !value)} />
                <span className="sub">Optional AI digest after finalization{provider ? "" : " — enable a provider in Settings → AI"}</span>
              </label>
            </div>
          </fieldset>

          {saveMode !== "doc" && (
            <div className="grid grid-2">
              <Field label="Set title" value={setTitle} onChange={(event) => setSetTitle(event.target.value)} />
              {courseModules.length > 0 && (
                <>
                  <SelectField label="Module" value={scopeModule}
                    onChange={(event) => { setScopeEdited(true); setScopeModule(event.target.value); if (!event.target.value) setScopeWeek(""); }}>
                    <option value="">Not filed under a module</option>
                    {courseModules.map((name) => <option key={name} value={name}>{name}</option>)}
                  </SelectField>
                  <Field label="Week" type="number" inputMode="numeric" min={1} max={60} value={scopeWeek}
                    disabled={!scopeModule} placeholder={scopeModule ? "Optional" : "Choose a module first"}
                    onChange={(event) => { setScopeEdited(true); setScopeWeek(event.target.value); }} />
                  {!scopeEdited && proposedScope?.module && scopeModule && (
                    <p className="sub import-scope-note" role="status">
                      {MAPPING_STATUS_LABEL[proposedScope.status]}: {proposedScope.module.evidence.replace(/^file /, "the file name ")}.
                      {proposedScope.status !== "mapped" && " Check it before saving."}
                    </p>
                  )}
                </>
              )}
              <SelectField label="Category (applies to all)" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">None</option>
                {QUESTION_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </SelectField>
              <SelectField label="Exam style" value={examType} onChange={(event) => setExamType(event.target.value as QuestionExamType | "")}>
                <option value="">Not set</option>
                {EXAM_TYPES.map((item) => <option key={item} value={item}>{EXAM_TYPE_LABEL[item]}</option>)}
              </SelectField>
              <SelectField label="Difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as QuestionDifficulty | "")}>
                <option value="">Not set</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </SelectField>
            </div>
          )}

          <div className="stack gap6">
            {drafts.map((draft, index) => {
              const evaluation = displayedEvaluations[index] ?? evaluateImportDraft(draft);
              const editorId = `import-question-editor-${index}`;
              const reasonsId = `import-question-reasons-${index}`;
              const titleId = `import-question-title-${draft.reviewId}`;
              const tone = evaluation.level === "High" ? "green" : evaluation.level === "Needs Review" ? "orange" : "red";
              return (
                <section key={draft.reviewId} role="group" aria-labelledby={titleId}
                  className={`import-draft ${draft.include ? "" : "excluded"} ${evaluation.level.toLowerCase().replace(" ", "-")}`}>
                  <div className="row wrap gap8">
                    <input type="checkbox" checked={draft.include}
                      aria-label={`Include question ${draft.questionNumber ?? index + 1}`}
                      onChange={() => updateDraft(index, { include: !draft.include })} />
                    <button id={`import-draft-toggle-${draft.reviewId}`} className="grow stack card-row-main"
                      aria-expanded={Boolean(draft.expanded)} aria-controls={editorId}
                      onClick={() => updateDraft(index, { expanded: !draft.expanded })}>
                      <span id={titleId} className="truncate" style={{ fontWeight: 600 }}>
                        {draft.questionNumber !== undefined ? `${draft.questionNumber}. ` : ""}{draft.stem || "(no stem — correction required)"}
                      </span>
                      <span className="sub truncate">
                        {draft.options.length} choices{draft.correctKey ? ` · answer ${draft.correctKey}` : " · answer missing"}
                        {draft.explanation ? " · explanation present" : " · explanation missing"}
                        {draft.sourcePage ? ` · page ${draft.sourcePage}` : ""}
                        {(draft.attachmentNames?.length ?? 0) > 0 && ` · image ${draft.attachmentNames!.map((name) => (
                          `${name}${matchedImageKeys.has(imageNameKey(name)) ? "" : " (not added yet)"}`
                        )).join(", ")}`}
                      </span>
                    </button>
                    <Tag tone={tone}>{evaluation.level}</Tag>
                    {(draft.parserRuleIds ?? []).includes(ALREADY_IMPORTED_RULE) && <Tag tone="cyan">Already imported</Tag>}
                    {draft.reviewAcknowledged && <Tag tone="cyan">Reviewed</Tag>}
                    {draft.aiGenerated && <Tag tone="purple">AI</Tag>}
                    <GhostButton aria-label={`Remove question ${draft.questionNumber ?? index + 1}`}
                      title="Remove this malformed question" onClick={() => removeDraft(index)}>
                      <Trash2 size={ICON_SIZE.body} />
                    </GhostButton>
                    <GhostButton aria-label={`Toggle editor for question ${draft.questionNumber ?? index + 1}`}
                      aria-expanded={Boolean(draft.expanded)} aria-controls={editorId}
                      onClick={() => updateDraft(index, { expanded: !draft.expanded })}>
                      {draft.expanded ? <ChevronUp size={ICON_SIZE.body} /> : <ChevronDown size={ICON_SIZE.body} />}
                    </GhostButton>
                  </div>

                  {draft.expanded && (
                    <div id={editorId} className="stack gap10 import-draft-editor">
                      <div id={reasonsId} className={`import-review-result ${evaluation.level.toLowerCase().replace(" ", "-")}`} role="status">
                        <b>{evaluation.level}</b>
                        {evaluation.reasons.length > 0
                          ? <ul>{evaluation.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>
                          : <span>No blocking or ambiguous extraction signals remain.</span>}
                      </div>

                      {draft.warnings.length > 0 && (
                        <details className="question-import-diagnostics">
                          <summary>Parser notes ({draft.warnings.length})</summary>
                          <ul className="intake-warnings">{draft.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>
                        </details>
                      )}

                      <div className="grid grid-2 import-core-fields">
                        <Field label="Question number" type="number" min={1} step={1}
                          value={draft.questionNumber ?? ""}
                          aria-invalid={evaluation.reasons.some((reason) => reason.code === "invalid-question-number" || reason.code === "duplicate-question-number")}
                          aria-describedby={reasonsId}
                          onChange={(event) => editDraft(index, {
                            questionNumber: event.target.value ? Number(event.target.value) : undefined,
                          }, ["conflict.duplicate-question-number"])} />
                        <Field label="Reference / source" value={draft.reference ?? draft.sourceLabel ?? pendingDoc?.fileName ?? "Pasted text"}
                          onChange={(event) => editDraft(index, { reference: event.target.value })} />
                      </div>

                      <TextAreaField label="Stem" rows={4} value={draft.stem} aria-describedby={reasonsId}
                        aria-invalid={evaluation.reasons.some((reason) => reason.code === "missing-stem")}
                        onChange={(event) => editDraft(index, { stem: event.target.value })} />

                      <fieldset className="import-options" aria-describedby={reasonsId}>
                        <legend className="field-label">Answer choices</legend>
                        <div className="stack gap6">
                          {draft.options.map((option, optionIndex) => (
                            <div key={optionIndex} className="row gap6">
                              <input className="field import-option-label mono" value={option.key} maxLength={1}
                                aria-label={`Label for option ${optionIndex + 1}`}
                                aria-invalid={evaluation.reasons.some((reason) => reason.code === "duplicate-option-labels" || reason.code === "incomplete-option")}
                                onChange={(event) => updateOptionKey(index, draft, optionIndex, event.target.value)} />
                              <input id={`import-option-text-${draft.reviewId}-${optionIndex}`} className="field grow"
                                value={option.text} aria-label={`Option ${option.key || optionIndex + 1}`}
                                aria-invalid={!option.text.trim() || evaluation.reasons.some((reason) => reason.code === "explanation-detected-as-option")}
                                onChange={(event) => updateOptionText(index, draft, optionIndex, event.target.value)} />
                              <GhostButton aria-label={`Move option ${option.key || optionIndex + 1} up`}
                                disabled={optionIndex === 0}
                                onClick={() => moveOption(index, draft, optionIndex, -1)}>
                                <ChevronUp size={ICON_SIZE.body} />
                              </GhostButton>
                              <GhostButton aria-label={`Move option ${option.key || optionIndex + 1} down`}
                                disabled={optionIndex === draft.options.length - 1}
                                onClick={() => moveOption(index, draft, optionIndex, 1)}>
                                <ChevronDown size={ICON_SIZE.body} />
                              </GhostButton>
                              <GhostButton aria-label={`Remove option ${option.key || optionIndex + 1}`}
                                onClick={() => removeOption(index, draft, optionIndex)}><X size={ICON_SIZE.body} /></GhostButton>
                            </div>
                          ))}
                        </div>
                        <GhostButton id={`import-add-option-${draft.reviewId}`} onClick={() => addOption(index, draft)}>+ Add option</GhostButton>
                      </fieldset>

                      <div className="grid grid-2">
                        <SelectField label="Correct answer" value={draft.correctKey ?? ""} aria-describedby={reasonsId}
                          aria-invalid={evaluation.reasons.some((reason) => reason.code === "missing-correct-answer" || reason.code === "correct-answer-not-option")}
                          onChange={(event) => confirmDraftAnswer(index, draft, event.target.value || undefined)}>
                          <option value="">Not set</option>
                          {draft.options.map((option, optionIndex) => (
                            <option key={`${option.key}-${optionIndex}`} value={option.key}>{option.key || `Choice ${optionIndex + 1}`}</option>
                          ))}
                        </SelectField>
                        {draft.correctKey && evaluation.level !== "High" && (
                          <GhostButton onClick={() => confirmDraftAnswer(index, draft, draft.correctKey)}>
                            Confirm mapped answer {draft.correctKey}
                          </GhostButton>
                        )}
                        <Field label="Topic" value={draft.topic ?? ""} onChange={(event) => editDraft(index, { topic: event.target.value || undefined })} />
                        <Field label="Learning objective" value={draft.objective ?? ""} onChange={(event) => editDraft(index, { objective: event.target.value || undefined })} />
                      </div>

                      <TextAreaField label="Explanation or rationale" rows={4} value={draft.explanation ?? ""}
                        aria-describedby={reasonsId}
                        aria-invalid={evaluation.reasons.some((reason) => reason.code === "explanation-boundary-ambiguous")}
                        onChange={(event) => editDraft(index, {
                          explanation: event.target.value || undefined,
                          explanationSource: event.target.value ? (draft.explanationSource ?? "inline") : undefined,
                        }, ["explanation.ambiguous-boundary", "ai.explanation-cleaner.review-required"])} />

                      {evaluation.reasons.some((reason) => reason.code === "structurally-ambiguous-block") && (
                        <GhostButton onClick={() => confirmDraftBoundary(index)}>Confirm this is one complete question</GhostButton>
                      )}
                      {evaluation.level === "Needs Review"
                        && !draft.reviewAcknowledged
                        && !evaluation.reasons.some((reason) => (
                          reason.code === "answer-mapping-needs-review"
                          || reason.code === "unrecognized-answer-key"
                        )) && (
                        <GhostButton onClick={() => acknowledgeDraftReview(index)}>
                          Mark source review complete
                        </GhostButton>
                      )}

                      {provider && (
                        <div className="row wrap gap6">
                          {!draft.correctKey && sourceText && (
                            <GhostButton disabled={aiBusyDraft === index} onClick={() => void assistDraftMapping(index)}>
                              <Sparkles size={ICON_SIZE.body} /> {aiBusyDraft === index ? "Checking evidence…" : "Mapping assist"}
                            </GhostButton>
                          )}
                          {draft.explanation && (
                            <GhostButton disabled={aiBusyDraft === index} onClick={() => void cleanDraftWithAi(index)}>
                              <Sparkles size={ICON_SIZE.body} /> {aiBusyDraft === index ? "Cleaning…" : "Clean explanation with AI"}
                            </GhostButton>
                          )}
                          <span className="sub">AI suggestions remain review-gated and never invent a key without quoted evidence.</span>
                        </div>
                      )}
                      {draft.answerEvidence && <div className="question-explanation"><b>Answer evidence:</b> {draft.answerEvidence}</div>}
                      {draft.choiceRationales && Object.keys(draft.choiceRationales).length > 0 && (
                        <div className="stack gap6">
                          <span className="field-label">Choice rationales</span>
                          {Object.entries(draft.choiceRationales).map(([key, rationale]) => <div key={key} className="sub"><b>{key}:</b> {rationale}</div>)}
                        </div>
                      )}
                      {sourceText && draft.stem && <SourcePeek rawText={sourceText} stem={draft.stem} />}
                      {(draft.parserRuleIds?.length ?? 0) > 0 && <div className="source-rules">Parser rules: {draft.parserRuleIds!.join(" · ")}</div>}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {import.meta.env.DEV && drafts.length > 0 && (
            <details className="question-import-diagnostics">
              <summary>Import diagnostics (development only)</summary>
              <div className="stack gap6">
                {developerLedger.map((entry, index) => (
                  <div className="question-explanation" key={`${entry.questionNumber ?? "draft"}-${index}`}>
                    <b>Question {entry.questionNumber ?? index + 1}</b>
                    <div>Options: {entry.extractedOptions.map((option) => `${option.key}. ${option.text}`).join(" · ") || "none"}</div>
                    <div>Evidence: {entry.answerEvidence ?? "none"}</div>
                    <div>Mapping: {entry.selectedMapping ?? "unresolved"} · confidence {Math.round(entry.confidence * 100)}%</div>
                    {entry.conflictReason && <div>Conflict: {entry.conflictReason}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// --- source peek ("show nearby extracted text") --------------------------------

function SourcePeek({ rawText, stem }: { rawText: string; stem: string }) {
  const [open, setOpen] = useState(false);
  const needle = stem.slice(0, 40).trim();
  const idx = needle.length >= 10 ? rawText.indexOf(needle) : -1;
  const excerpt = idx >= 0
    ? rawText.slice(Math.max(0, idx - 120), idx + 600)
    : null;
  return (
    <div className="stack gap6">
      <GhostButton onClick={() => setOpen((v) => !v)}>
        {open ? "Hide source text" : "Show nearby source text"}
      </GhostButton>
      {open && (
        <div className="question-explanation" style={{ maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap" }}>
          {excerpt
            ? <>…{excerpt}…</>
            : "No matching nearby excerpt was found. AXOM left the source unset instead of showing unrelated text."}
        </div>
      )}
    </div>
  );
}

// --- paste tab ---------------------------------------------------------------

function PasteTab({ raw, label, onRawChange, parseSource, onParsed }: {
  raw: string;
  label?: string;
  onRawChange: (raw: string) => void;
  parseSource?: (raw: string) => { drafts: ParsedQuestionDraft[]; warnings: string[] };
  onParsed: (drafts: ParsedQuestionDraft[], warnings: string[], raw: string) => void;
}) {
  function parse() {
    const result = parseSource?.(raw) ?? { drafts: parseQuestionBlocks(raw), warnings: [] };
    onParsed(
      result.drafts,
      [
        ...result.warnings,
        ...(result.drafts.length === 0 ? ["No questions detected — check the format (numbered stems, A./B./C. options)."] : []),
      ],
      raw,
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <TextAreaField
        id="import-source-text"
        label={label ?? "Structured question text"}
        rows={12}
        value={raw}
        onChange={(event) => onRawChange(event.target.value)}
        placeholder={"1. A 45-year-old man presents with…\nA. Option one\nB. Option two\nC. Option three\nD. Option four\n\n2. The next question…\nA. …\nB. …\n\nAnswer key:\n1. C\n2. A"}
      />
      <div className="row">
        <GButton variant="primary" disabled={!raw.trim()} onClick={parse}>
          <ClipboardPaste size={ICON_SIZE.body} /> Parse and review
        </GButton>
        <span className="sub">Supports numbered questions, A–H choices, answer keys, explanations, rationales, and reasoning.</span>
      </div>
    </div>
  );
}

// --- file tab ----------------------------------------------------------------

function FileTab({ busyFile, setBusyFile, onParsed }: {
  busyFile: string | null;
  setBusyFile: (name: string | null) => void;
  onParsed: (drafts: ParsedQuestionDraft[], warnings: string[], source: QuestionSource, doc: PendingDocument | null, ai?: boolean, images?: File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isDocx = name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    setBusyFile(file.name);
    try {
      if (isPdf || isDocx) {
        const buffer = await file.arrayBuffer();
        const checksum = await sha256Hex(buffer);
        // pdf.js takes ownership of the bytes it is given, so the figure pass reads its own copy.
        const figureBytes = isPdf ? buffer.slice(0) : undefined;
        const extracted = isPdf ? await extractPdfText(buffer) : await extractDocxText(buffer);
        const doc: PendingDocument = {
          title: documentTitleFromFile(file.name),
          fileName: file.name,
          fileType: isPdf ? "pdf" : "docx",
          sizeBytes: file.size,
          rawText: extracted.text,
          pageTexts: isPdf ? extracted.pages : undefined,
          checksum,
        };
        if (extracted.empty) {
          onParsed([], extracted.warnings, isPdf ? "pdf" : "imported", doc);
          return;
        }
        const read = isPdf ? parsePdfQuestions(extracted.text, extracted.pages) : { drafts: parseQuestionBlocks(extracted.text), notes: [], deckPages: undefined };
        const drafts = read.drafts;
        const markNotes = figureBytes ? await proposePdfMarkedAnswers(figureBytes.slice(0), drafts, read.deckPages) : [];
        const { images, notes: figureNotes } = figureBytes
          ? await attachPdfFigures(figureBytes, file.name, drafts, extracted.pages ?? [], read.deckPages)
          : { images: [], notes: [] };
        onParsed(
          drafts,
          [
            ...extracted.warnings,
            ...read.notes,
            ...figureNotes,
            ...markNotes,
            ...(drafts.length === 0 ? ["Text was extracted but no question pattern was found — review the file, or keep it as a library document."] : []),
          ],
          isPdf ? "pdf" : "imported",
          doc,
          false,
          images,
        );
        return;
      }

      if (file.type.startsWith("image/")) {
        const checksum = await sha256Hex(await file.arrayBuffer());
        onParsed([], [
          `Attached ${file.name}. Image imports store provenance only — there is no in-app OCR yet. Paste the question text instead.`,
        ], "image", {
          title: documentTitleFromFile(file.name),
          fileName: file.name,
          fileType: file.type,
          sizeBytes: file.size,
          rawText: "",
          checksum,
        });
        return;
      }

      const format = detectImportFormat(file.name, file.type);
      if (format === "unsupported") {
        pushToast({ title: "Unsupported file type", body: "Use PDF, DOCX, TXT, Markdown, CSV, or JSON.", tone: "warn" });
        return;
      }
      const [text, checksum] = await Promise.all([
        file.text(),
        file.arrayBuffer().then(sha256Hex),
      ]);
      const plain = extractPlainText(text);
      const result = format === "csv" ? importFromCsv(plain.text) : format === "json" ? importFromJson(plain.text) : importFromText(plain.text);
      onParsed(result.drafts, [...plain.warnings, ...result.warnings], "imported", {
        title: documentTitleFromFile(file.name),
        fileName: file.name,
        fileType: format,
        sizeBytes: file.size,
        rawText: plain.text,
        checksum,
      });
    } catch (err) {
      pushToast({ title: "Import failed", body: err instanceof Error ? err.message : "Could not read this file.", tone: "warn" });
    } finally {
      setBusyFile(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="sub">
        <b>PDF and DOCX are parsed directly</b> (digital text — scanned PDFs are kept as source records; no OCR yet).
        TXT/Markdown use the question parser; CSV wants headers like
        <span className="mono"> question, a, b, c, d, answer, explanation, topic</span>; JSON takes an array of questions.
        Answer-key sections ("Answer key: 1. C…") are mapped automatically and flagged when ambiguous.
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,image/*"
        aria-label="Choose a question file to import"
        className="visually-hidden-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="import-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file && !busyFile) void handleFile(file);
      }}>
        <FileUp size={ICON_SIZE.display} />
        <div><b>Drop a question file here</b><span>or choose one from this device</span></div>
        <GButton variant="primary" disabled={busyFile !== null} onClick={() => fileInput.current?.click()}>
          {busyFile ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <FileUp size={ICON_SIZE.body} />} {busyFile ? `Extracting ${busyFile}…` : "Choose file"}
        </GButton>
      </div>
    </div>
  );
}

// --- AI generate tab -----------------------------------------------------------

function AiGenerateTab({ seedReference, onParsed }: {
  seedReference?: { title: string; text: string } | null;
  onParsed: (drafts: ParsedQuestionDraft[], warnings: string[]) => void;
}) {
  const [topic, setTopic] = useState(seedReference?.title ?? "");
  const [genCategory, setGenCategory] = useState("");
  const [style, setStyle] = useState("board-style");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [count, setCount] = useState("3");
  const [reference, setReference] = useState(seedReference?.text.slice(0, 6000) ?? "");
  const [busy, setBusy] = useState(false);
  const settings = loadAiSettings();
  const provider = useMemo(() => resolveActiveProvider(), []);
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);

  useMemo(() => { void checkProviderHealth().then(setHealth); }, []);

  async function generate() {
    if (!provider) return;
    setBusy(true);
    try {
      const result = await generateQuestionDrafts(provider, {
        topic,
        category: genCategory || undefined,
        examStyle: style,
        difficulty,
        count: Math.max(1, Math.min(10, Number(count) || 3)),
        reference: reference || undefined,
      });
      void saveAiGeneration({
        kind: "question-analysis",
        title: topic.trim() || "AI question drafts",
        inputHash: hashGenerationInput({ topic, category: genCategory, style, difficulty, count, reference }),
        model: settings.mode === "local" ? settings.localModel : provider.info.label,
        promptVersion: result.promptVersion,
        content: result.drafts,
        metadata: {
          provider: provider.info.label,
          category: genCategory || undefined,
          style,
          difficulty,
          warnings: result.warnings,
          sourceReference: seedReference?.title,
        },
      });
      onParsed(
        result.drafts.map((d) => ({
          stem: d.stem,
          options: d.options,
          correctKey: d.correctKey,
          explanation: [d.explanation, d.whyOthersWrong ? `Why the others are wrong: ${d.whyOthersWrong}` : ""].filter(Boolean).join("\n\n"),
          topic: topic || undefined,
          category: genCategory || undefined,
          tags: d.tags,
          confidence: "medium",
          warnings: ["AI-generated — verify against a trusted source before trusting it."],
        })),
        result.warnings,
      );
    } catch (err) {
      pushToast({ title: "Generation failed", body: err instanceof Error ? err.message : "Unknown error.", tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  if (!provider || (settings.mode === "local" && !settings.localModel)) {
    return (
      <EmptyState
        title="No AI provider is active"
        hint={health?.detail ?? "Turn on Local (Ollama) or Demo mode in Settings → AI. Generated questions always require your review before saving."}
        icon={<Sparkles size={ICON_SIZE.emphasis} />}
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid grid-2">
        <Field label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Complement deficiencies" />
        <SelectField label="Category" value={genCategory} onChange={(e) => setGenCategory(e.target.value)}>
          <option value="">None</option>
          {QUESTION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        <SelectField label="Style" value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="board-style">Board-style vignette</option>
          <option value="imcq">IMCQ</option>
          <option value="esop">ESOP</option>
          <option value="mcat">MCAT-style</option>
          <option value="recall">Direct recall</option>
        </SelectField>
        <SelectField label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as "easy" | "medium" | "hard")}>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </SelectField>
      </div>
      <Field label="How many (≤10)" type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} />
      <TextAreaField label="Optional reference text (objectives, notes — questions are grounded in this)" rows={3}
        value={reference} onChange={(e) => setReference(e.target.value)} />
      <div className="row">
        <GButton variant="primary" disabled={busy || !topic.trim()} onClick={generate}>
          {busy ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <Sparkles size={ICON_SIZE.body} />} {busy ? "Generating…" : "Generate drafts"}
        </GButton>
        <span className="sub">Every draft lands in review — nothing saves without your approval.</span>
      </div>
    </div>
  );
}
