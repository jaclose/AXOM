import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "./client";
import type { SourceDocument, QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import type { DownloadReference, DownloadWorkspace } from "./downloadReference";

const mocks = vi.hoisted(() => ({
  state: { documents: [] as SourceDocument[], questions: [] as QuestionRecord[], questionSets: [] as QuestionSet[],
    deferredContent: undefined as DownloadWorkspace["deferredContent"], addDocument: vi.fn() },
  download: vi.fn(), hydrate: vi.fn(), flush: vi.fn(), durable: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn(), enroll: vi.fn(),
}));
vi.mock("../store", () => ({ useStore: { getState: () => mocks.state } }));
vi.mock("./client", () => ({ downloadAcademicCourse: mocks.download, enrollAcademicCourse: mocks.enroll }));
vi.mock("../sync/contentDownloads", () => ({ downloadAccountContent: mocks.hydrate }));
vi.mock("../localVault", () => ({ getVaultWriteCheckpoint: () => 5, flushLocalVaultWrites: mocks.flush, assertVaultWritesSince: mocks.durable }));
vi.mock("./accountScope", () => ({ academicAccountScope: (key: string) => ({ key, assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
import { downloadCourseQuestions, isAcademicCourseDownloaded, readDownloadReference } from "./downloadReference";

const course: AcademicCourse = { id: "course", current_revision_id: "revision", title: "GOER", module: "GOER", term: "Term 1",
  visibility: "shared", review_status: "approved", owned: false, ready_questions: 1, review_questions: 0 };
const saved: DownloadReference = { collectionId: course.id, revisionId: course.current_revision_id, accountId: "account",
  status: "complete", warnings: [], templateIds: ["template"], documentIds: ["source"], questionIds: ["question"], setIds: ["set"],
  bindings: { originals: [], sources: [], assets: [] } };
const doc = (id: string, rawText = ""): SourceDocument => ({ id, rawText, fileType: "text", title: id, fileName: id, uploadedAt: "2026-10-28", sizeBytes: 1,
  tags: [], linkedQuestionSetIds: [], libraryOnly: true });
const receipt = (patch: Partial<DownloadReference> = {}): SourceDocument => ({ ...doc("academic-revision", JSON.stringify({ ...saved, ...patch })), fileType: "axom-academic-reference" });
const question: QuestionRecord = { id: "question", stem: "Synthetic question", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
  source: "imported", correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: "2026-10-28", updatedAt: "2026-10-28" };
const set: QuestionSet = { id: "set", title: "Set", questionIds: ["question"], sourceDocumentIds: ["source"], tags: [], aiEnhanced: false, parserWarnings: [], createdAt: "2026-10-28" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCurrent.mockReset(); mocks.flush.mockReset(); mocks.durable.mockReset(); mocks.hydrate.mockReset(); mocks.download.mockReset();
  Object.assign(mocks.state, { documents: [receipt(), doc("source"), doc("template")], questions: [question], questionSets: [set], deferredContent: undefined });
  mocks.state.addDocument.mockImplementation((document: SourceDocument) => {
    mocks.state.documents = [...mocks.state.documents.filter(item => item.id !== document.id), document];
  });
  mocks.download.mockResolvedValue(saved);
});

describe("academic download references", () => {
  it("accepts a complete same-account receipt, but rejects another account or revision", () => {
    expect(readDownloadReference(mocks.state.documents, course, "account")).toEqual(saved);
    expect(readDownloadReference(mocks.state.documents, course, "other")).toBeUndefined();
    expect(readDownloadReference(mocks.state.documents, { ...course, current_revision_id: "new" }, "account")).toBeUndefined();
  });
  it.each([
    { questionIds: ["question", "question"] }, { status: "partial" as const }, { term: "" }, { module: 42 as unknown as string }, { pendingWeeks: [0] },
  ])("rejects malformed receipt metadata %j", patch => {
    expect(readDownloadReference([receipt(patch)], course, "account")).toBeUndefined();
  });
  it("does not trust duplicate receipt identities", () => {
    expect(readDownloadReference([receipt(), receipt()], course, "account")).toBeUndefined();
  });
  it("requires every document, template, set and question locally, not just the receipt", () => {
    expect(isAcademicCourseDownloaded(course, "account", mocks.state)).toBe(true);
    for (const patch of [{ documents: [receipt(), doc("source")] }, { questions: [] }, { questionSets: [] }, { documents: [receipt(), doc("template")] }]) {
      expect(isAcademicCourseDownloaded(course, "account", { ...mocks.state, ...patch })).toBe(false);
    }
  });
  it("rejects deferred or duplicate on-device questions and old incomplete bindings", () => {
    expect(isAcademicCourseDownloaded(course, "account", { ...mocks.state, questions: [question, question] })).toBe(false);
    expect(isAcademicCourseDownloaded(course, "account", { ...mocks.state, documents: [receipt({ bindings: undefined }), doc("source"), doc("template")] })).toBe(false);
    expect(isAcademicCourseDownloaded(course, "account", { ...mocks.state,
      deferredContent: { accountId: "account", questions: [{ id: "question" }], documents: [], sources: [], media: [] } })).toBe(false);
  });
});

describe("shared questions-only download", () => {
  it("skips installed files, adds offline term scope and never enrolls weeks", async () => {
    const result = await downloadCourseQuestions(course, "account");
    expect(result).toMatchObject({ term: "Term 1", module: "GOER" });
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.flush).toHaveBeenCalledOnce(); expect(mocks.durable).toHaveBeenCalledWith(5);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("reinstalls when a receipt member is missing and preserves pending enrollment intent", async () => {
    mocks.state.documents = [receipt({ pendingWeeks: [3] }), doc("source")];
    const result = await downloadCourseQuestions(course, "account");
    expect(mocks.download).toHaveBeenCalledWith("revision", expect.any(Function), expect.objectContaining({ key: "account" }));
    expect(result.pendingWeeks).toEqual([3]); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("hydrates account references, including templates, before checking the local copy", async () => {
    mocks.state.deferredContent = { accountId: "account", questions: [{ id: "question" }], documents: [], sources: [], media: [] };
    mocks.hydrate.mockImplementation(async () => { mocks.state.deferredContent = undefined; });
    await downloadCourseQuestions(course, "account");
    expect(mocks.hydrate).toHaveBeenCalledWith({ questionIds: ["question"], documentIds: ["source", "template"] });
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("propagates failed durable writes instead of claiming success", async () => {
    mocks.durable.mockImplementation(() => { throw new Error("Storage full"); });
    await expect(downloadCourseQuestions(course, "account")).rejects.toThrow("Storage full");
    expect(isAcademicCourseDownloaded(course, "account", mocks.state)).toBe(false);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    mocks.durable.mockReset();
    await downloadCourseQuestions(course, "account");
    expect(isAcademicCourseDownloaded(course, "account", mocks.state)).toBe(true);
  });
  it("does not adopt an interrupted account download", async () => {
    mocks.state.questions = [];
    mocks.download.mockImplementation(async () => { mocks.assertCurrent.mockImplementation(() => { throw new Error("Account changed"); }); return saved; });
    await expect(downloadCourseQuestions(course, "account")).rejects.toThrow("Account changed");
    expect(mocks.state.addDocument).not.toHaveBeenCalled();
  });
});
