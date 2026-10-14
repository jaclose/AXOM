import { describe, expect, it, vi } from "vitest";
import { extractCompletePdfSource, MAX_PDF_SOURCE_PAGES } from "./extractCompletePdfSource";
import type * as PdfJs from "pdfjs-dist";

function fakePdf(pages: string[]) {
  const cleanup = vi.fn(async () => {});
  const destroy = vi.fn(async () => {});
  const getPage = vi.fn(async (number: number) => ({
    getTextContent: async () => ({ items: [{ str: pages[number - 1], transform: [0, 0, 0, 0, 0, 9] }] }),
  }));
  const pdf = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({ promise: Promise.resolve({ numPages: pages.length, getPage, cleanup }), destroy }),
  } as unknown as typeof PdfJs;
  return { pdf, cleanup, destroy, getPage };
}

describe("large source PDFs must not silently lose final questions", () => {
  it("scans all pages despite the 400k document-preview cap, reports page progress, and releases resources", async () => {
    const pages = [...Array.from({ length: 9 }, (_, index) => `Page ${index + 1} ${"long vignette text ".repeat(2800)}`),
      "10. Which nephron segment?\nA. Proximal tubule\nB. Collecting duct\nAnswer: B"];
    const { pdf, cleanup, destroy, getPage } = fakePdf(pages);
    const progress: number[] = [];
    const result = await extractCompletePdfSource(new ArrayBuffer(2), ({ readPages }) => progress.push(readPages), pdf);
    expect(result.totalPages).toBe(10);
    expect(result.pages[9]).toContain("Which nephron");
    expect(result.text).toContain("Collecting duct");
    expect(result.text.length).toBeGreaterThan(400_000);
    expect(result.previewText).not.toContain("Which nephron");
    expect(result.previewText).toHaveLength(400_000);
    expect(result.previewTruncated).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/All 10 PDF pages were scanned/);
    expect(progress).toEqual([1, 5, 10]);
    expect(getPage).toHaveBeenCalledTimes(10);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("rejects overlong PDFs before reading any page and cleans up", async () => {
    const pages = Array.from({ length: MAX_PDF_SOURCE_PAGES + 1 }, () => "question");
    const { pdf, cleanup, destroy, getPage } = fakePdf(pages);
    await expect(extractCompletePdfSource(new ArrayBuffer(2), undefined, pdf)).rejects.toThrow(/1201 pages/);
    expect(getPage).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
  it("does not claim OCR for image-only PDFs", async () => {
    const { pdf } = fakePdf(["", "", ""]);
    const result = await extractCompletePdfSource(new ArrayBuffer(2), undefined, pdf);
    expect(result.empty).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no extractable digital text/)]));
  });
  it("rejects PDF bytes above resource cap before opening", async () => {
    const { pdf, getPage } = fakePdf(["question"]);
    const tooLarge = { byteLength: 129 * 1024 * 1024 } as ArrayBuffer;
    await expect(extractCompletePdfSource(tooLarge, undefined, pdf)).rejects.toThrow(/128 MB/);
    expect(getPage).not.toHaveBeenCalled();
  });
});