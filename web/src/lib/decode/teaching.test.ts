import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import { questionSourceFingerprint } from "./analysis";
import { conceptGroups, questionsWithoutTeaching, teachingView } from "./teaching";
import type { QuestionAnalysis } from "./types";

const document: SourceDocument = {
  id: "doc-1", title: "Renal review", fileName: "renal-review.pdf", fileType: "pdf", uploadedAt: "2026-10-01T09:00:00.000Z",
  rawText: "", pageTexts: ["Question slide.", "Teaching slide."], sizeBytes: 1000, checksum: "checksum-1",
  tags: [], linkedQuestionSetIds: [], libraryOnly: false,
};
const documents = new Map([[document.id, document]]);

function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: "q-1", source: "pdf", stem: "Which segment reabsorbs most filtered sodium?",
    options: [{ key: "A", text: "Proximal tubule" }, { key: "B", text: "Collecting duct" }, { key: "C", text: "Loop of Henle" }],
    correctKey: "A", explanation: "About two thirds is reabsorbed proximally.",
    choiceRationales: { B: "From the question: fine control only.", C: "From the question: about a quarter." },
    status: "unseen", tags: [], attempts: [], sourceDocumentId: "doc-1", sourcePage: 1,
    createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
    ...patch,
  };
}

function reviewed(of: QuestionRecord, patch: Partial<QuestionAnalysis> = {}): QuestionAnalysis {
  return {
    id: `a-${of.id}`, questionId: of.id, sourceFingerprint: questionSourceFingerprint(of, documents.get(of.sourceDocumentId ?? "")), version: 1,
    origin: "source", status: "reviewed", concept: "Sodium handling along the nephron",
    rule: "Bulk reabsorption is proximal; fine control is distal.",
    decisiveClues: ["most filtered sodium"], mechanism: ["Na/K ATPase sets the gradient"],
    distractors: [{ key: "B", whyWrong: "The collecting duct adjusts the last few percent.", wouldFitIf: "the stem asked about aldosterone" }],
    lecture: "Lecture 12", references: [{ documentId: "doc-1", page: 2, role: "teaching" }],
    generatedAt: "2026-10-02T09:00:00.000Z", ...patch,
  };
}
const taught = (patch: Partial<QuestionRecord> = {}, analysis: Partial<QuestionAnalysis> = {}) => {
  const base = question(patch);
  return { ...base, analyses: [reviewed(base, analysis)] };
};

describe("what is shown as teaching for a question", () => {
  it("leads with the reviewed analysis and fills what it does not say from the question", () => {
    const view = teachingView(taught(), document);
    expect(view).toMatchObject({
      origin: "source", concept: "Sodium handling along the nephron", answer: { key: "A", text: "Proximal tubule" },
      rule: "Bulk reabsorption is proximal; fine control is distal.", explanation: "About two thirds is reabsorbed proximally.",
      lecture: "Lecture 12", documentId: "doc-1", pages: [2], bare: false,
    });
    expect(view.others).toEqual([
      { key: "B", text: "Collecting duct", whyWrong: "The collecting duct adjusts the last few percent.", wouldFitIf: "the stem asked about aldosterone" },
      { key: "C", text: "Loop of Henle", whyWrong: "From the question: about a quarter." },
    ]);
  });

  it("falls back to the question's own explanation when nothing has been reviewed", () => {
    const view = teachingView(question({ topic: "Nephron" }), document);
    expect(view).toMatchObject({ origin: "question", concept: "Nephron", pages: [1], bare: false, references: [] });
    expect(view.rule).toBeUndefined();
    expect(view.analysis).toBeUndefined();
    expect(view.others.map((option) => option.whyWrong)).toEqual(["From the question: fine control only.", "From the question: about a quarter."]);
  });

  it("does not name an answer the learner has not confirmed", () => {
    const unconfirmed = question({ extraction: { confidence: "low", reviewed: false, warnings: [] } });
    const view = teachingView(unconfirmed, document);
    expect(view.answer).toBeUndefined();
    // With no confirmed answer, no option is singled out as the right one.
    expect(view.others).toHaveLength(3);
  });

  it("ignores teaching written about an earlier version of the question", () => {
    const stale = { ...taught(), correctKey: "C" };
    expect(teachingView(stale, document)).toMatchObject({ origin: "question", pages: [1] });
  });

  it("says when there is nothing to teach from", () => {
    expect(teachingView(question({ explanation: undefined, choiceRationales: undefined })).bare).toBe(true);
  });
});

describe("where teaching could be added", () => {
  it("lists confirmed questions with no reviewed teaching that still fits", () => {
    const withTeaching = taught();
    const without = question({ id: "q-2" });
    const unresolved = question({ id: "q-3", correctKey: undefined });
    const stale = { ...taught({ id: "q-4" }), stem: "Reworded since." };
    expect(questionsWithoutTeaching([withTeaching, without, unresolved, stale], documents).map((entry) => entry.id)).toEqual(["q-2", "q-4"]);
  });
});

describe("questions that teach the same rule", () => {
  it("groups by concept and rule, and counts a question printed twice once", () => {
    const first = taught();
    const printedAgain = taught({ id: "q-2", sourceDocumentId: "doc-2", sourcePage: undefined });
    const another = taught({ id: "q-3", stem: "Where is most filtered sodium recovered?" }, { rule: "  bulk reabsorption is proximal; fine control is DISTAL. " });
    const [group, ...rest] = conceptGroups([first, printedAgain, another], documents);
    expect(rest).toEqual([]);
    expect(group).toMatchObject({ questionIds: ["q-1", "q-2", "q-3"], uniqueQuestions: 2, evidence: "several-sources" });
    expect(group.sources).toEqual([{ documentId: "doc-1", uniqueQuestions: 2 }, { documentId: "doc-2", uniqueQuestions: 1 }]);
  });

  it("calls one question an instance, and does not merge rules that only resemble each other", () => {
    const first = taught();
    const near = taught({ id: "q-2", stem: "Another stem?" }, { rule: "Most reabsorption is proximal." });
    const groups = conceptGroups([first, near], documents);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.evidence === "single-question")).toBe(true);
  });

  it("uses only teaching that is reviewed and still fits", () => {
    const proposed = taught({ id: "q-2" }, { status: "proposed" });
    const stale = { ...taught({ id: "q-3" }), stem: "Reworded since." };
    const ruleless = taught({ id: "q-4" }, { rule: undefined, explanation: "Only an explanation." });
    expect(conceptGroups([proposed, stale, ruleless], documents)).toEqual([]);
    const sameSource = [taught(), taught({ id: "q-5", stem: "A second question on it?" })];
    expect(conceptGroups(sameSource, documents)[0].evidence).toBe("single-source");
  });
});
