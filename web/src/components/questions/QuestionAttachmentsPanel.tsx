// ===========================================================================
// Question-note image attachments (Q2b-2): restrained gallery under the note.
// Bytes live in the questionAttachmentBlobs IndexedDB store; this component
// only ever holds object URLs (revoked on cleanup) and metadata.
// ===========================================================================
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { captureQuestionWorkspace } from "../../lib/questionNoteImages";
import {
  createQuestionAttachment,
  deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob,
  isPrivateLibraryAttachmentBlobKey,
  MAX_QUESTION_ATTACHMENTS,
  type QuestionImageAttachment,
} from "../../lib/questionAttachments";

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
  onChange: (next: QuestionImageAttachment[]) => void | Promise<unknown>;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const [preview, setPreview] = useState<QuestionImageAttachment | null>(null);
  const [urls, setUrls] = useState<Record<string, string | "missing">>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Load thumbnails as object URLs; revoke on question change and unmount.
  // Keyed on the set of blobs (id + blobKey) only — editing alt text must not
  // revoke and re-read every blob (which would flicker thumbnails and briefly
  // reference a revoked object URL).
  const blobSignature = attachments.map((a) => `${a.id}:${a.blobKey}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string | "missing"> = {};
      for (const attachment of attachmentsRef.current) {
        try {
          const record = await getQuestionAttachmentBlob(attachment.blobKey);
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
      if (!cancelled) setUrls(next);
      else created.forEach((url) => URL.revokeObjectURL(url));
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [questionId, blobSignature]);

  useEffect(() => {
    setPreview(null); setStatus(""); setBusy(false); busyRef.current = false;
    return () => { generation.current += 1; };
  }, [questionId]);

  async function addFiles(files: readonly File[]) {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    const started = generation.current;
    const scope = captureQuestionWorkspace();
    setBusy(true);
    const failures: string[] = [];
    let added = 0;
    // Deterministic: original selection order; one failure never discards the rest.
    try { for (const file of files) {
      scope.assertCurrent();
      if (generation.current !== started) break;
      const result = await createQuestionAttachment({
        file,
        questionId,
        existing: attachmentsRef.current,
      });
      if (result.status === "created") {
        const next = [...attachmentsRef.current, result.attachment];
        try {
          scope.assertCurrent();
          if (generation.current !== started) break;
          await onChange(next);
          scope.assertCurrent();
          if (generation.current !== started) break;
          attachmentsRef.current = next;
          added += 1;
        } catch {
          // A failed acknowledgement does not prove metadata was unwritten.
          // Retain the bytes so retry/recovery can never create a broken image.
          failures.push(`"${result.attachment.fileName}" save could not be confirmed. Its image bytes were kept; retry before leaving.`);
        }
      } else {
        failures.push(result.message);
      }
    } } catch (error) {
      failures.push(error instanceof Error ? error.message : "Image save could not be confirmed.");
    } finally { scope.dispose(); if (generation.current === started) busyRef.current = false; }
    if (generation.current !== started) return;
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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const started = generation.current;
    try {
    // Metadata first (authoritative), then the blob; a failed blob delete is
    // surfaced and the sweep can finish the cleanup later.
    const next = attachmentsRef.current.filter((item) => item.id !== attachment.id);
    await onChange(next);
    if (generation.current !== started) return;
    attachmentsRef.current = next;
    if (preview?.id === attachment.id) setPreview(null);
    if (isPrivateLibraryAttachmentBlobKey(attachment.blobKey)) {
      setStatus(`Removed "${attachment.fileName}".`);
      return;
    }
    try {
      await deleteQuestionAttachmentBlobs([attachment.blobKey]);
      setStatus(`Removed "${attachment.fileName}".`);
    } catch {
      setStatus(`Removed "${attachment.fileName}" from this question; its stored bytes will be cleaned up on the next maintenance pass.`);
    }
    } catch {
      if (generation.current === started) setStatus(`Removal of "${attachment.fileName}" could not be confirmed. Its image bytes were kept.`);
    } finally {
      if (generation.current === started) busyRef.current = false;
      if (generation.current === started) setBusy(false);
    }
  }

  async function updateAltText(attachment: QuestionImageAttachment, altText: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const started = generation.current;
    const now = new Date().toISOString();
    const next = attachmentsRef.current.map((item) =>
      item.id === attachment.id ? { ...item, altText: altText.trim().slice(0, 500), updatedAt: now } : item);
    try {
      await onChange(next);
      if (generation.current === started) attachmentsRef.current = next;
    } catch {
      if (generation.current === started) setStatus("Description save could not be confirmed. Retry before leaving.");
    } finally {
      if (generation.current === started) busyRef.current = false;
      if (generation.current === started) setBusy(false);
    }
  }

  function openPreview(attachment: QuestionImageAttachment, trigger: HTMLElement) {
    previewTriggerRef.current = trigger;
    setPreview(attachment);
  }

  function closePreview() {
    setPreview(null);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    window.setTimeout(() => trigger?.focus(), 0);
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
                  <input
                    className="field question-attachment-alt"
                    type="text"
                    key={`${questionId}:${attachment.id}:${attachment.updatedAt}`}
                    defaultValue={attachment.altText}
                    disabled={busy}
                    placeholder="Description not added"
                    aria-label={`Description for ${attachment.fileName}`}
                    onBlur={(event) => { if (event.target.value !== attachment.altText) void updateAltText(attachment, event.target.value); }}
                  />
                </div>
                <GhostButton
                  className="icon-only"
                  aria-label={`Remove ${attachment.fileName}`}
                  disabled={busy}
                  onClick={() => void removeAttachment(attachment)}
                >
                  <Trash2 size={ICON_SIZE.body} />
                </GhostButton>
              </li>
            );
          })}
        </ul>
      )}
      <span className="sub" role="status" aria-live="polite">{status}</span>

      {preview && (
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
