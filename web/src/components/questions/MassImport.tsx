// ===========================================================================
// Mass Import (rehaul phase 2) — a staged queue for many files at once:
//   1. upload queue      2. extract text (parallel, capped)
//   3. detect Q/A/expl   4. file-level summary
//   5. inspect each file 6. hand off to the single-file Import Center
// Every parsed file, including a high-confidence one, must pass through the
// shared editable review before it can be finalized. This queue never persists
// questions, sets, or source documents directly.
// ===========================================================================
import { useEffect, useRef, useState } from "react";
import { FileUp, RefreshCw, CheckCircle2, AlertTriangle, Trash2, Eye } from "lucide-react";
import { associateAnswerSource, parseAnswerSections, parseQuestionBlocks, type ParsedQuestionDraft } from "../../lib/questionParse";
import { importFromCsv, importFromJson } from "../../lib/questionImport";
import { extractDocxText, extractPdfText, extractPlainText } from "../../lib/extractText";
import { documentTitleFromFile } from "../../lib/library";
import type { QuestionSource } from "../../lib/questions";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { sha256Hex } from "../../lib/checksum";
import { assignDraftProvenancePages } from "../../lib/questionProvenance";
import type { ImportSeed } from "./ImportPanel";
import { draftImportStatus } from "../../lib/questionImportTrust";
import { ICON_SIZE } from "../../lib/iconSize";

type FileStatus = "queued" | "extracting" | "parsing" | "ready" | "needs-review" | "answer-source" | "no-text" | "error";

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
}

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
      const inspectable = (focusFile.status === "needs-review" || focusFile.status === "ready")
        && focusFile.drafts.length > 0;
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
    setQueue((q) => [...q, ...added]);
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

      if (kind === "pdf" || kind === "docx") {
        const buffer = await file.arrayBuffer();
        checksum = await sha256Hex(buffer);
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
      const result = kind === "csv" ? importFromCsv(rawText) : kind === "json" ? importFromJson(rawText) : { drafts: parseQuestionBlocks(rawText), warnings: [] };
      const drafts = result.drafts;
      if (kind === "pdf" && pageTexts) assignSourcePages(drafts, pageTexts);
      warnings = [...warnings, ...result.warnings];
      const answerKeyDetected = drafts.some((d) => d.correctKey);
      const importStatus = massImportFileStatus(drafts);
      patch(id, {
        status: importStatus,
        drafts,
        warnings,
        answerKeyDetected,
        error: drafts.length === 0 ? "No questions detected" : undefined,
      });
    } catch (err) {
      patch(id, { status: "error", error: err instanceof Error ? err.message : "Could not read this file." });
    } finally { /* retain the File for an explicit retry; removal/finalization releases it */ }
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

  const readyCount = queue.filter((f) => f.status === "ready").length;
  const needsReviewCount = queue.filter((f) => f.status === "needs-review").length;
  const anyQueued = queue.some((f) => f.status === "queued");
  const failedCount = queue.filter((f) => f.status === "error" || f.status === "no-text").length;
  const finishedCount = queue.filter((f) => !["queued", "extracting", "parsing"].includes(f.status)).length;

  return (
    <GlassCard>
      <PanelHeader
        title="Import"
        sub="Upload one file or several related files. AXOM extracts and summarizes each file, then sends it through editable review before finalization."
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
          </div>
        }
      />

      {queue.length === 0 ? (
        <EmptyState icon={<FileUp size={ICON_SIZE.emphasis} />} title="No files queued" hint="Add several PDFs or documents at once — each is parsed and summarized before inspection." />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="row wrap gap6" aria-label="Mass import review status">
              <Tag tone="green">Ready to inspect {readyCount}</Tag>
              <Tag tone="orange">Needs review {needsReviewCount}</Tag>
              <Tag tone="red">Could not import {failedCount}</Tag>
              <Tag tone="cyan">Processed {finishedCount}/{queue.length}</Tag>
            </div>
            <span className="sub">Inspect each parsed file to edit and finalize its questions.</span>
          </div>

          <div className="stack gap6">
            {queue.map((file) => (
              <div key={file.id} className="import-draft">
                <div className="row" style={{ gap: 8 }}>
                  <StatusIcon status={file.status} />
                  <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 600 }}>{file.fileName}</span>
                    <span className="sub truncate">
                      {file.fileType.toUpperCase()} · {Math.round(file.sizeBytes / 1024)} KB
                      {file.status === "ready" || file.status === "needs-review"
                        ? ` · ${file.drafts.length} questions · answer key ${file.answerKeyDetected ? "found" : "not found"}`
                        : ""}
                      {file.error ? ` · ${file.error}` : ""}
                    </span>
                  </div>
                  <StatusTag status={file.status} />
                  {(file.status === "needs-review" || file.status === "ready") && file.drafts.length > 0 && (
                    <GhostButton
                      id={`mass-import-inspect-${file.id}`}
                      aria-label={`Inspect ${file.fileName}`}
                      title="Open in Import Center for full review"
                      onClick={() => onInspect({
                        batchQueueId: file.id,
                        title: documentTitleFromFile(file.fileName),
                        drafts: file.drafts,
                        rawText: file.rawText,
                        fileName: file.fileName,
                        fileType: file.fileType,
                        sizeBytes: file.sizeBytes,
                        pageTexts: file.pageTexts,
                        checksum: file.checksum,
                        warnings: file.warnings,
                        source: file.source,
                      })}>
                      <Eye size={ICON_SIZE.body} /> Inspect
                    </GhostButton>
                  )}
                  {file.status === "error" && parseAnswerSections(file.rawText).entries.size > 0 && queue.filter((candidate) => candidate.drafts.length > 0).length === 1 && (
                    <GhostButton aria-label={`Match ${file.fileName} to questions`} onClick={() => associateAnswers(file, queue.find((candidate) => candidate.drafts.length > 0)!)}>
                      Match answers
                    </GhostButton>
                  )}
                  {file.status === "answer-source" && (
                    <GhostButton aria-label={`Inspect ${file.fileName}`} onClick={() => onInspect({ batchQueueId: file.id, title: documentTitleFromFile(file.fileName), drafts: [], rawText: file.rawText, fileName: file.fileName, fileType: file.fileType, sizeBytes: file.sizeBytes, checksum: file.checksum, warnings: file.warnings, source: file.source })}>
                      <Eye size={ICON_SIZE.body} /> Keep source
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

function assignSourcePages(drafts: ParsedQuestionDraft[], pages: string[]) {
  assignDraftProvenancePages(drafts, pages);
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === "ready") return <CheckCircle2 size={ICON_SIZE.emphasis} style={{ color: "var(--grade-green)" }} />;
  if (status === "needs-review" || status === "no-text" || status === "error") return <AlertTriangle size={ICON_SIZE.emphasis} style={{ color: "var(--grade-orange)" }} />;
  if (status === "extracting" || status === "parsing") return <RefreshCw size={ICON_SIZE.emphasis} className="spin" />;
  return <FileUp size={ICON_SIZE.emphasis} className="dim" />;
}

function StatusTag({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { label: string; tone: "green" | "orange" | "red" | "neutral" | "cyan" }> = {
    queued: { label: "queued", tone: "neutral" },
    extracting: { label: "extracting", tone: "cyan" },
    parsing: { label: "parsing", tone: "cyan" },
    ready: { label: "ready to inspect", tone: "green" },
    "needs-review": { label: "needs review", tone: "orange" },
    "answer-source": { label: "answers matched", tone: "cyan" },
    "no-text": { label: "no text (scan)", tone: "orange" },
    error: { label: "no questions", tone: "red" },
  };
  const meta = map[status];
  return <Tag tone={meta.tone}>{meta.label}</Tag>;
}
