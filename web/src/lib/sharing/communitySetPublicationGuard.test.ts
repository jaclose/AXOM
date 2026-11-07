import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import type { QuestionSet } from "../library";
import { prepareCurrentCommunityQuestionSetSubmission as prepare } from "./communitySetPublicationGuard";

const date = "2026-11-07T11:00:00.000Z";
const set: QuestionSet = {
  id: "set-1", title: "Reviewed vascular questions", kind: "custom",
  questionIds: ["q-1"], sourceDocumentIds: [], tags: ["vascular"],
  createdAt: date, aiEnhanced: false, parserWarnings: [],
};
const question: QuestionRecord = {
  id: "q-1", source: "manual", stem: "What arterial layer contains vascular smooth muscle?",
  options: [{ key: "A", text: "Tunica media" }, { key: "B", text: "Tunica intima" }],
  correctKey: "A", explanation: "Vascular smooth muscle cells reside in the tunica media, controlling arterial tone and resistance.",
  choiceRationales: { A: "Media is the contractile layer.", B: "Intima is predominantly endothelial." },
  citation: "Source checked by owner", status: "unseen", tags: ["anatomy"],
  notes: "Sensitive private note, do not publish",
  attempts: [], createdAt: date, updatedAt: date,
};

function publish(changes: {
  liveSet?: QuestionSet | null;
  liveQuestion?: QuestionRecord | null;
  openedQuestion?: QuestionRecord;
  openedSet?: QuestionSet;
} = {}) {
  return prepare({
    openedSet: changes.openedSet ?? set,
    openedQuestions: [changes.openedQuestion ?? question],
    liveSets: changes.liveSet === null ? [] : [changes.liveSet ?? set],
    liveQuestions: changes.liveQuestion === null ? [] : [changes.liveQuestion ?? question],
    now: date,
  });
}

describe("community Question Set exact-revision publication gate", () => {
  it("uses the current reviewed public projection while excluding private notes and source metadata", () => {
    const snapshot = publish();
    expect(snapshot.title).toBe(set.title);
    expect(snapshot.questions).toHaveLength(1);
    expect(snapshot.questions[0].correctKey).toBe("A");
    expect(snapshot.questions[0].id).toBe("shared-question-1");
    expect(snapshot.questions[0].tags).toContain("visual:intent:anatomical-schematic");
    expect(snapshot.tags).toContain("visual:intent:anatomical-schematic");
    expect(JSON.stringify(snapshot)).not.toMatch(/Sensitive private note|sourceDocumentId|attempts/);
  });

  it("fails closed on silently revised answers, explanations, citations and tags", () => {
    for (const delta of [
      { correctKey: "B" },
      { explanation: "Unverified alternate explanation" },
      { citation: "Different source" },
      { tags: ["new clinical term"] },
    ]) {
      expect(() => publish({ liveQuestion: { ...question, ...delta } })).toThrow(/changed while publishing/);
    }
  });

  it("rejects source-review revocation even when the timestamp and public question text did not change", () => {
    const reviewed = { ...question, extraction: { confidence: "high" as const, reviewed: true, answerEvidence: "Source key: A" } };
    const revoked = { ...reviewed, extraction: { ...reviewed.extraction, reviewed: false } };
    expect(() => publish({ openedQuestion: reviewed, liveQuestion: revoked })).toThrow(/source review changed|source review changed while publishing|changed while publishing/);
  });

  it("rejects changed source evidence, source filing, replacement and membership", () => {
    expect(() => publish({ liveQuestion: { ...question, sourceDocumentId: "replaced-document" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveSet: { ...set, questionIds: ["another-question"] } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveSet: null })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: null })).toThrow(/changed while publishing/);
  });

  it("never publishes newly held, unexplained or media-dependent questions", () => {
    expect(() => publish({ liveQuestion: { ...question, needsReview: true } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, explanation: "" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, attachments: [{ assetId: "private-image" }] as never } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, correctKey: undefined } })).toThrow(/changed while publishing/);
  });
});
