import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "./client";
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import type { DownloadReference, DownloadWorkspace } from "./downloadReference";
import type { Course, Term } from "../types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn() }));
vi.mock("./client", () => ({ listAcademicCourses: mocks.list }));
vi.mock("./accountScope", () => ({ academicAccountScope: (key: string) => ({ key, assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
vi.mock("../store", () => ({ useStore: { getState: vi.fn() } }));
vi.mock("../sync/contentDownloads", () => ({ downloadAccountContent: vi.fn() }));
vi.mock("../localVault", () => ({ getVaultWriteCheckpoint: vi.fn(), flushLocalVaultWrites: vi.fn(), assertVaultWritesSince: vi.fn() }));
import { listTermCourses, termQuizNeedsCatalog, termQuizSelection } from "./termCourses";

const course = (index: number, term = "Term 1"): AcademicCourse => ({ id: `course-${index}`, current_revision_id: `revision-${index}`, title: `Module ${index}`,
  module: `Module ${index}`, term, visibility: "shared", review_status: "approved", owned: false, ready_questions: 1, review_questions: 0 });
const question = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({ id, stem: id, source: "imported", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: "2026-10-28", updatedAt: "2026-10-28", ...patch });
const receipt = (index: number, questionIds: string[], patch: Partial<DownloadReference> = {}): SourceDocument => ({
  id: `academic-revision-${index}`, fileType: "axom-academic-reference", title: "Receipt", fileName: "course-reference.json", sizeBytes: 1, rawText: JSON.stringify({
    collectionId: `course-${index}`, revisionId: `revision-${index}`, accountId: "account", status: "complete", warnings: [], term: "Term 1", module: `Module ${index}`,
    templateIds: [], documentIds: [], questionIds, setIds: [], ...patch,
  } satisfies DownloadReference), uploadedAt: "2026-10-28", tags: [], linkedQuestionSetIds: [], libraryOnly: true,
});
const workspace = (documents: SourceDocument[], questions: QuestionRecord[]): DownloadWorkspace & { courses: Course[]; terms: Term[] } => ({ documents, questions, questionSets: [], terms: [], courses: [] });

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockReset(); mocks.assertCurrent.mockReset(); });

describe("complete term catalog", () => {
  it("reads beyond 24 courses using the cursor with no search filter", async () => {
    const first = Array.from({ length: 24 }, (_, index) => course(index));
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([course(24), course(25)]);
    expect(await listTermCourses("Term 1", "account")).toHaveLength(26);
    expect(mocks.list.mock.calls).toEqual([["", "Term 1", undefined], ["", "Term 1", "course-23"]]);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("requests the terminal empty page for an exact multiple of 24", async () => {
    mocks.list.mockResolvedValueOnce(Array.from({ length: 24 }, (_, index) => course(index))).mockResolvedValueOnce([]);
    expect(await listTermCourses("Term 1", "account")).toHaveLength(24);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it("rejects repeated pages rather than looping or silently truncating", async () => {
    const first = Array.from({ length: 24 }, (_, index) => course(index));
    mocks.list.mockResolvedValue(first);
    await expect(listTermCourses("Term 1", "account")).rejects.toThrow("catalog changed");
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it("rejects wrong-term catalog results", async () => {
    mocks.list.mockResolvedValueOnce([course(1, "Term 2")]);
    await expect(listTermCourses("Term 1", "account")).rejects.toThrow("catalog changed");
  });
  it("stops after an in-flight page without fetching another page", async () => {
    let stopped = false;
    mocks.list.mockImplementationOnce(async () => { stopped = true; return Array.from({ length: 24 }, (_, index) => course(index)); });
    await expect(listTermCourses("Term 1", "account", { shouldStop: () => stopped })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.list).toHaveBeenCalledOnce(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("rejects late results after an account changes", async () => {
    mocks.list.mockImplementationOnce(async () => { mocks.assertCurrent.mockImplementation(() => { throw new Error("Account changed"); }); return []; });
    await expect(listTermCourses("Term 1", "account")).rejects.toThrow("Account changed");
  });
});

describe("downloaded term practice", () => {
  it("requires the full catalog for a legacy receipt even when it is beyond the visible page", () => {
    const documents = Array.from({ length: 26 }, (_, index) => receipt(index, [`q-${index}`]));
    const state = workspace(documents, []);
    expect(termQuizNeedsCatalog("account", state)).toBe(false);
    state.documents[25] = receipt(25, ["q-25"], { term: undefined });
    expect(termQuizNeedsCatalog("account", state)).toBe(true);
    expect(termQuizNeedsCatalog("other", state)).toBe(false);
  });
  it("resolves a legacy receipt offline only with one exact hosted owner and a known term", () => {
    const state = workspace([receipt(1, ["q-1"], { term: undefined })], []);
    state.terms = [{ id: "term", name: "Term 1" }];
    const owner: Course = { id: "hosted", code: "academic:course-1", name: "Module 1", termId: "term", files: 0, modules: [] };
    state.courses = [{ ...owner, code: "local" }];
    expect(termQuizNeedsCatalog("account", state)).toBe(true);
    state.courses = [owner];
    expect(termQuizNeedsCatalog("account", state)).toBe(false);
    state.courses.push({ ...owner, id: "duplicate" });
    expect(termQuizNeedsCatalog("account", state)).toBe(true);
    state.courses = [{ ...owner, termId: "missing" }];
    expect(termQuizNeedsCatalog("account", state)).toBe(true);
  });
  it("ignores malformed and other-account receipts when deciding whether the catalog is needed", () => {
    const state = workspace([receipt(1, ["q-1"], { accountId: "other", term: undefined }),
      receipt(2, ["q-2", "q-2"], { term: undefined })], []);
    expect(termQuizNeedsCatalog("account", state)).toBe(false);
  });
  it("includes downloaded ready questions across receipts beyond the catalog page, not held, missing or other account/term questions", () => {
    const documents = Array.from({ length: 26 }, (_, index) => receipt(index, [`q-${index}`]));
    documents.push(receipt(30, ["held", "missing", "no-options"]), receipt(31, ["other-term"], { term: "Term 2" }), receipt(32, ["other-account"], { accountId: "other" }));
    const questions = Array.from({ length: 26 }, (_, index) => question(`q-${index}`));
    questions.push(question("held", { needsReview: true }), question("no-options", { options: [] }), question("other-term"), question("other-account"), question("unrelated"));
    const selection = termQuizSelection("Term 1", "account", workspace(documents, questions));
    expect(selection.questionIds).toEqual(Array.from({ length: 26 }, (_, index) => `q-${index}`));
    expect(selection).toMatchObject({ module: "Term 1", term: "Term 1" });
  });
  it("supports legacy receipts using exact revision metadata or an installed hosted owner, never a title match", () => {
    const state = workspace([receipt(1, ["catalog"], { term: undefined }), receipt(2, ["owner"], { term: undefined }), receipt(3, ["ambiguous"], { term: undefined })],
      [question("catalog"), question("owner"), question("ambiguous")]);
    state.terms = [{ id: "term", name: "T1" }];
    state.courses = [{ id: "hosted", code: "academic:course-2", name: "Module 2", termId: "term", files: 0, modules: [] },
      { id: "local", code: "BPM", name: "Module 3", termId: "term", files: 0, modules: [] }];
    expect(termQuizSelection("Term 1", "account", state, [course(1), { ...course(3), current_revision_id: "different" }]).questionIds).toEqual(["catalog", "owner"]);
  });
  it("excludes a receipt whose saved term conflicts with exact catalog metadata", () => {
    const state = workspace([receipt(1, ["q-1"])], [question("q-1")]);
    expect(termQuizSelection("Term 1", "account", state, [course(1, "Term 2")]).questionIds).toEqual([]);
    expect(termQuizSelection("Term 2", "account", state, [course(1, "Term 2")]).questionIds).toEqual([]);
    expect(termQuizSelection("Term 1", "account", state, [course(1, "T1")]).questionIds).toEqual(["q-1"]);
  });
  it("excludes duplicate or deferred question identities and deduplicates shared membership", () => {
    const state = workspace([receipt(1, ["unique", "duplicate", "deferred"]), receipt(2, ["unique"])],
      [question("unique"), question("duplicate"), question("duplicate"), question("deferred")]);
    state.deferredContent = { accountId: "account", questions: [{ id: "deferred" }], documents: [], sources: [], media: [] };
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["unique"]);
    expect(termQuizSelection("Term 5", "account", state).questionIds).toEqual([]);
  });
});
