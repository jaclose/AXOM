// A tagged PDF written by hand from invented content, opened with pdf.js: the
// one committed check that what pdf.js hands back is what the tagged reader
// expects. Real exports from Word and PowerPoint are only read on the machine
// that owns them.
import { describe, expect, it } from "vitest";
import { inventedQuestionPdf, taggedPdf, text } from "./buildTaggedPdf.testing";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";

describe("a tagged PDF opened with pdf.js", () => {
  it("comes back as pages the tagged reader turns into a question with its table and figure", async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
    const loaded = await loadTaggedPdf(pdfjs, inventedQuestionPdf());
    expect(loaded).toMatchObject({ tagged: true, slides: false, creator: "An invented word processor" });
    expect(loaded.pages).toHaveLength(1);

    const body = readTaggedPage(loaded.pages[0]);
    expect(body.order).toBe("tags");
    expect(body.elements.map((element) => element.kind)).toEqual(["paragraph", "table", "image", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(body.elements[1]).toEqual({ kind: "table", rows: [["Dose", "Level"], ["10 mg", "4 mg/L"]], headerRows: 1 });
    expect(body.figures).toEqual([{ left: 100, top: 232, width: 300, height: 180, alt: "An invented dose-response curve" }]);
    expect(body.coverage.tagged).toBe(body.coverage.all);

    const result = taggedPdfToQuestions({ pages: [body] }, { bankId: "invented-bank", sourceFilename: "invented.pdf" });
    expect(result.questions).toHaveLength(1);
    const [question] = result.questions;
    expect(question.stem.map((block) => block.type)).toEqual(["text", "table", "image", "text"]);
    expect(question.choices.map((choice) => choice.label)).toEqual(["A", "B", "C"]);
    expect(question.correctAnswer?.labels).toEqual(["A"]);
    expect(result.renders.get(question.assets[0].id)).toEqual({ page: 1, box: { left: 100, top: 232, width: 300, height: 180 } });
  });

  it("says so when a PDF has no tags, and calls a landscape file from a slide program slides", async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
    const untagged = await loadTaggedPdf(pdfjs, taggedPdf("An invented word processor", [], []));
    expect(untagged.tagged).toBe(false);
    const deck = await loadTaggedPdf(pdfjs, taggedPdf("Invented Slides 3", [{ role: "P" }], [{ role: "P", parent: 0, ops: text("A slide", 72, 700) }]));
    expect(deck).toMatchObject({ tagged: true, slides: true });
    expect(deck.pages[0].slide).toBe(true);
  });
});
