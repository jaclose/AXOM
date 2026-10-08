// Invented teaching content throughout.
import { describe, expect, it } from "vitest";
import type { PackageIssue, PackageQuestion } from "./package";
import { countReadiness, questionReadiness } from "./readiness";

const question = (over: Partial<PackageQuestion> = {}): PackageQuestion => ({
  id: "q1",
  source: { filename: "invented.pdf", questionNumber: 1 },
  stem: [{ type: "text", text: "Which nerve supplies the diaphragm?" }],
  choices: [
    { id: "q1-a", label: "A", blocks: [{ type: "text", text: "Vagus nerve" }] },
    { id: "q1-b", label: "B", blocks: [{ type: "text", text: "Phrenic nerve" }] },
  ],
  correctAnswer: { labels: ["B"], evidence: "printed-key" },
  assets: [],
  provenance: { method: "pdf-import" },
  ...over,
});

describe("whether a question is ready", () => {
  it("is ready with a printed key and nothing to look at", () => {
    expect(questionReadiness(question(), [])).toEqual({ readiness: "ready", reasons: [] });
  });

  it("is ready whatever is wrong with another question or with the package", () => {
    const issues: PackageIssue[] = [
      { severity: "error", code: "invalid_question", message: "Another question has one choice.", questionId: "q2" },
      { severity: "warning", code: "media_association_uncertain", message: "Two pictures could not be tied to a question." },
    ];
    expect(questionReadiness(question(), issues).readiness).toBe("ready");
  });

  it("is not held back by a note that is only information", () => {
    expect(questionReadiness(question(), [{ severity: "info", code: "missing_explanation", message: "No explanation.", questionId: "q1" }]).readiness).toBe("ready");
  });

  it("needs review when it has a key and a flag", () => {
    const flagged = question({ flags: [{ type: "media_association_uncertain", message: "The picture may belong to the next question." }] });
    expect(questionReadiness(flagged, [])).toEqual({ readiness: "needs-review", reasons: ["The picture may belong to the next question."] });
  });

  it("needs review when it has a key and a warning of its own, and gives each reason once", () => {
    const issues: PackageIssue[] = [{ severity: "warning", code: "needs_review", message: "The stem may run into the next question.", questionId: "q1" }];
    const flagged = question({ flags: [{ type: "table_parse_uncertain", message: "The stem may run into the next question." }] });
    expect(questionReadiness(flagged, issues)).toEqual({ readiness: "needs-review", reasons: ["The stem may run into the next question."] });
  });

  it("needs review when it has no key but the source shows the answer in a form kept for a person to read", () => {
    const marked = question({ correctAnswer: undefined, flags: [{ type: "answer_needs_review", message: "The answer is shown by a mark on the answer slide." }] });
    expect(questionReadiness(marked, [])).toEqual({ readiness: "needs-review", reasons: ["The answer is shown by a mark on the answer slide."] });
  });

  it("is unresolved when no answer could be read and nothing was kept to settle it", () => {
    expect(questionReadiness(question({ correctAnswer: undefined }), []).readiness).toBe("unresolved");
  });

  it("is unresolved when an error stops it being run, key or not", () => {
    const issues: PackageIssue[] = [{ severity: "error", code: "invalid_question", message: "It has one choice.", questionId: "q1" }];
    expect(questionReadiness(question(), issues)).toEqual({ readiness: "unresolved", reasons: ["It has one choice."] });
  });

  it("counts a bank", () => {
    const questions = [question(), question({ id: "q2", correctAnswer: undefined }), question({ id: "q3", flags: [{ type: "source_inconsistency", message: "Check the stem." }] })];
    expect(countReadiness(questions, [])).toEqual({ ready: 1, "needs-review": 1, unresolved: 1 });
  });
});
