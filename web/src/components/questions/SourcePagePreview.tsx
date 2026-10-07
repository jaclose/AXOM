import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readOriginalPdf, saveOriginalPdf, sourceChecksum } from "../../lib/decodeSources";
import { useStore } from "../../lib/store";

export function SourcePagePreview({ documentId, page }: { documentId: string; page: number }) {
  const source = useStore((s) => s.documents.find((doc) => doc.id === documentId));
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revision, setRevision] = useState(0);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState("Opening source page…");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let destroy: (() => Promise<void>) | undefined;
    setMissing(false); setError(""); setStatus("Opening source page…");
    void (async () => {
      const blob = await readOriginalPdf(documentId);
      if (disposed) return;
      if (!blob) { setMissing(true); setStatus(""); return; }
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
      destroy = () => task.destroy();
      const pdf = await task.promise;
      if (disposed) { await task.destroy(); return; }
      const sourcePage = await pdf.getPage(page);
      const original = sourcePage.getViewport({ scale: 1 });
      const viewport = sourcePage.getViewport({ scale: Math.min(2, 1200 / original.width) });
      const target = canvas.current;
      if (!target || disposed) return;
      target.width = viewport.width; target.height = viewport.height;
      await sourcePage.render({ canvas: target, viewport }).promise;
      if (!disposed) setStatus("");
    })().catch((cause: unknown) => {
      if (!disposed) { setStatus(""); setError(cause instanceof Error ? cause.message : "This source page could not be rendered."); }
    });
    return () => { disposed = true; void destroy?.(); };
  }, [documentId, page, revision]);

  async function attach(file?: File) {
    if (!file) return;
    try {
      if (!source?.checksum) throw new Error("This source has no fingerprint to verify the original. Re-import it through Decode.");
      if (await sourceChecksum(await file.arrayBuffer()) !== source.checksum) throw new Error("This is a different PDF version. Choose the exact original to preserve page references.");
      await saveOriginalPdf(documentId, file); setRevision((n) => n + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The PDF could not be attached."); }
  }

  return <figure className="decode-source-preview">
    <figcaption>{source?.title ?? "Source document"} · page {page}</figcaption>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {missing && <div className="decode-source-missing"><p>The original PDF is not attached on this device. Saved text and references are still available.</p>
      <label className="gbtn">Attach original PDF<input type="file" accept="application/pdf" onChange={(event) => void attach(event.target.files?.[0])} /></label>
    </div>}
    <canvas ref={canvas} hidden={missing || Boolean(error) || Boolean(status)} role="img" aria-label={`Original source page ${page}`} />
    {source?.pageTexts?.[page - 1] && <details><summary>Source text</summary><p className="decode-source-text">{source.pageTexts[page - 1]}</p></details>}
  </figure>;
}
