// ===========================================================================
// Question-note image attachments (Q2b-2): restrained gallery under the note.
// Bytes live in the questionAttachmentBlobs IndexedDB store; this component
// only ever holds object URLs (revoked on cleanup) and metadata.
// ===========================================================================
import { useEffect, useId, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { GButton, GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import {
  createQuestionAttachment,
  deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob,
  isPrivateLibraryAttachmentBlobKey,
  MAX_QUESTION_ATTACHMENTS,
  restoreMissingQuestionAttachment,
  validateMissingQuestionAttachmentFile,
  type QuestionImageAttachment,
} from "../../lib/questionAttachments";
import { useQuestionAttachmentScope } from "./useQuestionAttachmentScope";
import { isQuestionAttachmentScopeCurrent } from "../../lib/questionAttachmentScope";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function QuestionAttachmentsPanel({
  questionId,
  attachments,
  onChange,
}: {
  questionId: string;
  attachments: QuestionImageAttachment[];
  onChange: (next: QuestionImageAttachment[]) => void;
}) {
  const scope = useQuestionAttachmentScope();
  const [uiScope, setUiScope] = useState(scope);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<QuestionImageAttachment | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<QuestionImageAttachment | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<{ attachment: QuestionImageAttachment; file: File; url: string } | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [repairRevision, setRepairRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ signature: string; urls: Record<string, string | "missing"> }>({ signature: "", urls: {} });
  const restoreTitleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const restoreTargetRef = useRef<QuestionImageAttachment | null>(null);
  const restoreTriggerRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Load thumbnails as object URLs; revoke on question change and unmount.
  // Keyed on the set of blobs (id + blobKey) only — editing alt text must not
  // revoke and re-read every blob (which would flicker thumbnails and briefly
  // reference a revoked object URL).
  const blobSignature = JSON.stringify([scope.owner, scope.generation, questionId, attachments.map(a => [a.id, a.blobKey, a.updatedAt])]);
  const urls = loaded.signature === blobSignature ? loaded.urls : {};
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string | "missing"> = {};
      for (const attachment of attachmentsRef.current) {
        try {
          const record = await getQuestionAttachmentBlob(attachment.blobKey);
          if (cancelled) return;
          if (record) {
            const url = URL.createObjectURL(record.blob);
            created.push(url);
            next[attachment.id] = url;
          } else {
            next[attachment.id] = "missing";
          }
        } catch {
          next[attachment.id] = "missing";
        }
      }
      if (!cancelled) setLoaded({ signature: blobSignature, urls: next });
      else created.forEach((url) => URL.revokeObjectURL(url));
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [questionId, blobSignature, repairRevision]);

  useEffect(() => {
    setUiScope(scope);
    setBusy(false);
    setPreview(null);
    setRestoreCandidate(null);
    setRestoreTarget(null);
    restoreTargetRef.current = null;
    setRestoreError("");
    setStatus("");
  }, [questionId, scope]);

  useEffect(() => () => {
    if (restoreCandidate) URL.revokeObjectURL(restoreCandidate.url);
  }, [restoreCandidate]);

  async function addFiles(files: readonly File[]) {
    if (!files.length || busy || !isQuestionAttachmentScopeCurrent(scope)) return;
    setBusy(true);
    const failures: string[] = [];
    let added = 0;
    // Deterministic: original selection order; one failure never discards the rest.
    for (const file of files) {
      if (!isQuestionAttachmentScopeCurrent(scope)) return;
      const result = await createQuestionAttachment({
        file,
        questionId,
        existing: attachmentsRef.current,
      });
      if (!isQuestionAttachmentScopeCurrent(scope)) return;
      if (result.status === "created") {
        const next = [...attachmentsRef.current, result.attachment];
        try {
          onChange(next);
          attachmentsRef.current = next;
          added += 1;
        } catch {
          // Metadata persistence failed — remove the just-written blob so no
          // orphan survives, then surface the failure.
          await deleteQuestionAttachmentBlobs([result.attachment.blobKey], { scope }).catch(() => {});
          failures.push(`"${result.attachment.fileName}" could not be saved.`);
        }
      } else {
        failures.push(result.message);
      }
    }
    setBusy(false);
    setStatus([
      added ? `${added} image${added === 1 ? "" : "s"} attached.` : "",
      ...failures,
    ].filter(Boolean).join(" "));
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPaste(event: ClipboardEvent) {
    const images = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!images.length) return; // normal text paste passes through untouched
    event.preventDefault();
    void addFiles(images);
  }

  async function removeAttachment(attachment: QuestionImageAttachment) {
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    // Metadata first (authoritative), then the blob; a failed blob delete is
    // surfaced and the sweep can finish the cleanup later.
    const next = attachmentsRef.current.filter((item) => item.id !== attachment.id);
    onChange(next);
    attachmentsRef.current = next;
    if (preview?.id === attachment.id) setPreview(null);
    if (isPrivateLibraryAttachmentBlobKey(attachment.blobKey)) {
      setStatus(`Removed "${attachment.fileName}".`);
      return;
    }
    try {
      await deleteQuestionAttachmentBlobs([attachment.blobKey], { scope });
      if (!isQuestionAttachmentScopeCurrent(scope)) return;
      setStatus(`Removed "${attachment.fileName}".`);
    } catch {
      if (isQuestionAttachmentScopeCurrent(scope)) setStatus(`Removed "${attachment.fileName}" from this question. Its stored bytes were preserved because removal could not be confirmed.`);
    }
  }

  function updateAltText(attachment: QuestionImageAttachment, altText: string) {
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    const now = new Date().toISOString();
    const next = attachmentsRef.current.map((item) =>
      item.id === attachment.id ? { ...item, altText: altText.trim().slice(0, 500), updatedAt: now } : item);
    onChange(next);
    attachmentsRef.current = next;
  }

  function openPreview(attachment: QuestionImageAttachment, trigger: HTMLElement) {
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    previewTriggerRef.current = trigger;
    setPreview(attachment);
  }

  function closePreview() {
    setPreview(null);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    window.setTimeout(() => trigger?.focus(), 0);
  }

  function requestRestore(attachment: QuestionImageAttachment, trigger: HTMLElement) {
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    restoreTargetRef.current = attachment;
    restoreTriggerRef.current = trigger;
    setRestoreTarget(attachment);
    restoreFileRef.current?.click();
  }

  async function chooseRestoreFile(file: File | undefined) {
    const attachment = restoreTargetRef.current;
    if (!file || !attachment || busy) return;
    setBusy(true);
    const validation = await validateMissingQuestionAttachmentFile(file, attachment);
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    setBusy(false);
    if (!validation.ok) {
      setStatus(validation.message);
      return;
    }
    setRestoreError("");
    setStatus("");
    setRestoreCandidate({ attachment, file, url: URL.createObjectURL(file) });
  }

  function closeRestore() {
    setRestoreCandidate(null);
    setRestoreError("");
    setRestoreTarget(null);
    restoreTargetRef.current = null;
    const trigger = restoreTriggerRef.current;
    restoreTriggerRef.current = null;
    window.setTimeout(() => trigger?.focus(), 0);
  }

  async function confirmRestore() {
    if (!restoreCandidate || busy || !isQuestionAttachmentScopeCurrent(scope)) return;
    const { attachment, file } = restoreCandidate;
    const current = attachmentsRef.current.find((item) => item.id === attachment.id);
    if (!current || current.blobKey !== attachment.blobKey || current.byteSize !== attachment.byteSize) {
      setRestoreError("This question changed. Close this preview and choose the image again.");
      return;
    }
    setBusy(true);
    const result = await restoreMissingQuestionAttachment({ file, attachment: current, questionId });
    if (!isQuestionAttachmentScopeCurrent(scope)) return;
    setBusy(false);
    if (result.status !== "restored") {
      setRestoreError(result.message);
      return;
    }
    setRestoreCandidate(null);
    setRestoreTarget(null);
    restoreTargetRef.current = null;
    restoreTriggerRef.current = null;
    setRepairRevision((revision) => revision + 1);
    setStatus(`Restored "${attachment.fileName}" on this device. Your question was not changed.`);
    window.setTimeout(() => statusRef.current?.focus(), 0);
  }

  const previewUrl = preview ? urls[preview.id] : undefined;

  return (
    <div className="question-attachments" onPaste={onPaste}>
      <div className="question-attachments-head">
        <span className="field-label">Images</span>
        <GhostButton
          disabled={busy || attachments.length >= MAX_QUESTION_ATTACHMENTS}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={ICON_SIZE.body} /> {busy ? "Attaching…" : "Add image"}
        </GhostButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          aria-label="Attach images to this question"
          onChange={(event) => void addFiles([...(event.target.files ?? [])])}
        />
        <input
          ref={restoreFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          aria-label={restoreTarget ? `Choose original for ${restoreTarget.fileName}` : "Choose original question image"}
          onChange={(event) => {
            void chooseRestoreFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {attachments.length === 0 && (
        <p className="sub question-attachments-empty">Attach a slide screenshot or figure — or paste an image here.</p>
      )}
      {attachments.length > 0 && (
        <ul className="question-attachment-list">
          {attachments.map((attachment) => {
            const url = urls[attachment.id];
            return (
              <li key={attachment.id} className="question-attachment">
                {url && url !== "missing" ? (
                  <button
                    type="button"
                    className="question-attachment-thumb"
                    aria-label={`Preview ${attachment.fileName}`}
                    onClick={(event) => openPreview(attachment, event.currentTarget)}
                  >
                    <img src={url} alt={attachment.altText || `Attachment ${attachment.fileName}`} loading="lazy" />
                  </button>
                ) : (
                  <span className="question-attachment-thumb is-missing" role="img" aria-label={`${attachment.fileName} is unavailable`}>
                    {url === "missing" ? "Image missing" : "Loading…"}
                  </span>
                )}
                <div className="question-attachment-meta">
                  <span className="question-attachment-name" title={attachment.fileName}>{attachment.fileName}</span>
                  <span className="sub">{formatBytes(attachment.byteSize)}{attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : ""}</span>
                  {url === "missing" && !isPrivateLibraryAttachmentBlobKey(attachment.blobKey) && (
                    <GhostButton disabled={busy} aria-label={`Restore ${attachment.fileName}`}
                      onClick={(event) => requestRestore(attachment, event.currentTarget)}>
                      <RotateCcw size={ICON_SIZE.body} /> Restore image
                    </GhostButton>
                  )}
                  <input
                    className="field question-attachment-alt"
                    type="text"
                    value={attachment.altText}
                    placeholder="Description not added"
                    aria-label={`Description for ${attachment.fileName}`}
                    onChange={(event) => updateAltText(attachment, event.target.value)}
                  />
                </div>
                <GhostButton
                  className="icon-only"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={() => void removeAttachment(attachment)}
                >
                  <Trash2 size={ICON_SIZE.body} />
                </GhostButton>
              </li>
            );
          })}
        </ul>
      )}
      <span ref={statusRef} className="sub" role="status" aria-live="polite" tabIndex={-1}>{status}</span>

      {restoreCandidate && uiScope === scope && (
        <div className="question-attachment-lightbox" role="dialog" aria-modal="true"
          aria-labelledby={restoreTitleId}
          onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); closeRestore(); } }}>
          <div className="question-attachment-restore-card">
            <div className="question-attachment-lightbox-head">
              <h3 id={restoreTitleId}>Restore missing image</h3>
              <GhostButton className="icon-only" aria-label="Close image restore" autoFocus disabled={busy} onClick={closeRestore}>
                <X size={ICON_SIZE.body} />
              </GhostButton>
            </div>
            <p>Compare this preview with the original question image before saving it.</p>
            <img src={restoreCandidate.url} alt={`Selected file: ${restoreCandidate.file.name}`} />
            <p className="question-attachment-restore-file">{restoreCandidate.file.name} · {formatBytes(restoreCandidate.file.size)}
              {restoreCandidate.attachment.width && restoreCandidate.attachment.height
                ? ` · ${restoreCandidate.attachment.width}×${restoreCandidate.attachment.height}` : ""}</p>
            <p className="sub">The recorded file details match. AXOM cannot prove this is the same original image from those details alone.</p>
            {restoreError && <p role="alert" className="question-attachment-restore-error">{restoreError}</p>}
            <div className="question-attachment-restore-actions">
              <GhostButton disabled={busy} onClick={closeRestore}>Cancel</GhostButton>
              <GButton variant="primary" disabled={busy} onClick={() => void confirmRestore()}>
                {busy ? "Verifying…" : "Restore this image"}
              </GButton>
            </div>
          </div>
        </div>
      )}

      {preview && uiScope === scope && (
        <div
          className="question-attachment-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${preview.fileName}`}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closePreview(); } }}
        >
          <div className="question-attachment-lightbox-head">
            <span className="question-attachment-name">{preview.fileName}</span>
            <GhostButton className="icon-only" aria-label="Close preview" autoFocus onClick={closePreview}>
              <X size={ICON_SIZE.body} />
            </GhostButton>
          </div>
          {previewUrl && previewUrl !== "missing"
            ? <img src={previewUrl} alt={preview.altText || `Attachment ${preview.fileName}`} />
            : <span className="sub">This image is unavailable on this device.</span>}
          {preview.altText
            ? <p className="sub">{preview.altText}</p>
            : <p className="sub">Description not added</p>}
        </div>
      )}
    </div>
  );
}
