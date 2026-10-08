// ===========================================================================
// Mass Import (rehaul phase 2) — a staged queue for many files at once:
//   1. upload queue      2. extract text (parallel, capped)
//   3. detect Q/A/expl   4. file-level summary
//   5. per file: Accept, Edit or Skip, and Accept all valid for the queue
//
// A file can be accepted without opening it only when nothing in it is left
// for a person to decide (lib/massImportCandidate). Every other file goes
// through the editable review ("Edit"), as before. An accepted file is saved
// by lib/questionImportSave, the same path the review screen finalizes
// through: this queue has no save logic of its own.
// ===========================================================================
import { useEffect, useRef, useState, useMemo } from "react";
import { FileUp, RefreshCw, CheckCircle2, AlertTriangle, Trash2, Pencil, Check, CheckCheck, SkipForward, Undo2 } from "lucide-react";
import { associateAnswerSource, parseAnswerSections, parseQuestionBlocks, type ParsedQuestionDraft } from "../../lib/questionParse";
import { importFromCsv, importFromJson } from "../../lib/questionImport";
import { extractDocxText, extractPdfText, extractPlainText } from "../../lib/extractText";
import { proposePdfMarkedAnswers } from "../../lib/pdfMarkedAnswers";
import { attachPdfFigures } from "../../lib/pdfFigures";
import { parsePdfQuestions } from "../../lib/pdfQuestionImport";
import { courseForScope } from "../../lib/course-engine/questionBank";
import { useStore } from "../../lib/store";
import { MAPPING_STATUS_LABEL, describeMapping, inferSourceMapping } from "../../lib/course-engine/sourceMapping";
import { moduleAliases } from "../../lib/course-engine/templateParse";
import { vocabularyFromCourses } from "../../lib/course-engine/vocabulary";
import { documentTitleFromFile } from "../../lib/library";
import type { QuestionSource } from "../../lib/questions";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { sha256Hex } from "../../lib/checksum";
import type { ImportSeed } from "./ImportPanel";
import { draftImportStatus } from "../../lib/questionImportTrust";
import { ICON_SIZE } from "../../lib/iconSize";
import { naturalCollator } from "../../lib/naturalSort";
import { buildDuplicateIndex } from "../../lib/questionDuplicates";
import { evaluateImportCandidate, type CandidateEvaluation } from "../../lib/massImportCandidate";
import { prepareReviewedImport, saveReviewedImport } from "../../lib/questionImportSave";
import { skipImport, skippedImport, unskipImport } from "../../lib/importSkips";
import { pushToast } from "../../lib/toast";


type FileStatus = "queued" | "extracting" | "parsing" | "ready" | "needs-review" | "accepting" | "accepted" | "skipped" | "answer-source" | "no-text" | "error";

interface QueuedFile {
  id: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  status: FileStatus;
  rawText: string;
  pageTexts?: string[];
  checksum?: string;
  drafts: ParsedQuestionDraft[];
  warnings: string[];
  answerKeyDetected: boolean;
  source: QuestionSource;
  error?: string;
  /** Figures cut from a PDF, carried into the review with its questions. */
  images?: File[];
  /** Set once the file is saved: what went in. */
  accepted?: { questions: number; images: number };
  /** When the learner skipped this file, now or in an earlier import. */
  skippedAt?: string;
}

const reviewable = (status: FileStatus) => status === "ready" || status === "needs-review";

const uid = () => crypto.randomUUID();
const CONCURRENCY = 3;

export function massImportFileStatus(drafts: readonly ParsedQuestionDraft[]): "error" | "needs-review" | "ready" {
  if (drafts.length === 0) return "error";
  return drafts.every((draft) => draftImportStatus(draft) === "ready") ? "ready" : "needs-review";
}

export function MassImport({
  onInspect,
  finalizedQueueId,
}: {
  onInspect: (payload: ImportSeed & { title: string; drafts: ParsedQuestionDraft[]; rawText: string; fileName: string }) => void;
  finalizedQueueId?: string;
}) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const store = useStore();
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);
  const vocabulary = useMemo(
    () => vocabularyFromCourses(store.terms ?? [], store.courses ?? [], moduleAliases),
    [store.courses, store.terms],
  );
  const modules = useMemo(
    () => [...new Set((store.courses ?? []).flatMap((course) => course.modules.map((module) => module.name)))],
    [store.courses],
  );
  // The bank is read once for the whole queue, not once for every question in it.
  const duplicates = useMemo(() => buildDuplicateIndex(store.questions ?? []), [store.questions]);
  /** Whether each parsed file can be accepted as it is, and if not, what is in the way. */
  const evaluations = useMemo(() => {
    const library = { questions: store.questions ?? [], questionSets: store.questionSets ?? [], documents: store.documents ?? [] };
    return new Map<string, CandidateEvaluation>(queue.filter((file) => reviewable(file.status)).map((file) => [file.id, evaluateImportCandidate({
      drafts: file.drafts,
      fileName: file.fileName,
      checksum: file.checksum,
      imageCount: file.images?.length,
      mapping: inferSourceMapping(file.fileName, vocabulary),
      modules,
      library,
      duplicates,
    })]));
  }, [duplicates, modules, queue, store.documents, store.questionSets, store.questions, vocabulary]);
  /** Where the file's name says it belongs, and how sure that reading is. The review confirms it. */
  function placeLine(file: QueuedFile): string {
    const mapping = inferSourceMapping(file.fileName, vocabulary);
    const figures = file.images?.length ? ` · ${file.images.length} image${file.images.length === 1 ? "" : "s"}` : "";
    return mapping.module
      ? `${describeMapping(mapping)} · ${MAPPING_STATUS_LABEL[mapping.status]}${figures}`
      : `Not filed: no module of yours in the name${figures}`;
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const ownedFileIds = useRef(new Set<string>());
  const queueRef = useRef(queue);

  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => () => {
    for (const id of ownedFileIds.current) fileMap.delete(id);
    ownedFileIds.current.clear();
  }, []);

  useEffect(() => {
    if (!finalizedQueueId) return;
    const current = queueRef.current;
    const removedIndex = current.findIndex((file) => file.id === finalizedQueueId);
    const remaining = current.filter((file) => file.id !== finalizedQueueId);
    const focusFile = removedIndex >= 0
      ? remaining[Math.min(removedIndex, remaining.length - 1)]
      : undefined;
    fileMap.delete(finalizedQueueId);
    ownedFileIds.current.delete(finalizedQueueId);
    queueRef.current = remaining;
    setQueue(remaining);
    if (focusFile) {
      const inspectable = reviewable(focusFile.status) && focusFile.drafts.length > 0;
      focusAfterQueueUpdate(inspectable
        ? `mass-import-inspect-${focusFile.id}`
        : `mass-import-remove-${focusFile.id}`);
    }
  }, [finalizedQueueId]);

  function enqueue(files: FileList) {
    const added: QueuedFile[] = Array.from(files).map((f) => ({
      id: uid(),
      fileName: f.name,
      fileType: fileKind(f),
      sizeBytes: f.size,
      status: "queued",
      rawText: "",
      drafts: [],
      warnings: [],
      answerKeyDetected: false,
      source: sourceKind(f),
    }));
    // Keep the File objects alongside the queue rows for processing.
    added.forEach((row, i) => {
      fileMap.set(row.id, files[i]);
      ownedFileIds.current.add(row.id);
    });
    // I3-26: batches arrive in whatever order the OS hands them over, and
    // workers finish out of order. Keep the queue in natural reading order
    // ("Lecture 2" before "Lecture 10", "Week 9 IMCQ 1" before "IMCQ 2").
    setQueue((q) => [...q, ...added].sort((a, b) => naturalCollator.compare(a.fileName, b.fileName)));
  }

  async function processAll() {
    setProcessing(true);
    const pending = queue.filter((f) => f.status === "queued");
    // Simple bounded-concurrency worker pool.
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length) {
        const row = pending[cursor++];
        await processOne(row.id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    setProcessing(false);
  }

  function patch(id: string, next: Partial<QueuedFile>) {
    setQueue((q) => q.map((f) => (f.id === id ? { ...f, ...next } : f)));
  }

  function removeQueuedFile(id: string) {
    const index = queue.findIndex((file) => file.id === id);
    const focusFile = queue[index + 1] ?? queue[index - 1];
    fileMap.delete(id);
    ownedFileIds.current.delete(id);
    setQueue((current) => current.filter((file) => file.id !== id));
    const restoreFocus = () => {
      const target = document.getElementById(
        focusFile ? `mass-import-remove-${focusFile.id}` : "mass-import-add-files",
      );
      if (target instanceof HTMLElement) target.focus();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restoreFocus);
    else setTimeout(restoreFocus, 0);
  }

  async function processOne(id: string) {
    const file = fileMap.get(id);
    if (!file) return;
    patch(id, { status: "extracting" });
    try {
      const kind = fileKind(file);
      let rawText = "";
      let pageTexts: string[] | undefined;
      let checksum: string | undefined;
      let warnings: string[] = [];
      let figureBytes: ArrayBuffer | undefined;

      if (kind === "pdf" || kind === "docx") {
        const buffer = await file.arrayBuffer();
        checksum = await sha256Hex(buffer);
        // pdf.js takes ownership of the bytes it is given, so the figure pass reads its own copy.
        figureBytes = kind === "pdf" ? buffer.slice(0) : undefined;
        const extracted = kind === "pdf" ? await extractPdfText(buffer) : await extractDocxText(buffer);
        rawText = extracted.text;
        pageTexts = kind === "pdf" ? extracted.pages : undefined;
        warnings = [...extracted.warnings];
        if (extracted.empty) {
          patch(id, { status: "no-text", rawText: "", pageTexts, checksum, warnings, drafts: [] });
          return;
        }
      } else if (kind === "csv" || kind === "json") {
        const buffer = await file.arrayBuffer();
        checksum = await sha256Hex(buffer);
        const plain = extractPlainText(new TextDecoder().decode(buffer));
        rawText = plain.text;
        warnings.push(...plain.warnings);
      } else {
        const buffer = await file.arrayBuffer();
        checksum = await sha256Hex(buffer);
        const plain = extractPlainText(new TextDecoder().decode(buffer));
        rawText = plain.text;
        warnings.push(...plain.warnings);
      }

      patch(id, { status: "parsing", rawText, pageTexts, checksum });
      // A PDF is read with its pages, so a slide deck is read slide by slide.
      const read = kind === "pdf" && pageTexts ? parsePdfQuestions(rawText, pageTexts) : undefined;
      const result = read ? { drafts: read.drafts, warnings: read.notes }
        : kind === "csv" ? importFromCsv(rawText) : kind === "json" ? importFromJson(rawText) : { drafts: parseQuestionBlocks(rawText), warnings: [] };
      const drafts = result.drafts;
      warnings = [...warnings, ...result.warnings];
      if (figureBytes) warnings.push(...await proposePdfMarkedAnswers(figureBytes.slice(0), drafts, read?.deckPages));
      const figures = figureBytes && pageTexts
        ? await attachPdfFigures(figureBytes, file.name, drafts, pageTexts, read?.deckPages)
        : { images: [], notes: [] };
      warnings.push(...figures.notes);
      const answerKeyDetected = drafts.some((d) => d.correctKey);
      const importStatus = massImportFileStatus(drafts);
      // A file skipped in an earlier import comes back as skipped, in view, not as new work.
      const skipped = drafts.length > 0 ? skippedImport(checksum) : undefined;
      patch(id, {
        status: skipped ? "skipped" : importStatus,
        skippedAt: skipped?.skippedAt,
        drafts,
        warnings,
        answerKeyDetected,
        images: figures.images,
        error: drafts.length === 0 ? "No questions detected" : undefined,
      });
    } catch (err) {
      patch(id, { status: "error", error: err instanceof Error ? err.message : "Could not read this file." });
    } finally { /* retain the File for an explicit retry; removal/finalization releases it */ }
  }

  /**
   * Save one file as it stands. It is judged again here, against the bank as it
   * is at this moment: an accept earlier in the same run may have brought in
   * the very questions this file holds.
   */
  async function acceptOne(id: string): Promise<boolean> {
    const file = queueRef.current.find((entry) => entry.id === id);
    if (!file || !reviewable(file.status)) return false;
    const current = (useStore as { getState?: () => typeof store }).getState?.() ?? storeRef.current;
    const library = { questions: current.questions ?? [], questionSets: current.questionSets ?? [], documents: current.documents ?? [] };
    const evaluation = evaluateImportCandidate({
      drafts: file.drafts,
      fileName: file.fileName,
      checksum: file.checksum,
      imageCount: file.images?.length,
      mapping: inferSourceMapping(file.fileName, vocabulary),
      modules,
      library,
      duplicates: buildDuplicateIndex(library.questions),
    });
    if (!evaluation.valid) return false;

    const title = documentTitleFromFile(file.fileName);
    const prepared = prepareReviewedImport({
      drafts: file.drafts.map((draft) => ({ ...draft, source: file.source })),
      destination: "both",
      document: { title, fileName: file.fileName, fileType: file.fileType, sizeBytes: file.sizeBytes, rawText: file.rawText, pageTexts: file.pageTexts, checksum: file.checksum },
      sourceType: file.source,
      setTitle: title,
      scope: evaluation.scope ? { ...evaluation.scope, courseId: courseForScope(evaluation.scope, current.courses)?.id } : undefined,
      parserWarnings: file.warnings,
    }, library);
    if (!prepared.ok) return false;

    patch(id, { status: "accepting", error: undefined });
    const saved = await saveReviewedImport(prepared, current, file.images ?? []);
    if (!saved.ok) {
      patch(id, { status: massImportFileStatus(file.drafts), error: saved.message });
      return false;
    }
    fileMap.delete(id);
    patch(id, { status: "accepted", accepted: { questions: saved.questionIds.length, images: saved.images.attached }, images: undefined });
    return true;
  }

  async function accept(id: string) {
    const file = queueRef.current.find((entry) => entry.id === id);
    setAccepting(true);
    const done = await acceptOne(id);
    setAccepting(false);
    pushToast(done
      ? { title: `${file?.fileName ?? "File"} accepted`, body: "It is saved as a question set, with its source.", tone: "success" }
      : { title: "Not accepted", body: "This file changed or could not be saved. Edit it to review its questions.", tone: "warn" });
  }

  async function acceptAllValid() {
    const ids = queueRef.current.filter((file) => evaluations.get(file.id)?.valid).map((file) => file.id);
    if (!ids.length) return;
    setAccepting(true);
    let done = 0;
    // One at a time: each save changes what the next file is compared with.
    for (const id of ids) if (await acceptOne(id)) done += 1;
    setAccepting(false);
    const left = ids.length - done;
    pushToast({
      title: `${done} file${done === 1 ? "" : "s"} accepted`,
      body: left
        ? `${left} could not be accepted once ${left === 1 ? "it was" : "they were"} checked against what had just been saved. Edit ${left === 1 ? "it" : "them"} to review.`
        : "Each is saved as a question set, with its source.",
      tone: left ? "warn" : "success",
    });
  }

  function skip(id: string) {
    const file = queueRef.current.find((entry) => entry.id === id);
    if (!file) return;
    const skippedAt = new Date().toISOString();
    skipImport({ checksum: file.checksum, fileName: file.fileName }, skippedAt);
    patch(id, { status: "skipped", skippedAt });
  }

  function reviewAnyway(id: string) {
    const file = queueRef.current.find((entry) => entry.id === id);
    if (!file) return;
    unskipImport(file.checksum);
    patch(id, { status: massImportFileStatus(file.drafts), skippedAt: undefined });
  }

  function retry(id: string) {
    patch(id, { status: "queued", error: undefined, warnings: [], drafts: [], rawText: "" });
    queueMicrotask(() => void processOne(id));
  }

  function associateAnswers(answerFile: QueuedFile, target: QueuedFile) {
    const result = associateAnswerSource(target.drafts, answerFile.rawText);
    const status = massImportFileStatus(result.drafts);
    patch(target.id, {
      drafts: result.drafts,
      status,
      answerKeyDetected: result.matched > 0,
      warnings: [...target.warnings, `Matched ${result.matched} numbered answer${result.matched === 1 ? "" : "s"} from ${answerFile.fileName}.`, ...(result.unmatchedNumbers.length ? [`Unmatched answer numbers: ${result.unmatchedNumbers.join(", ")}.`] : [])],
    });
    patch(answerFile.id, { status: "answer-source", error: undefined });
  }

  const validCount = queue.filter((f) => evaluations.get(f.id)?.valid).length;
  const needsReviewCount = queue.filter((f) => reviewable(f.status) && !evaluations.get(f.id)?.valid).length;
  const acceptedCount = queue.filter((f) => f.status === "accepted").length;
  const skippedCount = queue.filter((f) => f.status === "skipped").length;
  const anyQueued = queue.some((f) => f.status === "queued");
  const failedCount = queue.filter((f) => f.status === "error" || f.status === "no-text").length;
  const finishedCount = queue.filter((f) => !["queued", "extracting", "parsing"].includes(f.status)).length;
  /** Why a file cannot be accepted as it is: the first reasons, in the learner's words. */
  const reasonLine = (file: QueuedFile): string | undefined => {
    const blocks = evaluations.get(file.id)?.blocks ?? [];
    if (!blocks.length) return undefined;
    const more = blocks.length - 2;
    return `${blocks.slice(0, 2).map((block) => block.message).join(" ")}${more > 0 ? ` And ${more} more.` : ""}`;
  };
  const editPayload = (file: QueuedFile) => ({
    batchQueueId: file.id,
    title: documentTitleFromFile(file.fileName),
    drafts: file.drafts, images: file.images,
    rawText: file.rawText,
    fileName: file.fileName,
    fileType: file.fileType,
    sizeBytes: file.sizeBytes,
    pageTexts: file.pageTexts,
    checksum: file.checksum,
    warnings: file.warnings,
    source: file.source,
  });

  return (
    <GlassCard>
      <PanelHeader
        title="Import"
        sub="Add one file or several. AXOM reads each one, says what it found and where it belongs, and lets you accept a file that needs no decisions or edit it first."
        action={
          <div className="row">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json"
              aria-label="Choose multiple question files"
              className="visually-hidden-input"
              onChange={(e) => { if (e.target.files?.length) enqueue(e.target.files); e.target.value = ""; }}
            />
            <GhostButton id="mass-import-add-files" onClick={() => fileInput.current?.click()}><FileUp size={ICON_SIZE.body} /> Add files</GhostButton>
            <GButton size="sm" variant="primary" disabled={!anyQueued || processing} onClick={() => void processAll()}>
              {processing ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <RefreshCw size={ICON_SIZE.body} />} {processing ? "Importing…" : "Import files"}
            </GButton>
            {validCount > 0 && (
              <GButton size="sm" variant="primary" disabled={accepting || processing} onClick={() => void acceptAllValid()}>
                {accepting ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <CheckCheck size={ICON_SIZE.body} />} Accept all valid ({validCount})
              </GButton>
            )}
          </div>
        }
      />

      {queue.length === 0 ? (
        <EmptyState icon={<FileUp size={ICON_SIZE.emphasis} />} title="No files queued" hint="Add several PDFs or documents at once. Each is read and summarized before you accept or edit it." />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="row wrap gap6" aria-label="Mass import review status">
              <Tag tone="green">Ready to accept {validCount}</Tag>
              <Tag tone="orange">Needs review {needsReviewCount}</Tag>
              <Tag tone="red">Could not import {failedCount}</Tag>
              {acceptedCount > 0 && <Tag tone="green">Accepted {acceptedCount}</Tag>}
              {skippedCount > 0 && <Tag tone="neutral">Skipped {skippedCount}</Tag>}
              <Tag tone="cyan">Processed {finishedCount}/{queue.length}</Tag>
            </div>
            <span className="sub">Accept a file that is ready, or edit it to review its questions first.</span>
          </div>

          <div className="stack gap6">
            {queue.map((file) => (
              <div key={file.id} className="import-draft">
                <div className="row mass-import-row">
                  <StatusIcon status={file.status} evaluation={evaluations.get(file.id)} />
                  <div className="grow stack mass-import-file">
                    <span className="truncate" style={{ fontWeight: 600 }}>{file.fileName}</span>
                    <span className="sub truncate">
                      {file.fileType.toUpperCase()} · {Math.round(file.sizeBytes / 1024)} KB
                      {reviewable(file.status) || file.status === "skipped"
                        ? ` · ${file.drafts.length} question${file.drafts.length === 1 ? "" : "s"} · answer key ${file.answerKeyDetected ? "found" : "not found"}`
                        : ""}
                      {file.status === "accepted" && file.accepted
                        ? ` · ${file.accepted.questions} question${file.accepted.questions === 1 ? "" : "s"} saved${file.accepted.images ? ` · ${file.accepted.images} image${file.accepted.images === 1 ? "" : "s"} attached` : ""}`
                        : ""}
                      {file.status === "skipped" && file.skippedAt ? ` · skipped ${file.skippedAt.slice(0, 10)}` : ""}
                      {file.error ? ` · ${file.error}` : ""}
                    </span>
                    {reviewable(file.status) && (
                      <span className="sub truncate">{placeLine(file)}</span>
                    )}
                    {reviewable(file.status) && reasonLine(file) && (
                      <span className="sub">{reasonLine(file)}</span>
                    )}
                  </div>
                  <div className="row mass-import-actions">
                    <StatusTag status={file.status} evaluation={evaluations.get(file.id)} />
                    {evaluations.get(file.id)?.valid && (
                      <GhostButton
                        aria-label={`Accept ${file.fileName}`}
                        title="Save this file's questions as they are"
                        disabled={accepting}
                        onClick={() => void accept(file.id)}>
                        <Check size={ICON_SIZE.body} /> Accept
                      </GhostButton>
                    )}
                    {reviewable(file.status) && file.drafts.length > 0 && (
                      <GhostButton
                        id={`mass-import-inspect-${file.id}`}
                        aria-label={`Edit ${file.fileName}`}
                        title="Open in the Import Center to review and correct its questions"
                        disabled={accepting}
                        onClick={() => onInspect(editPayload(file))}>
                        <Pencil size={ICON_SIZE.body} /> Edit
                      </GhostButton>
                    )}
                    {reviewable(file.status) && file.drafts.length > 0 && (
                      <GhostButton
                        aria-label={`Skip ${file.fileName}`}
                        title="Leave this file out. It stays skipped if you add it again."
                        disabled={accepting}
                        onClick={() => skip(file.id)}>
                        <SkipForward size={ICON_SIZE.body} /> Skip
                      </GhostButton>
                    )}
                    {file.status === "skipped" && (
                      <GhostButton aria-label={`Review ${file.fileName} anyway`} onClick={() => reviewAnyway(file.id)}>
                        <Undo2 size={ICON_SIZE.body} /> Review anyway
                      </GhostButton>
                    )}
                    {file.status === "error" && parseAnswerSections(file.rawText).entries.size > 0 && queue.filter((candidate) => candidate.drafts.length > 0).length === 1 && (
                      <GhostButton aria-label={`Match ${file.fileName} to questions`} onClick={() => associateAnswers(file, queue.find((candidate) => candidate.drafts.length > 0)!)}>
                        Match answers
                      </GhostButton>
                    )}
                    {file.status === "answer-source" && (
                      <GhostButton aria-label={`Edit ${file.fileName}`} onClick={() => onInspect({ batchQueueId: file.id, title: documentTitleFromFile(file.fileName), drafts: [], rawText: file.rawText, fileName: file.fileName, fileType: file.fileType, sizeBytes: file.sizeBytes, checksum: file.checksum, warnings: file.warnings, source: file.source })}>
                        <Pencil size={ICON_SIZE.body} /> Keep source
                      </GhostButton>
                    )}
                    {(file.status === "error" || file.status === "no-text") && fileMap.has(file.id) && (
                      <GhostButton aria-label={`Retry ${file.fileName}`} onClick={() => retry(file.id)}>
                        <RefreshCw size={ICON_SIZE.body} /> Retry
                      </GhostButton>
                    )}
                    <GhostButton id={`mass-import-remove-${file.id}`} aria-label={`Remove ${file.fileName}`}
                      onClick={() => removeQueuedFile(file.id)}>
                      <Trash2 size={ICON_SIZE.body} />
                    </GhostButton>
                  </div>
                </div>
                {file.warnings.length > 0 && (file.status === "needs-review" || file.status === "no-text") && (
                  <ul className="intake-warnings" style={{ marginTop: 8 }}>{file.warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

function focusAfterQueueUpdate(elementId: string) {
  const restore = () => {
    const target = document.getElementById(elementId);
    if (target instanceof HTMLElement) target.focus();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}

// File objects can't live in React state cleanly across renders; keep them in a
// module map keyed by the queue row id (cleared when a row is removed).
const fileMap = new Map<string, File>();

function fileKind(file: File): string {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".json")) return "json";
  return "text";
}
function sourceKind(file: File): QuestionSource {
  const k = fileKind(file);
  return k === "pdf" ? "pdf" : "imported";
}

/** A tick only for a file that is saved or can be accepted as it is. */
function StatusIcon({ status, evaluation }: { status: FileStatus; evaluation?: CandidateEvaluation }) {
  if (status === "accepted" || evaluation?.valid) return <CheckCircle2 size={ICON_SIZE.emphasis} style={{ color: "var(--grade-green)" }} />;
  if (status === "ready" || status === "needs-review" || status === "no-text" || status === "error") return <AlertTriangle size={ICON_SIZE.emphasis} style={{ color: "var(--grade-orange)" }} />;
  if (status === "extracting" || status === "parsing" || status === "accepting") return <RefreshCw size={ICON_SIZE.emphasis} className="spin" />;
  if (status === "skipped") return <SkipForward size={ICON_SIZE.emphasis} className="dim" />;
  return <FileUp size={ICON_SIZE.emphasis} className="dim" />;
}

type TagTone = "green" | "orange" | "red" | "neutral" | "cyan";

/**
 * A parsed file is "ready to accept" only when nothing is in the way. When
 * something is, the tag names the kind of thing: an earlier import of the same
 * file reads differently from questions that need a look.
 */
function StatusTag({ status, evaluation }: { status: FileStatus; evaluation?: CandidateEvaluation }) {
  const map: Record<FileStatus, { label: string; tone: TagTone }> = {
    queued: { label: "queued", tone: "neutral" },
    extracting: { label: "extracting", tone: "cyan" },
    parsing: { label: "parsing", tone: "cyan" },
    ready: { label: "needs review", tone: "orange" },
    "needs-review": { label: "needs review", tone: "orange" },
    accepting: { label: "saving", tone: "cyan" },
    accepted: { label: "accepted", tone: "green" },
    skipped: { label: "skipped", tone: "neutral" },
    "answer-source": { label: "answers matched", tone: "cyan" },
    "no-text": { label: "no text (scan)", tone: "orange" },
    error: { label: "no questions", tone: "red" },
  };
  const meta = !evaluation ? map[status]
    : evaluation.valid ? { label: "ready to accept", tone: "green" as const }
    : evaluation.prior?.relation === "same-file" ? { label: "already imported", tone: "cyan" as const }
    : evaluation.prior?.relation === "other-version" ? { label: "changed since import", tone: "orange" as const }
    : map[status];
  return <Tag tone={meta.tone}>{meta.label}</Tag>;
}
