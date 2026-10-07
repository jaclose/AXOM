import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readSourceOriginal, saveSourceOriginal } from "../../lib/decode";
import { ICON_SIZE } from "../../lib/iconSize";
import type { SourceDocument } from "../../lib/library";
import { GhostButton } from "../ui/primitives";

type PreviewState = "opening" | "drawn" | "no-original" | "failed";

/**
 * One page of a source as it was drawn, from the original file kept on this
 * device (lib/decode/sources). When the file is not here, the learner can
 * attach it; the page's saved text is offered either way.
 */
export function SourcePagePreview({ document: source, page }: {
  document: Pick<SourceDocument, "id" | "title" | "checksum" | "pageTexts">;
  page: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PreviewState>("opening");
  const [problem, setProblem] = useState("");
  /** Bumped when a file is attached, so the page is drawn from it. */
  const [attached, setAttached] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let release: (() => Promise<void>) | undefined;
    setState("opening");
    setProblem("");
    void (async () => {
      const original = await readSourceOriginal(source.id);
      if (cancelled) return;
      if (!original) { setState("no-original"); return; }
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ data: await original.arrayBuffer() });
      release = () => task.destroy();
      const pdf = await task.promise;
      if (cancelled) return;
      if (page > pdf.numPages) throw new Error(`This file has ${pdf.numPages} pages, so it has no page ${page}.`);
      const sheet = await pdf.getPage(page);
      const natural = sheet.getViewport({ scale: 1 });
      // Sharp enough to read labels on a wide screen, small enough to draw at once.
      const viewport = sheet.getViewport({ scale: Math.min(2, 1200 / natural.width) });
      const target = canvas.current;
      const context = target?.getContext("2d");
      if (!target || !context || cancelled) return;
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      await sheet.render({ canvas: target, canvasContext: context, viewport }).promise;
      if (!cancelled) setState("drawn");
    })().catch((error: unknown) => {
      if (cancelled) return;
      setProblem(error instanceof Error ? error.message : "This page could not be drawn.");
      setState("failed");
    });
    return () => {
      cancelled = true;
      void release?.();
    };
  }, [source.id, page, attached]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setProblem("");
    try {
      await saveSourceOriginal(source, file);
      setAttached((count) => count + 1);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The file could not be attached.");
    }
  }

  const pageText = source.pageTexts?.[page - 1]?.trim();
  return (
    <figure className="source-page-preview">
      <figcaption className="source-line"><b>{source.title}</b><span>page {page}</span></figcaption>
      {state === "opening" && <p className="sub" role="status">Opening the page…</p>}
      {problem && <p className="source-page-problem" role="alert">{problem}</p>}
      {state === "no-original" && (
        <div className="source-page-missing">
          <p className="sub">The original file is not on this device, so the page cannot be shown as it was drawn. Its saved text is below.</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            aria-label={`Attach the original file of ${source.title}`}
            className="visually-hidden-input"
            onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }}
          />
          <GhostButton onClick={() => fileInput.current?.click()}><FileUp size={ICON_SIZE.body} /> Attach the original file</GhostButton>
        </div>
      )}
      <canvas ref={canvas} hidden={state !== "drawn"} role="img" aria-label={`${source.title}, page ${page}`} />
      {pageText && (
        <details className="source-evidence" open={state === "no-original" || state === "failed"}>
          <summary>Text of this page</summary>
          <div className="source-evidence-body"><pre>{pageText}</pre></div>
        </details>
      )}
    </figure>
  );
}
