// The images that are part of a question (an ECG, a slide, a graph): shown
// with the stem, before answering, and enlarged on click. Bytes come from the
// questionAttachmentBlobs store; this only ever holds object URLs.
import { useEffect, useRef, useState } from "react";
import { ZoomIn } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useQuestionAttachmentScope } from "./useQuestionAttachmentScope";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionImageViewer } from "./QuestionImageViewer";

export function QuestionExhibits({ attachments }: { attachments: readonly QuestionImageAttachment[] }) {
  // Keep image object URLs and the modal scoped to the exact attachment keys.
  // Imported questions may reuse IDs across accounts/workspaces with different bytes.
  const [loaded, setLoaded] = useState<{ signature: string; urls: Record<string, string | "missing" | "unavailable"> }>({ signature: "", urls: {} });
  const [zoomed, setZoomed] = useState<{ signature: string; id: string } | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  // A structured tuple array prevents delimiter collisions between distinct attachment IDs / blob keys.
  // The blob may be rehydrated under its stable key; a newer metadata revision must invalidate old object URLs.
  const accountScope = useQuestionAttachmentScope();
  const signature = JSON.stringify([accountScope.owner, accountScope.generation, attachments.map(({ id, blobKey, updatedAt }) => [id, blobKey, updatedAt])]);
  const urls = loaded.signature === signature ? loaded.urls : Object.create(null) as Record<string, string | "missing" | "unavailable">;
  // Resolve the viewer against current metadata, never the object captured when
  // it opened. Metadata-only edits must update the accessible name without
  // reallocating private blob URLs or resetting the viewer zoom/focus.
  const activeZoomed = zoomed?.signature === signature
    ? attachments.find(attachment => attachment.id === zoomed.id) ?? null
    : null;
  const zoomSignature = zoomed?.signature ?? null;
  const signatureRef = useRef(signature);
  signatureRef.current = signature;

  useEffect(() => {
    // Do not reopen an old image if the previous signature later returns.
    setZoomed(previous => previous?.signature === signature ? previous : null);
  }, [signature]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string | "missing" | "unavailable"> = Object.create(null);
      for (const attachment of attachmentsRef.current) {
        const record = await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined);
        // Cleanup may run while the blob read is pending; do not create an orphaned URL afterward.
        if (cancelled) return;
        if (record) {
          try {
            const url = URL.createObjectURL(record.blob);
            created.push(url);
            next[attachment.id] = url;
          } catch {
            // A failed browser allocation must not suppress or leak adjacent exhibits.
            next[attachment.id] = "unavailable";
          }
        } else {
          next[attachment.id] = "missing";
        }
      }
      if (!cancelled) setLoaded({ signature, urls: next });
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [signature]);

  if (!attachments.length) return null;
  const zoomedUrl = activeZoomed ? urls[activeZoomed.id] : undefined;
  return (
    <div className="question-exhibits" role="group" aria-label={attachments.length === 1 ? "Question image" : "Question images"}>
      {attachments.map((attachment, index) => {
        const url = urls[attachment.id];
        const label = attachment.altText || (attachments.length === 1 ? "Question image" : `Question image ${index + 1}`);
        if (url === "missing" || url === "unavailable") {
          return <p key={attachment.id} className="question-exhibit-missing">{url === "missing"
            ? `${attachment.fileName} is not on this device.`
            : `${attachment.fileName} could not be displayed on this device.`}</p>;
        }
        return (
          <button key={attachment.id} type="button" className="question-exhibit" disabled={!url}
            aria-label={`Enlarge ${label}`}
            onClick={(event) => { event.currentTarget.focus(); setZoomed({ signature, id: attachment.id }); }}>
            {url ? <img src={url} alt={label} width={attachment.width} height={attachment.height} /> : <span className="question-exhibit-loading" aria-hidden="true" />}
            <span className="question-exhibit-zoom" aria-hidden="true"><ZoomIn size={ICON_SIZE.body} /></span>
          </button>
        );
      })}
      {activeZoomed && zoomedUrl && zoomedUrl !== "missing" && zoomedUrl !== "unavailable" && (
        <QuestionImageViewer key={`${zoomSignature}:${activeZoomed.id}`} src={zoomedUrl}
          alt={activeZoomed.altText || "Question image"} width={activeZoomed.width} height={activeZoomed.height}
          onClose={() => setZoomed(null)} shouldRestoreFocus={() => signatureRef.current === zoomSignature} />
      )}
    </div>
  );
}
