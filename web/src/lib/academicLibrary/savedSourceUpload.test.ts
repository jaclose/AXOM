// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import type { PackageQuestion } from "../question-content/package";
import { sha256 } from "../question-content/assets";
import { prepareSavedSourceUpload } from "./savedSourceUpload";

const mocks = vi.hoisted(() => ({ original: vi.fn(), attachment: vi.fn() }));
vi.mock("../decode/sources", () => ({ readSourceOriginal: (...args: unknown[]) => mocks.original(...args) }));
vi.mock("../questionAttachments", async (importOriginal) => ({
  ...await importOriginal<typeof import("../questionAttachments")>(),
  getQuestionAttachmentBlob: (...args: unknown[]) => mocks.attachment(...args),
}));

const text = (value: string) => new TextEncoder().encode(value);
const originalBytes = text("%PDF-1.4 synthetic reviewed source");
const original = new Blob([originalBytes], { type: "application/pdf" });
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
));

async function source() {
  const checksum = await sha256(originalBytes);
  const document: SourceDocument = {
    id: "local-document", title: "Synthetic source", fileName: "sample.pdf", fileType: "pdf",
    uploadedAt: "2026-01-01T00:00:00Z", rawText: "Synthetic source text", pageTexts: ["Synthetic source text"],
    sizeBytes: originalBytes.length, checksum, originalFile: {
      version: 1, sha256: checksum.slice(7), byteSize: originalBytes.length, mimeType: "application/pdf",
    }, tags: [], linkedQuestionSetIds: [], libraryOnly: false,
  };
  const content: PackageQuestion = {
    id: "source-question-1", source: { filename: "sample.pdf", page: 1, questionNumber: 1 },
    stem: [{ type: "text", text: "Synthetic mechanism?" }],
    choices: [
      { id: "choice-a", label: "A", blocks: [{ type: "text", text: "First mechanism" }] },
      { id: "choice-b", label: "B", blocks: [{ type: "text", text: "Second mechanism" }] },
    ],
    correctAnswer: { labels: ["A"], evidence: "printed-key" },
    explanation: [{ type: "text", text: "The printed key identifies the first synthetic mechanism." }],
    assets: [], provenance: { method: "pdf-import", sourceChecksum: checksum },
  };
  const question: QuestionRecord = {
    id: "local-question-1", source: "pdf", content,
    stem: "Synthetic mechanism?",
    options: [{ key: "A", text: "First mechanism" }, { key: "B", text: "Second mechanism" }],
    correctKey: "A", explanation: "The printed key identifies the first synthetic mechanism.",
    status: "unseen", module: "CPR 1", week: 1, sourceDocumentId: document.id,
    tags: [], attempts: [], notes: "PRIVATE LEARNER NOTE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
  return { document, question };
}

beforeEach(() => {
  mocks.original.mockResolvedValue(original);
  mocks.attachment.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("builds one private-ready source course without learner notes or local record IDs", async () => {
  const { document, question } = await source();
  const upload = await prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" });
  expect(upload.metadata).toMatchObject({ term: "Term 1", module: "CPR 1", ready_questions: 1, review_questions: 0 });
  expect(upload.provenance).toMatchObject({ scopeEvidence: "human-reviewed", weekAssignment: "unassigned" });
  const bank = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path.endsWith("bank.json"))!.bytes));
  expect(bank.pkg.questions[0].id).toBe("source-question-1");
  expect(bank.pkg.questions[0].correctAnswer).toEqual({ labels: ["A"], evidence: "printed-key" });
  expect(upload.files.some(file => file.path.endsWith(".pdf") && file.sha256 === document.checksum!.slice(7))).toBe(true);
  expect(bank.sourceText).toEqual({ rawText: "" });
  expect(JSON.stringify(upload)).not.toMatch(/PRIVATE LEARNER NOTE|local-question-1|local-document|Synthetic source text/);
  expect(mocks.original).toHaveBeenCalledWith(document.id, document.checksum);
});

it("includes every question linked to one source without replacing a sibling set", async () => {
  const { document, question } = await source();
  const sibling: QuestionRecord = structuredClone(question);
  sibling.id = "local-question-2";
  sibling.content = { ...structuredClone(question.content!), id: "source-question-2",
    source: { filename: "sample.pdf", page: 2, questionNumber: 2 } };
  const upload = await prepareSavedSourceUpload(document, [question, sibling], { term: "Term 1", module: "CPR 1" });
  expect(upload.metadata.ready_questions).toBe(2);
  const bank = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path.endsWith("bank.json"))!.bytes));
  expect(bank.pkg.questions.map((item: { id: string }) => item.id)).toEqual(["source-question-1", "source-question-2"]);
});

it("accepts an ordinary reviewed text-only PDF import with its exact stored original", async () => {
  const { document, question } = await source();
  question.content = undefined;
  question.extraction = { confidence: "high", reviewed: true, reviewedAt: "2026-01-01T00:00:00Z" };
  question.questionNumber = undefined;
  question.sourcePage = undefined;
  const upload = await prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" });
  const bank = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path.endsWith("bank.json"))!.bytes));
  const stored = bank.pkg.questions[0];
  expect(stored.id).toMatch(/^saved-text-[a-f0-9]{24}$/);
  expect(stored.correctAnswer).toEqual({ labels: ["A"], evidence: "reviewer" });
  expect(stored.provenance).toMatchObject({ method: "manual-transcription", tool: "AXOM reviewed text import",
    sourceChecksum: document.checksum });
  expect(stored.source).toEqual({ filename: "sample.pdf" });
  expect(stored.assets).toEqual([]);
  expect(upload.metadata.ready_questions).toBe(1);
  await expect(prepareSavedSourceUpload(document, [{ ...question, attachments: [{
    id: "notes-image", fileName: "notes.png", mimeType: "image/png", byteSize: png.length,
    altText: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", blobKey: "notes-image",
  }] }], { term: "Term 1", module: "CPR 1" })).rejects.toThrow(/images without a source-linked asset map/);
});

it("refuses a stale key, missing explanation, changed source and absent original", async () => {
  const { document, question } = await source();
  await expect(prepareSavedSourceUpload(document, [{ ...question, correctKey: "B" }], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/differs from its reviewed source/);
  await expect(prepareSavedSourceUpload(document, [{ ...question, explanation: undefined }], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/answer, explanation/);
  await expect(prepareSavedSourceUpload(document, [{ ...question, sourceFile: {
    name: "other.pdf", type: "pdf", size: document.sizeBytes, addedAt: "2026-01-01T00:00:00Z",
  } }], { term: "Term 1", module: "CPR 1" })).rejects.toThrow(/source, answer/);
  const changed = structuredClone(question);
  changed.content!.provenance.sourceChecksum = `sha256:${"0".repeat(64)}`;
  await expect(prepareSavedSourceUpload(document, [changed], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/source, answer/);
  mocks.original.mockResolvedValue(undefined);
  await expect(prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/original source file is missing/);
});

it("rejects local figures absent from the canonical source asset map", async () => {
  const { document, question } = await source();
  question.attachments = [{ id: "local-extra", fileName: "extra.png", mimeType: "image/png", byteSize: png.length,
    altText: "Extra figure", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    blobKey: "local-extra", assetId: "extra-figure" }];
  await expect(prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/do not match its source-linked asset map/);
});

it("requires exact figure bytes and carries source images into the verified course", async () => {
  const { document, question } = await source();
  const imageHash = await sha256(png);
  question.content!.assets = [{ id: "source-figure", filename: "figure.png", mimeType: "image/png", width: 1, height: 1,
    byteSize: png.length, role: "question", questionId: question.content!.id, sourceFile: "sample.pdf", sourcePage: 1,
    checksum: imageHash }];
  question.content!.stem.push({ type: "image", assetId: "source-figure", role: "question", alt: "Synthetic figure" });
  question.stem = "Synthetic mechanism?\n\n[Image: Synthetic figure]";
  question.attachments = [{ id: "local-figure", fileName: "figure.png", mimeType: "image/png", byteSize: png.length,
    width: 1, height: 1, altText: "Synthetic figure", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    blobKey: "local-figure", role: "question", assetId: "source-figure" }];
  await expect(prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" }))
    .rejects.toThrow(/missing or changed source figure/);
  mocks.attachment.mockResolvedValue({ blob: new Blob([png], { type: "image/png" }), mimeType: "image/png",
    byteSize: png.length, questionId: question.id, updatedAt: "2026-01-01T00:00:00Z" });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: () => {} })));
  const upload = await prepareSavedSourceUpload(document, [question], { term: "Term 1", module: "CPR 1" });
  expect(upload.metadata.ready_questions).toBe(1);
  expect(upload.files.find(file => file.path.endsWith("figure.png"))?.sha256).toBe(imageHash.slice(7));
});
