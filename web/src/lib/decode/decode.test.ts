import { describe, expect, it } from "vitest";
import { mergeStates, parseImport, toPortableState } from "../backup";
import type { SourceDocument } from "../library";
import { validateQuestionRecord, type QuestionRecord } from "../questions";
import { makeSeed } from "../seed";
import {
  ANALYSIS_LIMITS, analysisIsCurrent, analysisPages, currentTeaching, mergeQuestionAnalyses, normalizeQuestionAnalyses,
  pendingAnalyses, questionSourceFingerprint, questionSourcePages, withAnalysis, withAnalysisStatus, type QuestionAnalysis,
} from "./index";

const document: SourceDocument = {
  id: "doc-1", title: "Renal review", fileName: "renal-review.pdf", fileType: "pdf", uploadedAt: "2026-10-01T09:00:00.000Z",
  rawText: "", pageTexts: ["Question slide: which segment reabsorbs most sodium?", "Answer slide. The proximal tubule reabsorbs about two thirds."],
  sizeBytes: 1000, checksum: "checksum-1", tags: [], linkedQuestionSetIds: [], libraryOnly: false,
};

const question: QuestionRecord = {
  id: "q-1", source: "pdf", stem: "Which segment reabsorbs most filtered sodium?",
  options: [{ key: "A", text: "Proximal tubule" }, { key: "B", text: "Collecting duct" }, { key: "C", text: "Loop of Henle" }],
  correctKey: "A", explanation: "About two thirds is reabsorbed proximally.", status: "unseen", tags: [], attempts: [],
  sourceDocumentId: "doc-1", sourcePage: 1,
  extraction: { confidence: "medium", reviewed: true, warnings: [], questionSourcePage: 1, answerEvidencePage: 2 },
  createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
};

function analysis(patch: Partial<QuestionAnalysis> = {}): QuestionAnalysis {
  return {
    id: "a-1", questionId: "q-1", sourceFingerprint: questionSourceFingerprint(question, document), version: 1,
    origin: "source", status: "reviewed", concept: "Sodium handling along the nephron",
    rule: "Bulk reabsorption is proximal; fine control is distal.",
    decisiveClues: ["most filtered sodium"], mechanism: [],
    distractors: [{ key: "B", whyWrong: "The collecting duct adjusts the last few percent." }],
    references: [{ documentId: "doc-1", page: 2, role: "teaching", quote: "The proximal tubule reabsorbs about two thirds." }],
    generatedAt: "2026-10-02T09:00:00.000Z",
    ...patch,
  };
}

describe("analyses as they come back from storage", () => {
  it("keeps a well-formed analysis as it is", () => {
    expect(normalizeQuestionAnalyses([analysis()])).toEqual([analysis()]);
  });

  it("stores nothing for a question without teaching", () => {
    expect(normalizeQuestionAnalyses(undefined)).toBeUndefined();
    expect(normalizeQuestionAnalyses([])).toBeUndefined();
    expect(normalizeQuestionAnalyses([{ nonsense: true }])).toBeUndefined();
  });

  it("drops an analysis whole when one of its citations is broken", () => {
    // Keeping the reviewed statement without the page it rested on would claim more than the source supports.
    const broken = { ...analysis(), references: [{ documentId: "doc-1", page: 0, role: "teaching" }] };
    expect(normalizeQuestionAnalyses([broken])).toBeUndefined();
    const badRole = { ...analysis(), references: [{ documentId: "doc-1", page: 2, role: "guess" }] };
    expect(normalizeQuestionAnalyses([badRole])).toBeUndefined();
  });

  it("drops an analysis that teaches nothing, or whose kind is unknown", () => {
    expect(normalizeQuestionAnalyses([analysis({ rule: " ", explanation: undefined, distractors: [] })])).toBeUndefined();
    expect(normalizeQuestionAnalyses([{ ...analysis(), status: "verified" }])).toBeUndefined();
    expect(normalizeQuestionAnalyses([{ ...analysis(), origin: "rumour" }])).toBeUndefined();
    expect(normalizeQuestionAnalyses([{ ...analysis(), version: 2 }])).toBeUndefined();
  });

  it("keeps a source analysis that has a rule and no task", () => {
    // What a source's slides give: a rule and why the others are wrong. Not what the question "asks you to do".
    const kept = normalizeQuestionAnalyses([analysis({ task: "", explanation: "" })]);
    expect(kept).toHaveLength(1);
    expect(kept![0]).not.toHaveProperty("task");
    expect(kept![0]).not.toHaveProperty("explanation");
  });

  it("cuts long text and long quotes to what is kept, and a page's text is never stored whole", () => {
    const page = "word ".repeat(2000);
    const [kept] = normalizeQuestionAnalyses([analysis({
      explanation: "e".repeat(10_000),
      references: [{ documentId: "doc-1", page: 2, role: "slide", quote: page }],
    })])!;
    expect(kept.explanation).toHaveLength(ANALYSIS_LIMITS.explanation);
    expect(kept.references[0].quote!.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.quote);
    expect(page.replace(/\s+/g, " ").startsWith(kept.references[0].quote!)).toBe(true);
  });

  it("keeps a few per question, and a reviewed one is the last to go", () => {
    const many = Array.from({ length: 6 }, (_, index) => analysis({
      id: `p-${index}`, origin: "ai", status: "proposed", generatedAt: `2026-10-0${index + 3}T09:00:00.000Z`,
    }));
    const kept = normalizeQuestionAnalyses([analysis(), ...many])!;
    expect(kept).toHaveLength(ANALYSIS_LIMITS.perQuestion);
    expect(kept[0].id).toBe("a-1");
    expect(kept.slice(1).map((entry) => entry.id)).toEqual(["p-5", "p-4", "p-3"]);
  });
});

describe("whether an analysis still fits its question", () => {
  it("is not disturbed by what the learner does with the question", () => {
    const before = questionSourceFingerprint(question, document);
    const used: QuestionRecord = {
      ...question, status: "incorrect", module: "Renal", week: 4, tags: ["high-yield"], notes: "revisit", marked: true,
      attempts: [{ at: "2026-10-03T09:00:00.000Z", answerKey: "B", status: "incorrect" }],
    };
    expect(questionSourceFingerprint(used, document)).toBe(before);
  });

  it("changes when the question, its key or its source page changes", () => {
    const before = questionSourceFingerprint(question, document);
    expect(questionSourceFingerprint({ ...question, correctKey: "C" }, document)).not.toBe(before);
    expect(questionSourceFingerprint({ ...question, stem: `${question.stem} Explain.` }, document)).not.toBe(before);
    expect(questionSourceFingerprint({ ...question, options: [...question.options].reverse() }, document)).not.toBe(before);
    const reimported = { ...document, checksum: "checksum-2", pageTexts: [document.pageTexts![0], "Answer slide, corrected."] };
    expect(questionSourceFingerprint(question, reimported)).not.toBe(before);
  });

  it("reads only the pages the question's own provenance points at", () => {
    expect(questionSourcePages(question)).toEqual([1, 2]);
    const elsewhere = { ...document, pageTexts: [...document.pageTexts!, "A page about something else."] };
    expect(questionSourceFingerprint(question, elsewhere)).toBe(questionSourceFingerprint(question, document));
    // A document that is not the question's own is not read at all.
    expect(questionSourceFingerprint(question, { ...document, id: "doc-2" })).toBe(questionSourceFingerprint(question));
  });
});

describe("which analysis is taught from", () => {
  it("teaches only from an analysis that is reviewed and still fits", () => {
    const withTeaching = { ...question, analyses: [analysis()] };
    expect(currentTeaching(withTeaching, document)?.id).toBe("a-1");
    expect(currentTeaching({ ...withTeaching, correctKey: "C" }, document)).toBeUndefined();
    expect(currentTeaching({ ...question, analyses: [analysis({ status: "proposed" })] }, document)).toBeUndefined();
    expect(currentTeaching({ ...question, analyses: [analysis({ status: "rejected" })] }, document)).toBeUndefined();
    expect(currentTeaching(question, document)).toBeUndefined();
  });

  it("puts the source's own teaching before a model's reading of it", () => {
    const both = { ...question, analyses: [
      analysis({ id: "ai", origin: "ai", generatedAt: "2026-10-05T09:00:00.000Z" }),
      analysis({ id: "src", origin: "source" }),
    ] };
    expect(currentTeaching(both, document)?.id).toBe("src");
  });

  it("lists proposals that are waiting and still fit", () => {
    const waiting = { ...question, analyses: [analysis({ id: "p", origin: "ai", status: "proposed" }), analysis()] };
    expect(pendingAnalyses(waiting, document).map((entry) => entry.id)).toEqual(["p"]);
    expect(pendingAnalyses({ ...waiting, stem: "Changed." }, document)).toEqual([]);
    expect(analysisIsCurrent(analysis(), { ...question, id: "q-2" }, document)).toBe(false);
  });

  it("lists the pages an analysis cites once each, in order", () => {
    expect(analysisPages(analysis({ references: [
      { documentId: "doc-1", page: 3, role: "slide" }, { documentId: "doc-1", page: 2, role: "teaching" }, { documentId: "doc-1", page: 3, role: "answer" },
    ] }))).toEqual([2, 3]);
  });
});

describe("adding to a question's analyses", () => {
  it("replaces the waiting proposal from the same origin, and leaves the learner's verdicts alone", () => {
    const existing = [analysis(), analysis({ id: "p-old", origin: "ai", status: "proposed" }), analysis({ id: "no", origin: "ai", status: "rejected" })];
    const next = withAnalysis(existing, analysis({ id: "p-new", origin: "ai", status: "proposed", generatedAt: "2026-10-06T09:00:00.000Z" }))!;
    expect(next.map((entry) => entry.id).sort()).toEqual(["a-1", "no", "p-new"]);
  });

  it("retires the reviewed analysis that a newly reviewed one replaces", () => {
    const existing = [analysis({ id: "old", origin: "ai" }), analysis({ id: "new", origin: "ai", status: "proposed" }), analysis({ id: "src" })];
    const next = withAnalysisStatus(existing, "new", "reviewed")!;
    expect(next.map((entry) => [entry.id, entry.status]).sort()).toEqual([["new", "reviewed"], ["src", "reviewed"]]);
    expect(withAnalysisStatus(existing, "new", "rejected")!.find((entry) => entry.id === "old")?.status).toBe("reviewed");
    expect(withAnalysisStatus(existing, "missing", "reviewed")).toEqual(existing);
  });
});

describe("analyses travel with their question", () => {
  it("come through question validation normalized", () => {
    const result = validateQuestionRecord({ ...question, analyses: [analysis(), { broken: true }] });
    expect(result.value?.analyses).toEqual([analysis()]);
    const none = validateQuestionRecord(question);
    expect(none.ok).toBe(true);
    expect(none.value?.analyses).toBeUndefined();
  });

  it("survive a backup and a restore", () => {
    const state = { ...makeSeed(), questions: [{ ...question, analyses: [analysis()] }], documents: [document] };
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.questions?.[0].analyses).toEqual([analysis()]);
  });

  it("are kept from both copies when two devices are merged", () => {
    const reviewedHere = { ...question, updatedAt: "2026-10-04T09:00:00.000Z", analyses: [analysis()] };
    const proposedThere = { ...question, updatedAt: "2026-10-05T09:00:00.000Z", analyses: [analysis({ id: "p", origin: "ai", status: "proposed" })] };
    const merged = mergeStates({ ...makeSeed(), questions: [reviewedHere] }, { ...makeSeed(), questions: [proposedThere] });
    expect(merged.questions?.[0].analyses?.map((entry) => entry.id).sort()).toEqual(["a-1", "p"]);
    // The same analysis on both sides: the copy on the newer record wins.
    const rejectedThere = { ...proposedThere, analyses: [analysis({ status: "rejected" })] };
    expect(mergeQuestionAnalyses(reviewedHere.analyses, rejectedThere.analyses)?.[0].status).toBe("rejected");
    const again = mergeStates({ ...makeSeed(), questions: [reviewedHere] }, { ...makeSeed(), questions: [rejectedThere] });
    expect(again.questions?.[0].analyses).toEqual([analysis({ status: "rejected" })]);
  });
});
