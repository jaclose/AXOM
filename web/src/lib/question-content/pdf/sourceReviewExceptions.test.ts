import { describe, expect, it } from "vitest";
import { assessBank } from "../assessBank";
import type { PackageQuestion, ImportPackage } from "../package";
import { applyReviewedSourceExceptions, CONFIRMED_SOURCE_REVIEWS, type SourceReviewLedger } from "./sourceReviewExceptions";

const sourceChecksum = "sha256:" + "a".repeat(64);
const record = (set: number, number: number, label = "B"): PackageQuestion => ({
  id: `q${set}-${number}`, source: { filename: "original.pdf", set, questionNumber: number },
  stem: [{ type: "text", text: `A synthetic question ${set}-${number}` }],
  choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
    { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
  correctAnswer: { labels: [label], evidence: "printed-key" }, assets: [],
  provenance: { method: "pdf-import", sourceChecksum },
});
const ledger: SourceReviewLedger = {
  sourceChecksum, expectedQuestions: 3, reviewedAgainst: "synthetic",
  review: [
    { set: 1, questionNumber: 1, sourceKey: "B", reason: "Documented arithmetic discrepancy." },
    { set: 2, questionNumber: 1, sourceKey: "A", reason: "Documented endpoint discrepancy." },
  ],
};
function pack(questions: PackageQuestion[]): ImportPackage {
  return { manifest: { schemaVersion: 1, course: { name: "DEMO", term: 1, week: 1 },
    bank: { id: "source-review", title: "Synthetic import", discipline: "Medicine" },
    source: { filename: "original.pdf", sourceWeekDeclared: false },
    questionsFile: "questions.json", assetsDirectory: "assets/" }, questions };
}
describe("exact-SHA source-review exception overlay", () => {
  it("does not modify unrecognized source hashes or generic source content", () => {
    const original = [record(1, 1), record(1, 2), record(2, 1)];
    const result = applyReviewedSourceExceptions(original, "sha256:" + "f".repeat(64), [ledger]);
    expect(result.annotated).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.questions).toEqual(original);
  });
  it("annotates the right source-set identities without changing answer labels and stays idempotent", () => {
    const original = [record(1, 1), record(1, 2), record(2, 1)];
    const result = applyReviewedSourceExceptions(original, sourceChecksum, [ledger]);
    expect(result.annotated).toBe(2);
    expect(result.issues).toEqual([]);
    expect(result.questions.map(q => q.correctAnswer)).toEqual(original.map(q => q.correctAnswer));
    expect(result.questions[1].flags).toBeUndefined();
    expect(result.questions[0].flags?.[0].type).toBe("source_inconsistency");
    expect(result.questions[2].flags?.map(flag => flag.type)).toEqual(["source_inconsistency", "source_inconsistency"]);
    const counts = assessBank(pack(result.questions), result.issues, []).counts;
    expect(counts).toEqual({ ready: 1, "needs-review": 2, unresolved: 0 });
    const repeated = applyReviewedSourceExceptions(result.questions, sourceChecksum, [ledger]);
    expect(repeated.questions).toEqual(result.questions);
  });
  it("fails closed when a known reviewed question is missing or its set identities changed", () => {
    const original = [record(1, 1), record(1, 2), record(2, 1)];
    const broken = applyReviewedSourceExceptions(original.map(q => ({ ...q, source: { ...q.source, set: 1 } })), sourceChecksum, [ledger]);
    expect(broken.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "invalid_package" }));
    expect(broken.questions.every(q => q.flags?.some(flag => flag.type === "answer_needs_review"))).toBe(true);
    const shortened = applyReviewedSourceExceptions(original.slice(0, 2), sourceChecksum, [ledger]);
    expect(shortened.issues.some(issue => issue.severity === "error")).toBe(true);
  });
  it("rejects duplicate review ledgers for one original source", () => {
    const original = [record(1, 1), record(1, 2), record(2, 1)];
    expect(applyReviewedSourceExceptions(original, sourceChecksum, [ledger, ledger]).issues)
      .toContainEqual(expect.objectContaining({ severity: "error" }));
  });
  it("keeps known GOER source ledger metadata-only and keyed by immutable original hash", () => {
    const [goer] = CONFIRMED_SOURCE_REVIEWS;
    expect(goer.sourceChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(goer.review.map(row => [row.set, row.questionNumber])).toEqual([[1, 1], [1, 4], [2, 7]]);
    expect(goer.expectedQuestions).toBe(15);
  });
});
