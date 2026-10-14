import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PackageManifest } from "../package";
import { assessBank } from "../assessBank";
import { extractDocxBank } from "./extractDocxBank";

const root = join(process.cwd(), "..");
const fixture = (name: string) => readFileSync(join(root, "fixtures/qbank/synthetic/docx", name));
const manifest: PackageManifest = {
  schemaVersion: 1,
  bank: { id: "word-import-test", title: "Word bank", discipline: "Test" },
  course: { name: "GOER", term: 5, week: 2 },
  source: { filename: "questions.docx", sourceWeekDeclared: false },
  questionsFile: "questions.json",
  assetsDirectory: "assets/",
};
function source(name: string): File {
  return new File([fixture(name)], "questions.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

describe("Word input directly to the existing reviewed-bank contract", () => {
  it("preserves table, image file bytes, explanation and source identity in ordinary DOCX", async () => {
    const file = source("pandoc-unmarked.docx");
    const extracted = await extractDocxBank(file, manifest);
    expect(extracted.readBy).toBe("text-parser");
    expect(extracted.originalFile).toBe(file);
    expect(extracted.sourceBytes).toBe(file.size);
    expect(extracted.pkg.questions).toHaveLength(2);
    expect(extracted.pkg.questions[0].stem.some(block => block.type === "table")).toBe(true);
    expect(extracted.pkg.questions[1].stem.some(block => block.type === "image")).toBe(true);
    expect(extracted.pkg.questions[0].correctAnswer).toMatchObject({ labels: ["B"], evidence: "printed-key" });
    expect(extracted.files).toHaveLength(1);
    expect(extracted.files[0].type).toBe("image/png");
    expect(extracted.files[0].size).toBeGreaterThan(0);
    expect(extracted.pkg.questions[1].assets[0].filename).toBe(extracted.files[0].name);
    expect(assessBank(extracted.pkg, extracted.conversionIssues, extracted.files).counts.ready).toBeGreaterThan(0);
  });

  it("retains rich Word blocks, explicitly sourced answers and answer-reveal images", async () => {
    const extracted = await extractDocxBank(source("pandoc-marked.docx"), manifest);
    expect(extracted.readBy).toBe("markers");
    expect(extracted.pkg.questions[0].stem.map(block => block.type)).toEqual(["rich_text", "table", "image", "equation", "text"]);
    expect(extracted.pkg.questions[0].correctAnswer).toMatchObject({ labels: ["B"], evidence: "printed-key" });
    expect(extracted.files).toHaveLength(2);
    expect(extracted.pkg.questions[0].assets.some(asset => asset.role === "answer_reveal")).toBe(true);
    expect(extracted.conversionIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "possible_answer_marking" })]));
  });

  it("does not parse invalid DOCX bytes as invented questions", async () => {
    await expect(extractDocxBank(new File(["1. Example?\\nA. yes\\nB. no"], "questions.docx"), manifest))
      .rejects.toThrow(/not a Word|not a ZIP|document|archive/i);
  });

  it("refuses files larger than the declared resource limit before reading", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await expect(extractDocxBank({ size: 129 * 1024 * 1024, arrayBuffer }, manifest))
      .rejects.toThrow(/larger than 128 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
