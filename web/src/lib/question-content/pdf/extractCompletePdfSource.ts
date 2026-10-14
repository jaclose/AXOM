// Browser import-only PDF text reader. The general library-document preview
// intentionally caps text at 400k chars; this reader MUST scan every page
// before parsing QBank candidates so late questions are never silently lost.
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { RAW_TEXT_CAP } from "../../extractText";

type PdfJs = typeof import("pdfjs-dist");
export interface PdfSourceRead {
  pages: string[];
  text: string;
  previewText: string;
  previewPages: string[];
  totalPages: number;
  empty: boolean;
  previewTruncated: boolean;
  warnings: string[];
}
export interface PdfSourceProgress { readPages: number; totalPages: number; }

export const MAX_PDF_SOURCE_PAGES = 1200;
export const MAX_PDF_SOURCE_CHARS = 10_000_000;

export async function extractCompletePdfSource(
  bytes: ArrayBuffer,
  onProgress?: (progress: PdfSourceProgress) => void,
  pdfjsOverride?: PdfJs,
  workerSrcOverride?: string,
): Promise<PdfSourceRead> {
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error("This PDF exceeds 128 MB. Split it into smaller source documents.");
  const pdfjs = pdfjsOverride ?? await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrcOverride ?? browserPdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  const pages: string[] = [];
  let readChars = 0;
  try {
    if (doc.numPages > MAX_PDF_SOURCE_PAGES) throw new Error(`This PDF has ${doc.numPages} pages (limit ${MAX_PDF_SOURCE_PAGES}). Split it to avoid an incomplete import.`);
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
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
      const pageText = text.trim();
      readChars += pageText.length;
      if (readChars > MAX_PDF_SOURCE_CHARS) {
        throw new Error(`This PDF contains more than ${MAX_PDF_SOURCE_CHARS.toLocaleString()} extracted characters. Split it before import; no partial questions were staged.`);
      }
      pages.push(pageText);
      if (number === 1 || number % 5 === 0 || number === doc.numPages) {
        onProgress?.({ readPages: number, totalPages: doc.numPages });
        // Keep interactions and user-visible progress responsive for large PDFs.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
  const text = pages.join("\n\n").trim();
  const previewText = text.slice(0, RAW_TEXT_CAP);
  const previewPages: string[] = [];
  let remaining = RAW_TEXT_CAP;
  for (const page of pages) {
    if (remaining <= 0) break;
    previewPages.push(page.slice(0, remaining));
    remaining -= page.length;
  }
  const previewTruncated = text.length > RAW_TEXT_CAP;
  const warnings = previewTruncated
    ? [`All ${pages.length} PDF pages were scanned for questions. The optional stored text preview is limited to ${RAW_TEXT_CAP.toLocaleString()} characters; the original PDF is retained.`]
    : [];
  if (!text) warnings.push("This PDF has no extractable digital text. Keep the original file for manual transcription; OCR is not included.");
  return { pages, text, previewText, previewPages, totalPages: pages.length, empty: !text, previewTruncated, warnings };
}
