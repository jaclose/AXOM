import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import { matchAxomDiagram } from "./match";

const question: QuestionRecord = {
  id: "sample-rhinovirus", source: "manual",
  stem: "A patient has runny nose and sneezing. Which virus is associated with this presentation?",
  options: [{ key: "A", text: "Rhinovirus" }, { key: "B", text: "Influenza virus" }],
  correctKey: "A", correctAnswerText: "Rhinovirus", status: "unseen", tags: [], attempts: [],
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("curated AXOM diagram matching", () => {
  it("links a keyed rhinovirus answer with two distinct positive stem clues", () => {
    expect(matchAxomDiagram(question)?.id).toBe("rhinovirus-common-cold");
    expect(matchAxomDiagram(question)?.topicTag).toBe("axom:diagram:rhinovirus");
    expect(matchAxomDiagram({ ...question, options: [{ key: "A", text: "Human rhinovirus" }, question.options[1]] })?.id).toBe("rhinovirus-common-cold");
  });

  it("never diagnoses from symptoms, a stale derived answer, or repeated synonyms", () => {
    expect(matchAxomDiagram({ ...question, options: [{ key: "A", text: "Influenza virus" }, question.options[1]] })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, stem: "Runny nose and rhinorrhea are present." })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, stem: "The patient has cough and fever." })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, options: [{ key: "A", text: "Rhinovirus or enterovirus" }, question.options[1]] })).toBeUndefined();
  });

  it("does not count negated or excluded clues", () => {
    expect(matchAxomDiagram({ ...question, stem: "No runny nose. The patient is sneezing." })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, stem: "The patient denies sneezing but has rhinorrhea." })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, stem: "Runny nose and sneezing are present, but rhinovirus is ruled out." })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, stem: "No cough but runny nose and sneezing are present." })?.id).toBe("rhinovirus-common-cold");
  });

  it("does not display for missing, held, or unreviewed extraction keys", () => {
    expect(matchAxomDiagram({ ...question, correctKey: undefined })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, needsReview: true })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, extraction: { confidence: "low", reviewed: false } })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, tags: ["axom:diagram:rhinovirus"], correctKey: undefined })).toBeUndefined();
  });
});
