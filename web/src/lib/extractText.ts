// ===========================================================================

import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// Document text extraction (Import Center layer 1). PDF via pdfjs-dist
// (digital text layer only — a scanned/image PDF yields no text and we say so
// honestly; OCR remains future work). DOCX via mammoth. Both libraries load
// lazily so the main bundle stays lean. Extraction returns per-page text where
// the format has pages, letting parsed questions carry a source page.
// ===========================================================================

export interface ExtractedText {
  /** Per-page text (PDF) or a single element (DOCX/TXT). */
  pages: string[];
  /** Joined convenience form. */
  text: string;
  /** True when the file opened fine but contained no extractable text. */
  empty: boolean;
  warnings: string[];
}

/** Rough cap on stored raw text so a giant textbook can't bloat the vault. */
export const RAW_TEXT_CAP = 400_000;

export interface PdfExtractionOptions {
  /** Larger reviewed corpora opt in; ordinary imports keep their existing cap. */
  maxCharacters?: number;
  onProgress?: (page: number, total: number) => void;
  signal?: AbortSignal;
}

/** TXT/Markdown extraction keeps author line breaks intact; only newline
 * encoding and the storage cap are normalized. */
export function extractPlainText(raw: string): ExtractedText {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const warnings: string[] = [];
  if (!normalized.trim()) warnings.push("No text found in this file.");
  if (normalized.length > RAW_TEXT_CAP) {
    warnings.push(`Text truncated at ${Math.round(RAW_TEXT_CAP / 1000)}k characters to protect local storage.`);
  }
  const text = normalized.slice(0, RAW_TEXT_CAP);
  return { pages: [text], text, empty: !text.trim(), warnings };
}

export async function extractPdfText(
  buffer: ArrayBuffer,
  pdfjsOverride?: typeof import("pdfjs-dist"),
  workerSrcOverride?: string,
  options: PdfExtractionOptions = {},
): Promise<ExtractedText> {
  // Tests may inject pdf.js's legacy Node adapter. Production imports only the
  // modern browser build, keeping the extra legacy runtime out of the app.
  const pdfjs = pdfjsOverride ?? await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrcOverride ?? browserPdfWorkerUrl;

  const warnings: string[] = [];
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  const cap = options.maxCharacters ?? RAW_TEXT_CAP;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      options.signal?.throwIfAborted();
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Rebuild line structure from item positions: a new baseline = new line.
      let lastY: number | null = null;
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
        else if (text && !text.endsWith("\n") && !text.endsWith(" ")) text += " ";
        text += item.str;
        lastY = y;
      }
      pages.push(text.trim());
      page.cleanup();
      options.onProgress?.(p, doc.numPages);
    }
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }

  const joined = pages.join("\n\n").trim();
  if (!joined) {
    warnings.push(
      "This PDF has no extractable text layer — it's likely a scan or image export. OCR isn't available in-app yet; the file is kept as a source record.",
    );
  }
  if (joined.length > cap) {
    warnings.push(`Text truncated at ${Math.round(cap / 1000)}k characters to protect local storage.`);
  }
  return {
    pages: capPages(pages, cap),
    text: joined.slice(0, cap),
    empty: !joined,
    warnings,
  };
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<ExtractedText> {
  const mammoth = await import("mammoth");
  const warnings: string[] = [];
  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: ArrayBuffer): Uint8Array };
  }).Buffer;
  const input = nodeBuffer ? { buffer: nodeBuffer.from(buffer) } : { arrayBuffer: buffer };
  const result = await mammoth.extractRawText(input as Parameters<typeof mammoth.extractRawText>[0]);
  for (const message of result.messages ?? []) {
    if (message.message) warnings.push(message.message);
  }
  const text = (result.value ?? "").trim();
  if (!text) warnings.push("No text found in this DOCX file.");
  if (text.length > RAW_TEXT_CAP) {
    warnings.push(`Text truncated at ${Math.round(RAW_TEXT_CAP / 1000)}k characters to protect local storage.`);
  }
  return { pages: [text.slice(0, RAW_TEXT_CAP)], text: text.slice(0, RAW_TEXT_CAP), empty: !text, warnings: warnings.slice(0, 5) };
}

function capPages(pages: string[], limit = RAW_TEXT_CAP): string[] {
  let budget = limit;
  const out: string[] = [];
  for (const page of pages) {
    if (budget <= 0) break;
    out.push(page.slice(0, budget));
    budget -= page.length;
  }
  return out;
}
