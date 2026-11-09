// The images that are part of a question (an ECG, a slide, a graph): shown
// with the stem, before answering, and enlarged on click. Bytes come from the
// questionAttachmentBlobs store; this only ever holds object URLs.
import { useEffect, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";

export function QuestionExhibits({ attachments }: { attachments: readonly QuestionImageAttachment[] }) {
  // Keep image object URLs and the modal scoped to the exact attachment keys.
  // Imported questions may reuse IDs across accounts/workspaces with different bytes.
  const [loaded, setLoaded] = useState<{ signature: string; urls: Record<string, string | "missing"> }>({ signature: "", urls: {} });
  const [zoomed, setZoomed] = useState<{ signature: string; attachment: QuestionImageAttachment } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const signature = attachments.map((attachment) => `${attachment.id}:${attachment.blobKey}`).join("|");
  const urls = loaded.signature === signature ? loaded.urls : {};
  const activeZoomed = zoomed?.signature === signature ? zoomed.attachment : null;
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
      const next: Record<string, string | "missing"> = {};
      for (const attachment of attachmentsRef.current) {
        const record = await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined);
        if (record) {
          const url = URL.createObjectURL(record.blob);
          created.push(url);
          next[attachment.id] = url;
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

  useEffect(() => {
    if (!activeZoomed) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        // This modal currently has one interactive control. Do not let Tab or
        // Shift+Tab move focus to the answer controls behind the open exhibit.
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.focus();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setZoomed(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // A switched question/account must not receive focus from A's old modal.
      if (signatureRef.current === zoomSignature) trigger.current?.focus();
    };
  }, [activeZoomed, zoomSignature]);

  if (!attachments.length) return null;
  const zoomedUrl = activeZoomed ? urls[activeZoomed.id] : undefined;
  return (
    <div className="question-exhibits" role="group" aria-label={attachments.length === 1 ? "Question image" : "Question images"}>
      {attachments.map((attachment, index) => {
        const url = urls[attachment.id];
        const label = attachment.altText || (attachments.length === 1 ? "Question image" : `Question image ${index + 1}`);
        if (url === "missing") {
          return <p key={attachment.id} className="question-exhibit-missing">{attachment.fileName} is not on this device.</p>;
        }
        return (
          <button key={attachment.id} type="button" className="question-exhibit" disabled={!url}
            aria-label={`Enlarge ${label}`}
            onClick={(event) => { trigger.current = event.currentTarget; setZoomed({ signature, attachment }); }}>
            {url ? <img src={url} alt={label} width={attachment.width} height={attachment.height} /> : <span className="question-exhibit-loading" aria-hidden="true" />}
            <span className="question-exhibit-zoom" aria-hidden="true"><ZoomIn size={ICON_SIZE.body} /></span>
          </button>
        );
      })}
      {activeZoomed && typeof zoomedUrl === "string" && (
        <div className="question-exhibit-lightbox" role="dialog" aria-modal="true" aria-label={activeZoomed.altText || "Question image, enlarged"} onClick={() => setZoomed(null)}>
          <button ref={closeRef} type="button" className="question-exhibit-close" aria-label="Close image" onClick={() => setZoomed(null)}><X size={ICON_SIZE.emphasis} aria-hidden="true" /></button>
          {/* A click on the image itself should not close it. */}
          <img src={zoomedUrl} alt={activeZoomed.altText || "Question image"} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
