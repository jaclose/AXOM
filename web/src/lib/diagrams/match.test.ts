import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import type { QuestionRecord } from "../questions";
import { matchAxomDiagram, matchesReviewedDiagramEvidence, REVIEWED_DIAGRAM_RULES } from "./match";

const question: QuestionRecord = {
  id: "sample-rhinovirus", source: "manual",
  stem: "A patient has runny nose and sneezing. Which virus is associated with this presentation?",
  options: [{ key: "A", text: "Rhinovirus" }, { key: "B", text: "Influenza virus" }],
  correctKey: "A", correctAnswerText: "Rhinovirus", status: "unseen", tags: [], attempts: [],
  explanation: "The keyed answer is supported by the nasal symptom pattern and the source explanation, with other causes considered separately.",
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

  it("requires a substantive question rationale; the diagram's source citation is not enough", () => {
    expect(matchAxomDiagram({ ...question, explanation: undefined })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, explanation: "See https://www.cdc.gov/rhinoviruses/about/index.html" })).toBeUndefined();
    expect(matchAxomDiagram({ ...question, explanation: "Correct answer." })).toBeUndefined();
  });
});

const syntheticId = "axom-diagram-test-question";
const syntheticPrefix = [...sha256(new TextEncoder().encode(syntheticId))]
  .slice(0, 6).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const syntheticContent: NonNullable<QuestionRecord["content"]> = {
  id: syntheticId, term: 1, source: { filename: "synthetic" }, stem: [], choices: [],
  assets: [], provenance: { method: "authored" },
};

const indexedCases = [
  { id: "brachial-plexus-posterior-cord", stem: "A brachial plexus injury weakens wrist extension.", answer: "Posterior cord" },
  { id: "neuromuscular-transmission-presynaptic", stem: "Repeated contractions improve the response.", answer: "Presynaptic calcium entry permits acetylcholine release" },
  { id: "posterior-abdominal-wall-genitofemoral", stem: "The nerve runs on the anterior surface of psoas and supplies the cremasteric response.", answer: "Genitofemoral nerve" },
  { id: "repeat-disorders-dmpk", stem: "Handgrip release is slow, and cataracts are present.", answer: "CTG expansion in the DMPK 3-prime untranslated region" },
] as const;

describe("source-checked indexed diagram gate", () => {
  for (const sample of indexedCases) {
    it(`requires the exact revision, keyed answer, topic, module, and distinct clues for ${sample.id}`, () => {
      const entry = REVIEWED_DIAGRAM_RULES.find((rule) => rule.diagramId === sample.id);
      expect(entry).toBeDefined();
      const rule = { ...entry!, questionIdShaPrefix: syntheticPrefix };
      const indexed: QuestionRecord = {
        ...question,
        id: `saved-${sample.id}`,
        stem: sample.stem,
        options: [{ key: "A", text: sample.answer }, { key: "B", text: "A different answer" }],
        module: rule.module,
        topic: rule.topic,
        content: { ...syntheticContent, term: rule.term },
      };
      expect(matchesReviewedDiagramEvidence(indexed, rule)).toBe(true);
      expect(matchesReviewedDiagramEvidence({ ...indexed, correctKey: "B" }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, explanation: undefined }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, needsReview: true }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, extraction: { confidence: "low", reviewed: false } }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, module: "Another module" }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, topic: "Another topic" }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, content: { ...indexed.content!, term: 2 } }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, content: { ...indexed.content!, id: "another-source-question" } }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, stem: "The stem has no matching clinical clues." }, rule)).toBe(false);
      expect(matchesReviewedDiagramEvidence({ ...indexed, tags: ["axom:diagram:anything"], correctKey: "B" }, rule)).toBe(false);
    });
  }

  it("does not count negated or explicitly excluded indexed evidence", () => {
    const rule = { ...REVIEWED_DIAGRAM_RULES[0], questionIdShaPrefix: syntheticPrefix };
    const indexed: QuestionRecord = {
      ...question, stem: "No brachial plexus injury. Wrist extension is weak.",
      options: [{ key: "A", text: "Posterior cord" }, { key: "B", text: "Radial nerve" }],
      module: "MSK", topic: "Brachial plexus",
      content: syntheticContent,
    };
    expect(matchesReviewedDiagramEvidence(indexed, rule)).toBe(false);
    expect(matchesReviewedDiagramEvidence({ ...indexed, stem: "A brachial plexus injury weakens wrist extension, but the posterior cord is ruled out." }, rule)).toBe(false);
  });

  it("keeps image-dependent art inactive even with a matching topic tag", () => {
    expect(REVIEWED_DIAGRAM_RULES.map((rule) => rule.diagramId)).not.toContain("fibrocartilage-pattern");
    expect(REVIEWED_DIAGRAM_RULES.map((rule) => rule.diagramId)).not.toContain("inguinal-region-routes");
    expect(matchAxomDiagram({ ...question, stem: "Chondrocytes lie among collagen bundles.",
      options: [{ key: "A", text: "Type I and type II collagen, no perichondrium" }, question.options[1]],
      topic: "Cartilage", module: "MSK", tags: ["axom:diagram:fibrocartilage"] })).toBeUndefined();
  });
});
