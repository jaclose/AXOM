// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRawPdfForReview } from "../batchPreparePdf.ts";
import { createOcrImageOnlyPdf } from "./ocrImageOnlyPdf.local.mjs";

const leftovers = new Set();
afterEach(() => {
  for (const path of leftovers) rmSync(path, { recursive: true, force: true });
  leftovers.clear();
});

function temporaryDirectory(prefix) {
  const path = mkdtempSync(prefix);
  leftovers.add(path);
  return path;
}

describe("bounded local image-only PDF OCR", () => {
  it("accepts exactly 20 pages and refuses page 21 before creating temporary files", () => {
    const calls = [];
    let directories = 0;
    const ocr = createOcrImageOnlyPdf({
      makeTemporaryDirectory: () => { directories += 1; return "/private/tmp/axom-ocr-test"; },
      removeTemporaryDirectory: () => {},
      readFileStat: () => ({ size: 128 }),
      temporaryRoot: () => "/private/tmp",
      runFile: (command, args) => {
        calls.push([command, args]);
        return Buffer.from(command === "tesseract" ? "provisional page text" : "");
      },
    });

    const atCap = ocr("source.pdf", 20);
    expect(atCap.attempted).toBe(true);
    expect(atCap.pages).toHaveLength(20);
    expect(calls.filter(([command]) => command === "pdftoppm")).toHaveLength(20);
    expect(calls.filter(([command]) => command === "tesseract")).toHaveLength(20);

    const overCap = ocr("source.pdf", 21);
    expect(overCap).toMatchObject({ attempted: false, pages: [] });
    expect(overCap.notes.join(" ")).toMatch(/20-page opt-in OCR cap/);
    expect(directories).toBe(1);
    expect(calls).toHaveLength(40);
  });

  it("removes rendered pages when an OCR subprocess is unavailable", () => {
    let directory;
    const ocr = createOcrImageOnlyPdf({
      makeTemporaryDirectory: prefix => {
        directory = temporaryDirectory(prefix);
        return directory;
      },
      removeTemporaryDirectory: (path, options) => {
        rmSync(path, options);
        leftovers.delete(path);
      },
      readFileStat: statSync,
      temporaryRoot: tmpdir,
      runFile: (command, args) => {
        if (command === "pdftoppm") {
          writeFileSync(args.at(-1) + ".png", "synthetic page pixels");
          return Buffer.alloc(0);
        }
        throw new Error("spawnSync tesseract ENOENT");
      },
    });

    expect(() => ocr("source.pdf", 1)).toThrow(/Tesseract.*English language data/);
    expect(directory).toBeTypeOf("string");
    expect(existsSync(directory)).toBe(false);
  });

  it("returns successful OCR only as provisional page transcription and removes its raster files", () => {
    let directory;
    const ocr = createOcrImageOnlyPdf({
      makeTemporaryDirectory: prefix => {
        directory = temporaryDirectory(prefix);
        return directory;
      },
      removeTemporaryDirectory: (path, options) => {
        rmSync(path, options);
        leftovers.delete(path);
      },
      readFileStat: statSync,
      temporaryRoot: tmpdir,
      runFile: (command, args) => {
        if (command === "pdftoppm") {
          writeFileSync(args.at(-1) + ".png", "synthetic page pixels");
          return Buffer.alloc(0);
        }
        const page = args[0].match(/page-(\d+)\.png$/)?.[1];
        return Buffer.from(`  provisional transcription ${page}  \n`);
      },
    });

    const result = ocr("source.pdf", 2);
    expect(result).toMatchObject({
      attempted: true,
      pages: ["provisional transcription 001", "provisional transcription 002"],
    });
    expect(result.notes.join(" ")).toMatch(/side-by-side original-page review/);
    expect(result.notes.join(" ")).toMatch(/no correct answers are verified/);
    expect(existsSync(directory)).toBe(false);
  });

  it("cannot upgrade an OCR-derived answer candidate to practice-ready", async () => {
    const transcription = [
      "Question 1: Which class is the loop diuretic?",
      "A. Furosemide",
      "B. Chlorthalidone",
      "C. Acetazolamide",
      "Answer: A",
    ].join("\n");
    const ocr = createOcrImageOnlyPdf({
      makeTemporaryDirectory: () => "/private/tmp/axom-ocr-review-invariant",
      removeTemporaryDirectory: () => {},
      readFileStat: () => ({ size: 128 }),
      temporaryRoot: () => "/private/tmp",
      runFile: command => Buffer.from(command === "tesseract" ? transcription : ""),
    });
    const recovered = ocr("source.pdf", 1);
    const bytes = new Uint8Array(Buffer.from("synthetic PDF bytes for OCR safety test"));
    const prepared = await prepareRawPdfForReview({
      filename: "image-only.pdf",
      originalBytes: bytes,
      fullText: recovered.pages.join("\n\n"),
      pageTexts: recovered.pages,
    });

    expect(prepared.detected).toBe(1);
    expect(prepared.verifiedReady).toBe(0);
    expect(prepared.needsReview).toBe(1);
    expect(prepared.pkg.questions[0].flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "media_association_uncertain" }),
      expect.objectContaining({ type: "answer_needs_review" }),
    ]));
  });
});
