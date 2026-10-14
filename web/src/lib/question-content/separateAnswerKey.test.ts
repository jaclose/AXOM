import { describe, expect, it } from "vitest";
import type { ImportPackage, PackageIssue } from "./package";
import { assessBank } from "./assessBank";
import { normalizeSeparateKeyText, pairDraftAnswers, pairPackageAnswers } from "./separateAnswerKey";
import type { ParsedQuestionDraft } from "../questionParse";

const key = { name: "Term4-answer-key.txt", checksum: "sha256:" + "a".repeat(64) };
const drafts = (): ParsedQuestionDraft[] => [
  { questionNumber: 1, stem: "Which organ?", options: [{ key: "A", text: "Liver" }, { key: "B", text: "Kidney" }],
    confidence: "low", warnings: ["No correct answer found"] },
  { questionNumber: 2, stem: "Which ion?", options: [{ key: "A", text: "Na" }, { key: "B", text: "K" }],
    confidence: "low", warnings: ["No correct answer found"] },
];
function packageFixture(): ImportPackage {
  return {
    manifest: { schemaVersion: 1, bank: { id: "clinical-questions", title: "Clinical bank", discipline: "Medicine" },
      course: { name: "GOER", term: 5, week: 2 },
      source: { filename: "clinical.docx", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/" },
    questions: [1, 2].map((n) => ({
      id: `q${n}`, source: { filename: "clinical.docx", questionNumber: n },
      stem: [{ type: "text" as const, text: `Question ${n}` }],
      choices: [{ id: `q${n}a`, label: "A", blocks: [{ type: "text" as const, text: "Choice A" }] },
        { id: `q${n}b`, label: "B", blocks: [{ type: "text" as const, text: "Choice B" }] }],
      correctAnswer: n === 1 ? { labels: ["B"], evidence: "printed-key" as const } : undefined,
      assets: [], provenance: { method: "docx-import" as const },
    })),
  };
}

describe("explicitly selected separate answer key", () => {
  it("recognizes ordinary standalone numbered keys without a catalog or heading", () => {
    expect(normalizeSeparateKeyText("1. B\n2. A")).toMatch(/^Answer key:/);
    const result = pairDraftAnswers(drafts(), "1. B\n2. A", key);
    expect(result.matched).toBe(2);
    expect(result.value.map(item => item.correctKey)).toEqual(["B", "A"]);
    expect(result.value.every(item => item.needsReview)).toBe(true);
    expect(result.value[0].answerEvidenceSnippet).toContain(key.name);
    expect(result.unmatchedNumbers).toEqual([]);
  });
  it("does not invent an answer when the selected file has arbitrary teaching prose", () => {
    const result = pairDraftAnswers(drafts(), "Ion channel physiology.\nVoltage-gated channels allow flux.", key);
    expect(result.matched).toBe(0);
    expect(result.value.every(item => !item.correctKey)).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/no reliably numbered/i);
  });
  it("treats repeated question numbers as ambiguous, not duplicate verified keys", () => {
    const duplicate = [drafts()[0], { ...drafts()[1], questionNumber: 1 }];
    const result = pairDraftAnswers(duplicate, "Answers:\n1. B", key);
    expect(result.matched).toBe(0);
    expect(result.conflicted).toBe(2);
    expect(result.value.every(item => item.needsReview && !item.correctKey)).toBe(true);
  });
  it("keeps a number-only separated key provisional until question-to-source concordance is confirmed", () => {
    const pkg = packageFixture();
    const issues: PackageIssue[] = [{ questionId: "q2", severity: "warning", code: "missing_answer_key", message: "Missing key" }];
    const result = pairPackageAnswers(pkg, issues, "Answer key:\n1. B\n2. A", key);
    expect(result.matched).toBe(2);
    expect(result.value.pkg.questions[1].correctAnswer).toEqual({ labels: ["A"], evidence: "printed-key" });
    expect(result.value.pkg.questions[1].provenance.notes).toContain(key.checksum.slice(7));
    expect(result.value.issues).toEqual(issues);
    expect(result.value.pkg.questions[1].flags).toEqual(expect.arrayContaining([expect.objectContaining({ type: "answer_needs_review" })]));
    expect(assessBank(result.value.pkg, result.value.issues, []).counts.ready).toBe(1);
    expect(pkg.questions[1].correctAnswer).toBeUndefined();
  });
  it("preserves original verified key on conflict, blocks practice and exposes competing source", () => {
    const pkg = packageFixture();
    const result = pairPackageAnswers(pkg, [], "Answer key:\n1. A\n2. A", key);
    expect(result.conflicted).toBe(1);
    expect(result.value.pkg.questions[0].correctAnswer).toEqual({ labels: ["B"], evidence: "printed-key" });
    expect(result.value.pkg.questions[0].flags).toEqual(expect.arrayContaining([expect.objectContaining({ type: "source_inconsistency" })]));
    expect(assessBank(result.value.pkg, [], []).counts.ready).toBe(0);
  });
  it("does not assign any answer when question numbers repeat across sets", () => {
    const pkg = packageFixture();
    pkg.questions[1].source.questionNumber = 1;
    const result = pairPackageAnswers(pkg, [], "Answers:\n1. B", key);
    expect(result.matched).toBe(0);
    expect(result.conflicted).toBe(2);
    expect(result.value.pkg.questions[1].correctAnswer).toBeUndefined();
    expect(result.value.pkg.questions[0].flags?.[0]?.type).toBe("source_inconsistency");
  });
});