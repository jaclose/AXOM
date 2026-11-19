import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { questionSourceFingerprint, questionVisualIdentity } from "./analysis";
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

  it("counts distinct source-verified diagrams instead of collapsing identical text", () => {
    const makeVisual = (id: string, checksum: string): QuestionRecord => ({
      ...question({ id }),
      content: {
        id, source: { filename: "source.pdf", page: 1 }, stem: [], choices: [],
        provenance: { method: "pdf-import" },
        assets: [{
          id: "figure", questionId: id, role: "question", filename: "figure.png",
          mimeType: "image/png", checksum,
        }],
      },
      attachments: [{
        id: `attachment-${id}`, assetId: "figure", role: "exhibit", blobKey: `blob-${id}`,
        fileName: "figure.png", mimeType: "image/png", byteSize: 128, altText: "",
        createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
      }],
    });
    const first = makeVisual("q-a", `sha256:${"a".repeat(64)}`);
    const second = makeVisual("q-b", `sha256:${"b".repeat(64)}`);
    const copy = makeVisual("q-c", `sha256:${"a".repeat(64)}`);
    const withTeaching = [first, second, copy].map((item) => ({ ...item, analyses: [reviewed(item)] }));
    const [group] = conceptGroups(withTeaching, documents);
    expect(group.questionIds).toEqual(["q-a", "q-b", "q-c"]);
    expect(group.uniqueQuestions).toBe(2);
    expect(group.sources).toEqual([{ documentId: "doc-1", uniqueQuestions: 2 }]);
    expect(group.evidence).toBe("single-source");
  });

  it("does not claim extra evidence from differently imported but unverified figure keys", () => {
    const imported = (id: string, assetId: string, blobKey: string): QuestionRecord => ({
      ...question({ id }),
      content: {
        id, source: { filename: "source.pdf", page: 1 }, stem: [], choices: [],
        provenance: { method: "pdf-import" },
        assets: [{ id: assetId, questionId: id, role: "question", filename: "figure.png", mimeType: "image/png" }],
      },
      attachments: [{
        id: `attachment-${id}`, assetId, role: "exhibit", blobKey,
        fileName: "figure.png", mimeType: "image/png", byteSize: 128, altText: "",
        createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
      }],
    });
    const a = imported("q-unverified-a", "local-a", "blob-a");
    const b = imported("q-unverified-b", "local-b", "blob-b");
    const attachedOnly = question({
      id: "q-unverified-c", attachments: [{
        id: "other-attachment", role: "exhibit", blobKey: "blob-c",
        fileName: "other.png", mimeType: "image/png", byteSize: 256, altText: "",
        createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
      }],
    });
    const items = [a, b, attachedOnly].map((item) => ({ ...item, analyses: [reviewed(item)] }));
    const [group] = conceptGroups(items, documents);
    expect(group.questionIds).toEqual(["q-unverified-a", "q-unverified-b", "q-unverified-c"]);
    expect(group.uniqueQuestions).toBe(1);
    expect(group.evidence).toBe("single-question");
  });

  it("does not let an unknown image inflate separate verified figure evidence", () => {
    const make = (id: string, checksum?: string): QuestionRecord => ({
      ...question({ id }),
      content: {
        id, source: { filename: "source.pdf", page: 1 }, stem: [], choices: [],
        provenance: { method: "pdf-import" },
        assets: [{
          id: `asset-${id}`, questionId: id, role: "question",
          filename: `figure-${id}.png`, mimeType: "image/png", checksum,
        }],
      },
      attachments: [{
        id: `attachment-${id}`, assetId: `asset-${id}`, role: "exhibit",
        blobKey: `blob-${id}`, fileName: `figure-${id}.png`, mimeType: "image/png",
        byteSize: 128, altText: "",
        createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
      }],
    });
    const verifiedA = make("q-verified-a", `sha256:${"a".repeat(64)}`);
    const verifiedB = make("q-verified-b", `sha256:${"b".repeat(64)}`);
    const unknown = make("q-unknown");
    const invalidDigest = make("q-invalid-digest", "not-a-real-content-checksum");
    const oneVerified = [verifiedA, unknown, invalidDigest].map((item) => ({ ...item, analyses: [reviewed(item)] }));
    expect(conceptGroups(oneVerified, documents)[0].uniqueQuestions).toBe(1);
    const twoVerified = [...oneVerified, { ...verifiedB, analyses: [reviewed(verifiedB)] }];
    expect(conceptGroups(twoVerified, documents)[0].uniqueQuestions).toBe(2);
  });

  it("does not count missing or mismatched image bindings or unreviewed mappings as source recurrence", () => {
    const visual = (id: string, suffix: string, bind: "linked" | "missing" | "mismatched", reviewedExtraction = true) => {
      const assetId = `asset-${id}`;
      const base = question({
        id,
        extraction: { confidence: "high", reviewed: reviewedExtraction, warnings: [] },
        content: {
          id, source: { filename: "source.pdf", page: 1 }, stem: [], choices: [],
          provenance: { method: "pdf-import" },
          assets: [{
            id: assetId, questionId: id, role: "question", filename: "figure.png",
            mimeType: "image/png", checksum: `sha256:${suffix.repeat(64)}`,
          }],
        },
        ...(bind === "missing" ? {} : {
          attachments: [{
            id: `exhibit-${id}`, assetId: bind === "linked" ? assetId : "wrong-asset-id",
            role: "exhibit" as const, blobKey: `blob-${id}`, fileName: "figure.png",
            mimeType: "image/png", byteSize: 128, altText: "",
            createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
          }],
        }),
      });
      return { ...base, analyses: [reviewed(base)] };
    };
    const ready = visual("q-ready-image", "a", "linked");
    const missing = visual("q-missing-image", "b", "missing");
    const mismatched = visual("q-mismatched-image", "c", "mismatched");
    const unreviewed = visual("q-unreviewed-image", "d", "linked", false);
    expect([ready, missing, mismatched, unreviewed].map(questionMappingStatus))
      .toEqual(["ready", "unresolved", "unresolved", "review-suggested"]);
    expect(questionVisualIdentity(ready)).not.toBe("unverified-figure");
    expect(questionVisualIdentity(missing)).toBe("unverified-figure");
    expect(questionVisualIdentity(mismatched)).toBe("unverified-figure");
    const [group] = conceptGroups([ready, missing, mismatched, unreviewed], documents);
    expect(group.questionIds).toEqual(["q-ready-image"]);
    expect(group.uniqueQuestions).toBe(1);
    expect(group.sources).toEqual([{ documentId: "doc-1", uniqueQuestions: 1 }]);
    expect(group.evidence).toBe("single-question");
    expect(conceptGroups([missing, mismatched, unreviewed], documents)).toEqual([]);
  });

  it("normalizes canonical crop coordinates instead of insertion-ordered object keys", () => {
    const make = (id: string, crop: { left: number; top: number; right: number; bottom: number }) => {
      const base = question({
        id,
        content: {
          id, source: { filename: "source.pdf", page: 1 }, stem: [], choices: [],
          provenance: { method: "pdf-import" },
          assets: [{
            id: "figure", questionId: id, role: "question", filename: "figure.png",
            mimeType: "image/png", checksum: `sha256:${"a".repeat(64)}`, crop,
          }],
        },
        attachments: [{
          id: `attachment-${id}`, assetId: "figure", role: "exhibit", blobKey: `blob-${id}`,
          fileName: "figure.png", mimeType: "image/png", byteSize: 128, altText: "",
          createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
        }],
      });
      return { ...base, analyses: [reviewed(base)] };
    };
    const a = make("q-crop-a", { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 });
    const b = make("q-crop-b", { bottom: 0.8, right: 0.9, top: 0.2, left: 0.1 });
    const changed = make("q-crop-changed", { left: 0.1, top: 0.2, right: 0.7, bottom: 0.8 });
    expect(questionVisualIdentity(a)).toBe(questionVisualIdentity(b));
    expect(questionVisualIdentity(changed)).not.toBe(questionVisualIdentity(a));
    const [equivalent] = conceptGroups([a, b], documents);
    expect(equivalent.questionIds).toEqual(["q-crop-a", "q-crop-b"]);
    expect(equivalent.uniqueQuestions).toBe(1);
    expect(equivalent.sources).toEqual([{ documentId: "doc-1", uniqueQuestions: 1 }]);
    const [distinct] = conceptGroups([a, b, changed], documents);
    expect(distinct.uniqueQuestions).toBe(2);
    expect(distinct.evidence).toBe("single-source");
  });

  it("treats actually placed image choices as distinct evidence without trusting import IDs or changed keys", () => {
    const make = (id: string, swap: boolean, assetPrefix: string, correctKey = "A", placed = true) => {
      const firstId = `asset-${assetPrefix}-first`;
      const secondId = `asset-${assetPrefix}-second`;
      const asset = (assetId: string, digest: string) => ({
        id: assetId, questionId: id, role: "choice" as const,
        filename: "choice.png", mimeType: "image/png", checksum: `sha256:${digest.repeat(64)}`,
      });
      const base = question({
        id, correctKey,
        content: {
          id, source: { filename: "source.pdf", page: 1 }, stem: [],
          choices: [
            { id: `${id}-a`, label: "A", blocks: placed ? [{ type: "image", assetId: swap ? secondId : firstId }] : [] },
            { id: `${id}-b`, label: "B", blocks: placed ? [{ type: "image", assetId: swap ? firstId : secondId }] : [] },
          ],
          provenance: { method: "pdf-import" },
          assets: [asset(firstId, "a"), asset(secondId, "b")],
        },
        attachments: [firstId, secondId].map((assetId) => ({
          id: `attachment-${id}-${assetId}`, assetId, role: "exhibit" as const,
          blobKey: `blob-${assetId}`, fileName: "choice.png", mimeType: "image/png",
          byteSize: 128, altText: "",
          createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
        })),
      });
      return { ...base, analyses: [reviewed(base)] };
    };
    const original = make("q-ordered-a", false, "first-import");
    const reimport = make("q-ordered-copy", false, "second-import");
    const swapped = make("q-ordered-swapped", true, "third-import");
    const changedKeyOnly = make("q-ordered-rekeyed", false, "fourth-import", "B");
    expect([original, reimport, swapped, changedKeyOnly].map(questionMappingStatus))
      .toEqual(["ready", "ready", "ready", "ready"]);
    expect(questionVisualIdentity(original)).toBe(questionVisualIdentity(reimport));
    expect(questionVisualIdentity(original)).not.toBe(questionVisualIdentity(swapped));
    expect(questionVisualIdentity(original)).toBe(questionVisualIdentity(changedKeyOnly));
    const [group] = conceptGroups([original, reimport, swapped], documents);
    expect(group.questionIds).toEqual(["q-ordered-a", "q-ordered-copy", "q-ordered-swapped"]);
    expect(group.uniqueQuestions).toBe(2);
    expect(group.sources).toEqual([{ documentId: "doc-1", uniqueQuestions: 2 }]);
    expect(group.evidence).toBe("single-source");
    expect(conceptGroups([original, reimport, changedKeyOnly], documents)[0].uniqueQuestions).toBe(1);
    // A legacy copy may retain the same source digests while losing only
    // placement metadata. That absence cannot establish an extra instance.
    const unplaced = make("q-ordered-unplaced", false, "legacy-import", "A", false);
    expect(questionMappingStatus(unplaced)).toBe("ready");
    expect(conceptGroups([original, reimport, unplaced], documents)[0].uniqueQuestions).toBe(1);
    expect(conceptGroups([original, swapped, unplaced], documents)[0].uniqueQuestions).toBe(2);
    expect(conceptGroups([unplaced, swapped, original], documents)[0].uniqueQuestions).toBe(2);
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
