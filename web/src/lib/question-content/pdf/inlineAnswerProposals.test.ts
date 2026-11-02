import { describe, expect, it } from "vitest";
import type { ParsedQuestionDraft } from "../../questionParse";
import type { PackageQuestion } from "../package";
import { buildInlineAnswerProposals, fingerprintPackageQuestion, fingerprintParsedQuestionDraft,
  type SourceQuestionOccurrence } from "./inlineAnswerProposals";

const question = (id: string, page: number, stem = "Which invented gate opens?"): PackageQuestion => ({
  id, source: { filename: "synthetic.pdf", page }, stem: [{ type: "text", text: stem }],
  choices: ["A", "B", "C"].map(label => ({ id: `${id}-${label}`, label,
    blocks: [{ type: "text", text: `Gate ${label}` }] })), assets: [], provenance: { method: "pdf-import" },
});

const occurrence = (source: PackageQuestion, page: number, line: number,
  answerMarkers: SourceQuestionOccurrence["answerMarkers"] = []): SourceQuestionOccurrence => ({
  page, line, fingerprint: fingerprintPackageQuestion(source)!, answerMarkers,
});

describe("private inline-answer review proposals", () => {
  it("pairs two exact appearances by the complete source order and keeps the answer for review", () => {
    const first = question("first", 1), reveal = question("reveal", 13);
    const questions = [first, reveal];
    const before = JSON.stringify(questions);
    const proposals = buildInlineAnswerProposals(questions, [occurrence(first, 1, 6),
      occurrence(reveal, 13, 6, [{ page: 13, line: 18, label: "b" }])]);
    expect(proposals).toEqual([{ questionId: "first", questionPage: 1, questionLine: 6,
      answerCopyQuestionId: "reveal", answerPage: 13, answerLine: 6,
      answerMarkerPage: 13, answerMarkerLine: 18, suggestedChoice: "B",
      storedAnswerLabels: [], answerCopyStoredAnswerLabels: [], conflict: false,
      reviewRequired: true, reviewReason: "inline-answer-copy" }]);
    expect(JSON.stringify(proposals)).not.toMatch(/Which invented|Gate [ABC]/);
    expect(JSON.stringify(questions)).toBe(before);
    expect(first.correctAnswer).toBeUndefined();
  });

  it("accepts a marker crossing the page boundary, only before the next question", () => {
    const first = question("first", 1), reveal = question("reveal", 13), next = question("next", 14, "What closes the invented gate?");
    const rows = [first, reveal, next];
    const withCrossPageMarker = [occurrence(first, 1, 37),
      occurrence(reveal, 13, 42, [{ page: 14, line: 6, label: "C" }]), occurrence(next, 14, 10)];
    expect(buildInlineAnswerProposals(rows, withCrossPageMarker)).toMatchObject([
      { answerMarkerPage: 14, answerMarkerLine: 6, suggestedChoice: "C" },
    ]);
    expect(buildInlineAnswerProposals(rows, [withCrossPageMarker[0],
      { ...withCrossPageMarker[1], answerMarkers: [{ page: 14, line: 10, label: "C" }] }, withCrossPageMarker[2]])).toEqual([]);
  });

  it("abstains on repeated text with no unique pair, multiple marks, and a lone answer", () => {
    const q1 = question("one", 1), q2 = question("two", 2), q3 = question("three", 3);
    expect(buildInlineAnswerProposals([q1, q2, q3], [occurrence(q1, 1, 1), occurrence(q2, 2, 1),
      occurrence(q3, 3, 1, [{ page: 3, line: 9, label: "A" }])])).toEqual([]);
    expect(buildInlineAnswerProposals([q1, q2], [occurrence(q1, 1, 1),
      occurrence(q2, 2, 1, [{ page: 2, line: 2, label: "A" }, { page: 2, line: 3, label: "B" }])])).toEqual([]);
    const different = question("different", 2, "Which invented key turns?");
    expect(buildInlineAnswerProposals([q1, different], [occurrence(q1, 1, 1, [{ page: 1, line: 3, label: "A" }]),
      occurrence(different, 2, 1)])).toEqual([]);
  });

  it("rejects bad labels, missing rows, source-page disagreement, and out-of-order inputs", () => {
    const first = question("first", 1), reveal = question("reveal", 13);
    const firstOccurrence = occurrence(first, 1, 1);
    expect(buildInlineAnswerProposals([first, reveal], [firstOccurrence,
      occurrence(reveal, 13, 1, [{ page: 13, line: 3, label: "J" }])])).toEqual([]);
    expect(buildInlineAnswerProposals([first, reveal], [firstOccurrence])).toEqual([]);
    expect(buildInlineAnswerProposals([first, reveal], [firstOccurrence,
      occurrence(reveal, 14, 1, [{ page: 14, line: 3, label: "A" }])])).toEqual([]);
    expect(buildInlineAnswerProposals([first, reveal], [occurrence(first, 13, 1), firstOccurrence])).toEqual([]);
  });

  it("reports a stored-key conflict without changing the stored key", () => {
    const first = { ...question("first", 1), correctAnswer: { labels: ["A"], evidence: "printed-key" as const } };
    const reveal = { ...question("reveal", 13), correctAnswer: { labels: ["C"], evidence: "printed-key" as const } };
    const proposals = buildInlineAnswerProposals([first, reveal], [occurrence(first, 1, 1),
      occurrence(reveal, 13, 1, [{ page: 13, line: 9, label: "B" }])]);
    expect(proposals).toMatchObject([{ suggestedChoice: "B", conflict: true, reviewReason: "conflicts-with-key",
      storedAnswerLabels: ["A"], answerCopyStoredAnswerLabels: ["C"] }]);
    expect(first.correctAnswer.labels).toEqual(["A"]);
    expect(reveal.correctAnswer.labels).toEqual(["C"]);
  });

  it("uses the same text-only fingerprint for parsed drafts and package rows", () => {
    const prepared = question("one", 1);
    const draft: ParsedQuestionDraft = { stem: "Which invented gate opens?", options: ["A", "B", "C"].map(key => ({ key, text: `Gate ${key}` })),
      confidence: "low", warnings: [] };
    expect(fingerprintParsedQuestionDraft(draft)).toBe(fingerprintPackageQuestion(prepared));
    expect(fingerprintPackageQuestion({ ...prepared, stem: [{ type: "image", assetId: "image" }] })).toBeUndefined();
  });

  it("keeps image-bearing rows in the exact sequence but withholds proposals for their pairs", () => {
    const first = question("first", 1), reveal = question("reveal", 13);
    const media = { ...question("media", 2, "What does the diagram show?"),
      stem: [{ type: "text" as const, text: "What does the diagram show?" }, { type: "image" as const, assetId: "diagram" }] };
    const rows = [first, media, reveal];
    expect(fingerprintPackageQuestion(media)).toBe(fingerprintParsedQuestionDraft({
      stem: "What does the diagram show?", options: ["A", "B", "C"].map(key => ({ key, text: `Gate ${key}` })),
      confidence: "low", warnings: [],
    }));
    expect(buildInlineAnswerProposals(rows, [occurrence(first, 1, 1), occurrence(media, 2, 1),
      occurrence(reveal, 13, 1, [{ page: 13, line: 9, label: "B" }])])).toHaveLength(1);

    const mediaReveal = { ...media, id: "media-reveal", source: { filename: "synthetic.pdf", page: 14 } };
    expect(buildInlineAnswerProposals([media, mediaReveal], [occurrence(media, 2, 1),
      occurrence(mediaReveal, 14, 1, [{ page: 14, line: 9, label: "B" }])])).toEqual([]);
  });

  it("uses unusual choice rows for sequence only and never proposes from them", () => {
    const first = question("first", 1), reveal = question("reveal", 13);
    const unusual = { ...question("unusual", 2, "Unusual source row"), choices: [] };
    expect(fingerprintPackageQuestion(unusual)).toBe(fingerprintParsedQuestionDraft({
      stem: "Unusual source row", options: [], confidence: "low", warnings: [],
    }));
    expect(buildInlineAnswerProposals([first, unusual, reveal], [occurrence(first, 1, 1),
      occurrence(unusual, 2, 1), occurrence(reveal, 13, 1, [{ page: 13, line: 9, label: "B" }])])).toHaveLength(1);
    const unusualReveal = { ...unusual, id: "unusual-reveal", source: { filename: "synthetic.pdf", page: 14 } };
    expect(buildInlineAnswerProposals([unusual, unusualReveal], [occurrence(unusual, 2, 1),
      occurrence(unusualReveal, 14, 1, [{ page: 14, line: 9, label: "B" }])])).toEqual([]);
  });

  it("accepts an unknown-position suffix only after the last proved boundary", () => {
    const first = question("first", 1), reveal = question("reveal", 13);
    const next = question("next", 14, "Another invented item"), unknown = question("unknown", 15, "Unlocated item");
    const suffix = { page: 0, line: 0, fingerprint: fingerprintPackageQuestion(unknown)!, answerMarkers: [] };
    const rows = [first, reveal, next, unknown];
    const located = [occurrence(first, 1, 1), occurrence(reveal, 13, 1, [{ page: 13, line: 9, label: "B" }]),
      occurrence(next, 14, 1)];
    expect(buildInlineAnswerProposals(rows, [...located, suffix])).toHaveLength(1);
    expect(buildInlineAnswerProposals([first, reveal, unknown], [located[0], located[1], suffix])).toEqual([]);
    expect(buildInlineAnswerProposals([first, unknown, reveal], [located[0], suffix, located[1]])).toEqual([]);
    expect(buildInlineAnswerProposals(rows, [...located, { ...suffix, answerMarkers: [{ page: 15, line: 8, label: "B" }] }])).toEqual([]);
  });
});
