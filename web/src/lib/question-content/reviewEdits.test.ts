import { describe, expect, it } from "vitest";
import type { ImportPackage, PackageIssue } from "./package";
import { editReviewedBlock, editReviewedTableCell, unresolvedExtractionIssues } from "./reviewEdits";
import { withReviewedAnswer } from "./readiness";

const pkg = (): ImportPackage => ({
  manifest: { schemaVersion: 1, bank: { id: "clinical-a", title: "Synthetic clinical bank", discipline: "Medicine" },
    course: { name: "GOER", term: 5, week: 2 },
    source: { filename: "invented.docx", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/" },
  questions: [{
    id: "q1", source: { filename: "invented.docx", questionNumber: 1 },
    stem: [{ type: "text", text: "Serum calcium is elevated." },
      { type: "table", headers: ["Analyte", "Value"], rows: [["Calcium", "13 mg/dL"], ["PTH", "2 pg/mL"]] },
      { type: "image", assetId: "asset-x" }],
    choices: [{ id: "q1-a", label: "A", blocks: [{ type: "text", text: "Hyperparathyroidism" }] },
      { id: "q1-b", label: "B", blocks: [{ type: "rich_text", html: "Malignancy <b>secreting PTHrP</b>" }] }],
    correctAnswer: { labels: ["B"], evidence: "printed-key" },
    explanation: [{ type: "text", text: "PTH suppressed." }],
    assets: [{ id: "asset-x", filename: "figure.png", mimeType: "image/png", role: "stem", questionId: "q1" }],
    provenance: { method: "docx-import", sourceChecksum: "sha256:" + "1".repeat(64) },
  }],
});

describe("manual corrections to reviewed imports", () => {
  it("edits only selected stem text, keeps structured media and stable IDs, invalidates the verified key", () => {
    const before = pkg();
    const after = editReviewedBlock(before, "q1", { section: "stem", index: 0 }, "Serum calcium is 13 mg/dL.");
    expect((after.questions[0].stem[0] as { text: string }).text).toContain("13 mg/dL");
    expect(after.questions[0].stem.slice(1)).toEqual(before.questions[0].stem.slice(1));
    expect(after.questions[0].choices).toEqual(before.questions[0].choices);
    expect(after.questions[0].assets).toEqual(before.questions[0].assets);
    expect(after.questions[0].id).toBe("q1");
    expect(after.questions[0].provenance).toEqual(before.questions[0].provenance);
    expect(after.questions[0].correctAnswer).toBeUndefined();
    expect(after.questions[0].flags).toContainEqual(expect.objectContaining({ type: "answer_needs_review" }));
    expect(withReviewedAnswer(after.questions[0], "B").correctAnswer).toEqual({ labels: ["B"], evidence: "reviewer" });
    expect(editReviewedBlock(before, "q1", { section: "stem", index: 0 }, "Serum calcium is elevated.")).toBe(before);
  });
  it("supports rich text without executable markup, leaving other blocks and choice order unchanged", () => {
    const after = editReviewedBlock(pkg(), "q1", { section: "choice", choiceId: "q1-b", index: 0 },
      "PTHrP <b>elevated</b> <script>alert(1)</script>");
    const edited = after.questions[0].choices[1].blocks[0];
    expect(edited.type).toBe("rich_text");
    if (edited.type === "rich_text") { expect(edited.html).toContain("<b>elevated</b>"); expect(edited.html).not.toContain("<script>"); }
    expect(after.questions[0].choices[0].label).toBe("A");
    expect(after.questions[0].correctAnswer).toBeUndefined();
  });
  it("updates one laboratory table cell, preserves layout and prevents an outdated answer from remaining verified", () => {
    const before = pkg();
    const after = editReviewedTableCell(before, "q1", { section: "stem", index: 1 }, { row: 0, column: 1 }, "12.8 mg/dL");
    expect(after.questions[0].stem[1]).toMatchObject({ type: "table", headers: ["Analyte", "Value"], rows: [["Calcium", "12.8 mg/dL"], ["PTH", "2 pg/mL"]] });
    expect(before.questions[0].stem[1]).toMatchObject({ rows: [["Calcium", "13 mg/dL"], ["PTH", "2 pg/mL"]] });
    expect(after.questions[0].correctAnswer).toBeUndefined();
    expect(() => editReviewedTableCell(before, "q1", { section: "stem", index: 1 }, { row: 9, column: 0 }, "value")).toThrow(/Invalid/);
  });
  it("clears stale key extraction advisories only after explicit manual confirmation", () => {
    const issues: PackageIssue[] = [
      { questionId: "q1", code: "answer_needs_review", severity: "warning", message: "Source guess" },
      { questionId: "q1", code: "possible_answer_marking", severity: "warning", message: "Marked slide" },
      { questionId: "q1", code: "table_parse_uncertain", severity: "warning", message: "Table edge" },
      { questionId: "q2", code: "answer_needs_review", severity: "warning", message: "Second source guess" },
    ];
    expect(unresolvedExtractionIssues(issues, new Set())).toHaveLength(4);
    expect(unresolvedExtractionIssues(issues, new Set(["q1"]))).toEqual(issues.slice(2));
  });
});