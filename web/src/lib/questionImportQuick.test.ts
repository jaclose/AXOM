import { describe, expect, it } from "vitest";
import type { ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";
import { evaluateImportDrafts } from "./questionImportTrust";
import { markExactImportMatches, planQuickImport, type QuickImportDraft } from "./questionImportQuick";

const ready = (patch: Partial<QuickImportDraft> = {}): QuickImportDraft => ({
  stem: "Which receptor is activated?",
  options: [{ key: "A", text: "Alpha receptor" }, { key: "B", text: "Beta receptor" }],
  correctKey: "B",
  correctAnswerText: "Beta receptor",
  answerEvidence: "Answer: B",
  parserRuleIds: ["answer.explicit-letter"],
  confidence: "high",
  warnings: [],
  include: true,
  ...patch,
});

const plan = (drafts: QuickImportDraft[], existing: QuestionRecord[] = [], images: File[] = []) =>
  planQuickImport(drafts, evaluateImportDrafts(drafts), existing, images);

describe("one-click source-backed import", () => {
  it("takes only the clearly keyed question from a mixed batch", () => {
    const drafts = [
      ready(),
      ready({ stem: "Unanswered question?", correctKey: undefined, correctAnswerText: undefined, answerEvidence: undefined, parserRuleIds: [] }),
      ready({ stem: "Unverified separate key?", parserRuleIds: ["answer.separate-source-needs-verification"] }),
      ready({ stem: "AI generated question?", aiGenerated: true }),
    ];
    expect(plan(drafts)).toEqual({ readyIndexes: [0], alreadySaved: 0, repeatedInFile: 0, missingImages: 0, needsReview: 3 });
  });

  it("does not save a source key after the selected answer has changed", () => {
    expect(plan([ready({ correctKey: "A", correctAnswerText: "Alpha receptor" })]).readyIndexes).toEqual([]);
  });

  it("leaves a zero-ready source without scored questions", () => {
    expect(plan([ready({ correctKey: undefined, answerEvidence: undefined })])).toEqual({
      readyIndexes: [], alreadySaved: 0, repeatedInFile: 0, missingImages: 0, needsReview: 1,
    });
  });

  it("skips an existing question on retry and keeps one copy inside a repeated source", () => {
    const first = ready();
    const second = ready({ stem: "Which vessel carries blood?" });
    const existing = [{ id: "saved-1", stem: first.stem, options: first.options }] as QuestionRecord[];
    expect(plan([first, second, { ...second }], existing)).toEqual({
      readyIndexes: [1], alreadySaved: 1, repeatedInFile: 1, missingImages: 0, needsReview: 0,
    });
    const marked = markExactImportMatches([first, second, { ...second }] as ParsedQuestionDraft[], [true, true, true], existing);
    expect(marked.selected).toEqual([false, true, false]);
    expect(marked.drafts[0].parserRuleIds).toContain("duplicate.exact-existing");
    expect(marked.drafts[2].parserRuleIds).toContain("duplicate.exact-in-file");
  });

  it("holds a question whose named image is missing or ambiguous", () => {
    const draft = ready({ attachmentNames: ["figures/ecg.png"] });
    expect(plan([draft]).missingImages).toBe(1);
    expect(plan([draft], [], [new File(["a"], "a/ecg.png"), new File(["b"], "b/ecg.png")]).missingImages).toBe(1);
    expect(plan([draft], [], [new File(["a"], "figures/ecg.png")]).readyIndexes).toEqual([0]);
  });
});
