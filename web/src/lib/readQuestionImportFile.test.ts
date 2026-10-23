import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAW_TEXT_CAP } from "./extractText";
import { readQuestionImportFile } from "./readQuestionImportFile";
import type { PackageManifest } from "./question-content/package";

const manifest: PackageManifest = {
  schemaVersion: 1, bank: { id: "shared-reader", title: "Shared reader", discipline: "Test" },
  course: { name: "SAMPLE", term: 1, week: 1 },
  source: { filename: "questions.docx", sourceWeekDeclared: false },
  questionsFile: "questions.json", assetsDirectory: "assets/",
};

describe("single and batch source reader", () => {
  it("parses questions beyond the stored preview limit and retains the exact original", async () => {
    const text = `1. First synthetic question?\nA. One\nB. Two\nAnswer: A\nExplanation: ${"context ".repeat(60000)}\n\n2. Last synthetic question?\nA. Three\nB. Four\nAnswer: B`;
    const file = new File([text], "long.txt", { type: "text/plain" });
    const read = await readQuestionImportFile(file, manifest);
    if (read.kind !== "drafts") throw new Error("expected drafts");
    expect(read.drafts.map(draft => draft.stem)).toEqual(["First synthetic question?", "Last synthetic question?"]);
    expect(read.document.rawText.length).toBe(RAW_TEXT_CAP);
    expect(read.document.originalFile).toBe(file);
    expect(read.warnings.join(" ")).toMatch(/complete file was parsed/);
  });

  it("retains ordinary Word tables and figures through the shared structured route", async () => {
    const bytes = readFileSync(new URL("../../../fixtures/qbank/synthetic/docx/pandoc-unmarked.docx", import.meta.url));
    const read = await readQuestionImportFile(new File([bytes], "questions.docx"), manifest);
    if (read.kind !== "bank") throw new Error("expected a rich bank");
    expect(read.bank.pkg.questions).toHaveLength(2);
    expect(read.bank.pkg.questions[0].stem.some(block => block.type === "table")).toBe(true);
    expect(read.bank.pkg.questions[1].stem.some(block => block.type === "image")).toBe(true);
    expect(read.bank.files).toHaveLength(1);
  });

  it("refuses invalid UTF-8 instead of silently replacing source characters", async () => {
    await expect(readQuestionImportFile(new File([new Uint8Array([0xff, 0xfe])], "broken.txt"), manifest)).rejects.toThrow();
  });
});
