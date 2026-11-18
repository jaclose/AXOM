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
  it("refuses provenance-only text without modifying the saved answer or evidence", () => {
    const source = { ...question, explanation: "PowerPoint slide note 12 explicitly marks A. The supplied notes do not provide a teaching rationale." };
    const before = JSON.stringify(source);
    expect(() => publish({ openedQuestion: source, liveQuestion: source })).toThrow(/changed while publishing/);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("uses the current reviewed public projection while excluding private notes and source metadata", () => {
    const snapshot = publish();
    expect(snapshot.title).toBe(set.title);
    expect(snapshot.questions).toHaveLength(1);
    expect(snapshot.questions[0].correctKey).toBe("A");
    expect(snapshot.questions[0].id).toBe("shared-question-1");
    // "anatomy" is an authored tag, not visible stem evidence for a
    // generated pre-answer diagram hint. Preserve it without inventing intent.
    expect(snapshot.questions[0].tags).toEqual(["anatomy"]);
    expect(snapshot.tags).not.toContain("visual:intent:anatomical-schematic");
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
    expect(() => publish({ liveQuestion: { ...question, courseId: "private-course" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, module: "private-module" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, setId: "different-origin-set" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, createdAt: "2026-11-07T15:00:00.000Z" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveSet: { ...set, questionIds: ["another-question"] } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveSet: null })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: null })).toThrow(/changed while publishing/);
  });

  const silentSetRevisions: Array<[string, QuestionSet]> = [
    ["course filing", { ...set, scope: { courseId: "different-private-course", module: "M1" } }],
    ["parent lineage", { ...set, parentSetId: "new-parent" }],
    ["same-ID replacement", { ...set, createdAt: "2026-11-07T12:00:00.000Z" }],
    ["imported origin", { ...set, importProvenance: {
      version: 1 as const, shareId: "other-import", contentDigest: "a".repeat(64),
    } }],
    ["filter provenance", { ...set, filterSnapshot: { courseId: "different-private-course" } }],
    ["seeded order", { ...set, ordering: "random" as const, seed: "different-seed" }],
    ["parser warning review", { ...set, parserWarnings: ["Source questions require review"] }],
    ["AI-enhancement provenance", { ...set, aiEnhanced: true }],
  ];
  it.each(silentSetRevisions)("refuses publishing after %s changed without any question timestamp update", (_label, liveSet) => {
    expect(() => publish({ liveSet })).toThrow(/changed while publishing/);
  });

  it("accepts an unchanged scope and imported origin after a legitimate review", () => {
    const original: QuestionSet = { ...set, scope: { courseId: "approved-course" },
      importProvenance: { version: 1, shareId: "source-share", contentDigest: "b".repeat(64) } };
    const snapshot = publish({ openedSet: original, liveSet: { ...original } });
    expect(snapshot.questions).toHaveLength(1);
  });

  it("revokes stale publication attestations after silent rich source revisions", () => {
    const rich: NonNullable<QuestionRecord["content"]> = {
      id: "source-q-1",
      source: { filename: "vascular-source.pdf", page: 3 },
      stem: [{ type: "text", text: "What arterial layer contains vascular smooth muscle?" }],
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "Tunica media" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Tunica intima" }] },
      ],
      assets: [],
      provenance: { method: "pdf-import", sourceChecksum: `sha256:${"a".repeat(64)}` },
    };
    const opened = { ...question, content: rich };
    const modified = { ...opened, content: { ...rich,
      provenance: { ...rich.provenance, sourceChecksum: `sha256:${"b".repeat(64)}` },
    } };
    // Same public stem, answer, explanation, citation and updatedAt. The
    // underlying rich source is different and requires renewed review.
    expect(() => publish({ openedQuestion: opened, liveQuestion: modified })).toThrow(/changed while publishing/);
    expect(publish({ openedQuestion: opened, liveQuestion: opened }).questions).toHaveLength(1);
    expect(JSON.stringify(publish({ openedQuestion: opened, liveQuestion: opened }))).not.toContain("sourceChecksum");
  });

  it("revokes stale source attestations when private teaching analyses change without public or timestamp changes", () => {
    const reviewed: NonNullable<QuestionRecord["analyses"]>[number] = {
      id: "source-analysis-1", questionId: question.id,
      sourceFingerprint: "source-evidence-v1", version: 1, origin: "source",
      status: "reviewed", concept: "Arterial smooth muscle",
      decisiveClues: ["Tunica media"], mechanism: ["Smooth muscle controls caliber"],
      distractors: [{ key: "B", whyWrong: "Tunica intima is lined by endothelium." }],
      references: [{ documentId: "private-slide-1", page: 3, role: "teaching", quote: "Tunica media contains smooth muscle." }],
      generatedAt: date,
    };
    const opened = { ...question, analyses: [reviewed] };
    const changedReview = { ...opened, analyses: [{ ...reviewed, status: "rejected" as const }] };
    const changedEvidence = { ...opened, analyses: [{
      ...reviewed, references: [{ ...reviewed.references[0], documentId: "different-source-document" }],
    }] };
    // These private source revisions leave stem, key, explanation, citation,
    // public snapshot and updatedAt unchanged. Neither old confirmation covers them.
    expect(() => publish({ openedQuestion: opened, liveQuestion: changedReview })).toThrow(/changed while publishing/);
    expect(() => publish({ openedQuestion: opened, liveQuestion: changedEvidence })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: opened })).toThrow(/changed while publishing/);
    const unchanged = publish({ openedQuestion: opened, liveQuestion: opened });
    expect(unchanged.questions[0].correctKey).toBe("A");
    expect(JSON.stringify(unchanged)).not.toMatch(/private-slide-1|source-analysis-1|different-source-document/);
    expect(question.correctKey).toBe("A");
  });

  it("invalidates stale source and rights review when a private image is removed without a timestamp change", () => {
    const image: NonNullable<QuestionRecord["attachments"]>[number] = {
      id: "private-source-exhibit", fileName: "restricted-micrograph.png",
      mimeType: "image/png", byteSize: 4096, width: 64, height: 64,
      altText: "Private study image", blobKey: "private-local-image",
      createdAt: date, updatedAt: date, role: "exhibit",
    };
    const openedWithImage = { ...question, attachments: [image] };
    const liveAfterRemoval = { ...openedWithImage, attachments: [] };
    // The live question is now text-only and the public snapshot, answer key
    // and updatedAt are identical. The old image-bearing source review is not.
    expect(liveAfterRemoval.updatedAt).toBe(openedWithImage.updatedAt);
    expect(() => publish({ openedQuestion: openedWithImage, liveQuestion: liveAfterRemoval }))
      .toThrow(/changed while publishing/);
    const fresh = publish({ openedQuestion: liveAfterRemoval, liveQuestion: liveAfterRemoval });
    expect(fresh.questions[0].correctKey).toBe("A");
    expect(JSON.stringify(fresh)).not.toMatch(/private-source-exhibit|restricted-micrograph|private-local-image/);
    expect(question.correctKey).toBe("A");
  });

  it.each([
    ["case and spacing equivalent choices", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: " TUNICA   MEDIA " },
    ] }],
    ["HTML-escaped duplicate choice", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: "Tunica&nbsp;media" },
    ] }],
    ["percent-encoded duplicate choice", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: "Tunica%20media" },
    ] }],
    ["nested percent-encoded duplicate choice", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: "Tunica%2520media" },
    ] }],
    ["invisible-mark duplicate choice", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: "Tuni\u200Bca media" },
    ] }],
    ["encoded blank alternative", { options: [
      { key: "A", text: "Tunica media" }, { key: "B", text: "&#32;&nbsp;" },
    ] }],
    ["nested encoded blank stem", { stem: "%2520&nbsp;\u200B" }],
  ] as Array<[string, Partial<QuestionRecord>]>)(
    "holds %s at final submission even with a previously stored key and explanation",
    (_label, patch) => {
      const source = { ...question, ...patch };
      const original = JSON.stringify(source);
      expect(() => publish({ openedQuestion: source, liveQuestion: source }))
        .toThrow(/unreadable question stem|indistinguishable answer choices/i);
      expect(JSON.stringify(source)).toBe(original);
      expect(source.correctKey).toBe("A");
      expect(source.explanation).toBe(question.explanation);
    },
  );

  it.each([
    ["fullwidth duplicate label", "Ａ"],
    ["HTML-encoded duplicate label", "&#65;"],
    ["double percent-encoded duplicate label", "%2541"],
    ["invisible-mark duplicate label", "A\u200B"],
    ["case-only duplicate label", "a"],
    ["encoded blank label", "&#32;&nbsp;"],
  ])("holds %s before publication without reassigning the verified answer", (_name, alternativeKey) => {
    const source: QuestionRecord = {
      ...question,
      options: [
        { key: "A", text: "Tunica media" },
        { key: alternativeKey, text: "Tunica intima" },
      ],
    };
    const original = JSON.stringify(source);
    expect(() => publish({ openedQuestion: source, liveQuestion: source }))
      .toThrow(/ambiguous answer-choice labels/i);
    expect(JSON.stringify(source)).toBe(original);
    expect(source.correctKey).toBe("A");
  });

  it("preserves genuine clinical contrasts while checking text integrity", () => {
    const source: QuestionRecord = {
      ...question,
      stem: "Which cell surface marker is characteristic of helper T lymphocytes?",
      options: [
        { key: "A", text: "CD4%2B T lymphocytes" },
        { key: "B", text: "CD4- T lymphocytes" },
        { key: "C", text: "CD8+ T lymphocytes" },
      ],
      explanation: "Helper T lymphocytes commonly express CD4 and coordinate adaptive immune responses through cytokine signaling.",
      choiceRationales: {
        A: "CD4 is a characteristic marker of helper T lymphocytes.",
        B: "CD4-negative cells are not defined as helper T cells by that marker.",
        C: "CD8 is characteristic of cytotoxic T lymphocytes.",
      },
    };
    const original = JSON.stringify(source);
    const snapshot = publish({ openedQuestion: source, liveQuestion: source });
    expect(snapshot.questions[0].correctKey).toBe("A");
    expect(snapshot.questions[0].options[0].text).toBe("CD4%2B T lymphocytes");
    expect(JSON.stringify(source)).toBe(original);
  });

  it("never publishes newly held, unexplained or media-dependent questions", () => {
    expect(() => publish({ liveQuestion: { ...question, needsReview: true } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, explanation: "" } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, attachments: [{ assetId: "private-image" }] as never } })).toThrow(/changed while publishing/);
    expect(() => publish({ liveQuestion: { ...question, correctKey: undefined } })).toThrow(/changed while publishing/);
  });
});
