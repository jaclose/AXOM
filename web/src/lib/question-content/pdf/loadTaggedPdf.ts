// ===========================================================================
// Opens a PDF with pdf.js and hands back what the tagged reader needs from
// each page: the structure tree, the text with its marked-content ids, and
// where embedded pictures are drawn. The same code runs in the browser and,
// with pdf.js's legacy build, in Node.
// ===========================================================================
import { imageBoxes } from "../../pdfFigures";
import type { StructNode, TaggedPageInput, TextItem } from "./taggedPdf";

type PdfJs = typeof import("pdfjs-dist");

export interface LoadedPdf {
  pages: TaggedPageInput[];
  /** True when the file carries a structure tree with content in it. */
  tagged: boolean;
  /** The program that made the file, as the file says. */
  creator?: string;
  /** Slides, not pages of a document: read by position, not by tag order. */
  slides: boolean;
}

const SLIDE_MAKERS = /powerpoint|keynote|impress|google slides|slides/i;

const hasContent = (node: StructNode | null): boolean => Boolean(node && (node.type === "content" || (node.children ?? []).some(hasContent)));

export async function loadTaggedPdf(pdfjs: PdfJs, data: Uint8Array): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const metadata = await doc.getMetadata().catch(() => undefined);
    const creator = (metadata?.info as { Creator?: string } | undefined)?.Creator;
    const pages: TaggedPageInput[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const [tree, content, operators] = await Promise.all([
        page.getStructTree().catch(() => null),
        page.getTextContent({ includeMarkedContent: true }),
        page.getOperatorList(),
      ]);
      pages.push({
        page: number,
        width: viewport.width,
        height: viewport.height,
        tree: (tree as StructNode | null) ?? null,
        items: content.items as unknown as TextItem[],
        imageBoxes: imageBoxes(operators, pdfjs.OPS, viewport.transform),
      });
    }
    const slides = creator ? SLIDE_MAKERS.test(creator) : pages.length > 0 && pages.every((page) => page.width > page.height);
    for (const page of pages) page.slide = slides;
    return { pages, tagged: pages.some((page) => hasContent(page.tree)), ...(creator ? { creator } : {}), slides };
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
}
