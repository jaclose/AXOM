import { useEffect, useRef, useState } from "react";
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Original PDF inspection remains strictly in import review. Nothing here
 * becomes a scored-practice attachment or a verified answer automatically. */
export function BankImportSourcePage({ originalFile, sourceName, sourcePage }: {
  originalFile?: Blob;
  sourceName: string;
  sourcePage?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [requestedPage, setRequestedPage] = useState(sourcePage && sourcePage > 0 ? sourcePage : 1);
  const [totalPages, setTotalPages] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setRequestedPage(sourcePage && sourcePage > 0 ? sourcePage : 1);
    setExpanded(false);
    setError("");
  }, [sourceName, sourcePage]);
  useEffect(() => {
    if (!expanded || !originalFile) return;
    let closed = false;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        if (originalFile.size > 128 * 1024 * 1024) throw new Error("This PDF exceeds 128 MB. Split the source to inspect pages.");
        const pdfjs = await import("pdfjs-dist");
        if (closed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = browserPdfWorkerUrl;
        const bytes = new Uint8Array(await originalFile.arrayBuffer());
        if (closed) return;
        loadingTask = pdfjs.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (closed) return;
        setTotalPages(doc.numPages);
        if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > doc.numPages)
          throw new Error("That page does not exist in the original PDF.");
        const page = await doc.getPage(requestedPage);
        const initial = page.getViewport({ scale: 1 });
        const scale = Math.min(1.6, 1800 / initial.width, Math.sqrt(8_000_000 / (initial.width * initial.height)));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot render the source PDF page.");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch (reason) {
        if (!closed) setError(reason instanceof Error ? reason.message : "This source page could not be drawn.");
      } finally {
        if (!closed) setLoading(false);
        if (loadingTask) await loadingTask.destroy().catch(() => undefined);
      }
    })();
    return () => { closed = true; void loadingTask?.destroy().catch(() => undefined); };
  }, [expanded, originalFile, requestedPage]);
  if (!originalFile || !sourceName.toLowerCase().endsWith(".pdf")) return null;
  return <section className="stack gap8" aria-label="Original PDF source page">
    <p className="sub">Original-source visual check: open the actual PDF page to verify diagrams, histology, ECGs, tables and marked answers before approving an extraction. This page is never shown during scored practice.</p>
    <div className="row wrap gap8">
      <label>Source page <input type="number" min={1} max={totalPages ?? undefined}
        value={requestedPage} aria-label="Original PDF page number"
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value >= 1) setRequestedPage(value);
        }} /></label>
      {totalPages && <span className="sub">of {totalPages}</span>}
      <button type="button" className="gbtn" onClick={() => setExpanded(value => !value)}>
        {expanded ? "Hide original PDF" : "View original PDF page"}
      </button>
    </div>
    {expanded && <>
      {loading && <p role="status">Drawing source page {requestedPage}…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="qcontent-table-scroll" style={{ maxHeight: 720 }}>
        <canvas ref={canvasRef} role="img" aria-label={"Original PDF page " + requestedPage} style={{ display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" }} />
      </div>
    </>}
  </section>;
}
