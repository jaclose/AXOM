import { describe, expect, it } from "vitest";
import { analysisIsCurrent } from "../decode/analysis";
import type { QuestionRecord } from "../questions";
import { materializeTeachingAnalysis } from "./materializeTeaching";
import type { PackageTeaching } from "./package";

const question = (patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: "stored-q1", source: "imported", stem: "A source-grounded stem", correctKey: "B",
  options: [{ key: "A", text: "First option" }, { key: "B", text: "Second option" }, { key: "C", text: "Third option" }],
  explanation: "The source explanation.", status: "unseen", tags: [], attempts: [],
  createdAt: "2026-10-23T09:00:00.000Z", updatedAt: "2026-10-23T10:00:00.000Z",
  extraction: { confidence: "high", reviewed: true, reviewedAt: "2026-10-23T10:00:00.000Z" },
  ...patch,
});

const teaching = (patch: Partial<PackageTeaching> = {}): PackageTeaching => ({
  version: 1, answerLabel: "B", concept: "Synthetic mechanism", whyCorrect: "B matches the inspected source.",
  mechanism: "One causal step links the finding to B.", highYieldRule: "Use the causal step.",
  distractors: [
    { label: "A", option: "First option", explanation: "A has the opposite relationship." },
    { label: "C", option: "Third option", explanation: "C belongs to a different context.", wouldFitIf: "the context changed" },
  ],
  sourceReferences: [{ sourceId: "slides", pdfPages: [12], purpose: "Mechanism" }],
  factCheck: {
    status: "SOURCE_CHECKED", humanReviewerApproved: false, answerChanged: false, limitations: [],
    answerKeyEvidence: { sourceId: "questions", pdfPage: 3, printedAnswer: "B", method: "Rendered-page inspection" },
  },
  ...patch,
});

describe("structured package teaching", () => {
  it("materializes source-checked unapproved teaching as a current proposal", () => {
    const source = question();
    const analysis = materializeTeachingAnalysis({ teaching: teaching(), question: source, generatedAt: "2026-10-23T11:00:00.000Z" });
    expect(analysis).toMatchObject({
      questionId: source.id, origin: "source", status: "proposed", concept: "Synthetic mechanism",
      rule: "Use the causal step.", explanation: "B matches the inspected source.",
      distractors: [{ key: "A" }, { key: "C", wouldFitIf: "the context changed" }], references: [],
    });
    expect(analysisIsCurrent(analysis!, source)).toBe(true);
  });

  it("marks only explicitly human-approved teaching as reviewed", () => {
    expect(materializeTeachingAnalysis({
      teaching: teaching({ factCheck: { ...teaching().factCheck, humanReviewerApproved: true } }),
      question: question(), generatedAt: "2026-10-23T11:00:00.000Z",
    })?.status).toBe("reviewed");
  });

  it.each([
    ["changed answer", teaching({ factCheck: { ...teaching().factCheck, answerChanged: true } }), question()],
    ["mismatched key", teaching({ answerLabel: "A" }), question()],
    ["mismatched printed evidence", teaching({ factCheck: { ...teaching().factCheck, answerKeyEvidence: { ...teaching().factCheck.answerKeyEvidence!, printedAnswer: "A" } } }), question()],
    ["unverified fact check", teaching({ factCheck: { ...teaching().factCheck, status: "UNVERIFIED" } }), question()],
    ["missing distractor", teaching({ distractors: teaching().distractors.slice(0, 1) }), question()],
    ["stale option wording", teaching({ distractors: [{ ...teaching().distractors[0], option: "Different wording" }, teaching().distractors[1]] }), question()],
  ])("refuses %s without changing the source question", (_label, candidate, source) => {
    const before = structuredClone(source);
    expect(materializeTeachingAnalysis({ teaching: candidate, question: source, generatedAt: "2026-10-23T11:00:00.000Z" })).toBeUndefined();
    expect(source).toEqual(before);
  });

  it("creates clickable references only from explicit AXOM document ids", () => {
    const analysis = materializeTeachingAnalysis({
      teaching: teaching({
        sourceReferences: [{ sourceId: "slides", documentId: "doc-explicit", pdfPages: [12], purpose: "Mechanism" }],
        factCheck: { ...teaching().factCheck, supportingExcerpts: [{ sourceId: "slides", pdfPage: 12, excerpt: "Exact short excerpt" }] },
      }),
      question: question(), generatedAt: "2026-10-23T11:00:00.000Z",
    });
    expect(analysis?.references).toEqual([{ documentId: "doc-explicit", page: 12, role: "teaching", quote: "Exact short excerpt" }]);
  });
});
