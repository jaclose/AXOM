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
  it("labels reviewed receipt unions as term-wide without inventing a fixed source module", () => {
    const state = workspace([
      receipt(1, ["goer"], { term: "Term 5" }),
      receipt(2, ["ncrs"], { term: "Term 5" }),
      receipt(3, ["other"], { term: "Term 4" }),
    ], [
      question("goer", { module: "GOER", week: 1 }),
      question("ncrs", { module: "NCRS", week: 2 }),
      question("other", { module: "GOER", week: 1 }),
    ]);
    expect(termQuizSelection("Term 5", "account", state)).toMatchObject({
      scopeKind: "term", term: "Term 5", module: "Term 5",
      questionIds: ["goer", "ncrs"],
    });
  });

  it("supports legacy receipts using exact revision metadata or an installed hosted owner, never a title match", () => {
    const state = workspace([receipt(1, ["catalog"], { term: undefined }), receipt(2, ["owner"], { term: undefined }), receipt(3, ["ambiguous"], { term: undefined })],
      [question("catalog"), question("owner"), question("ambiguous")]);
    state.terms = [{ id: "term", name: "T1" }];
    state.courses = [{ id: "hosted", code: "academic:course-2", name: "Module 2", termId: "term", files: 0, modules: [] },
      { id: "local", code: "BPM", name: "Module 3", termId: "term", files: 0, modules: [] }];
    expect(termQuizSelection("Term 1", "account", state, [course(1), { ...course(3), current_revision_id: "different" }]).questionIds).toEqual(["catalog", "owner"]);
  });
  it("keeps a known term's local practice available while an unrelated legacy receipt needs an offline catalog", () => {
    const state = workspace([
      receipt(1, ["known-term"], { term: "Term 5" }),
      receipt(2, ["older-unknown"], { term: undefined }),
    ], [question("known-term"), question("older-unknown")]);
    expect(termQuizNeedsCatalog("account", state)).toBe(true);
    expect(termQuizSelection("Term 5", "account", state).questionIds).toEqual(["known-term"]);
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual([]);
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

  it("preserves explicitly downloaded cross-listed questions in each authorized term", () => {
    const state = workspace([
      receipt(1, ["cross-listed", "term-one-only"]),
      receipt(2, ["cross-listed", "term-two-only"], { term: "Term 2" }),
    ], [question("cross-listed"), question("term-one-only"), question("term-two-only")]);
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["cross-listed", "term-one-only"]);
    expect(termQuizSelection("Term 2", "account", state).questionIds).toEqual(["cross-listed", "term-two-only"]);
  });

  it("continues deduplicating compatible shared membership across equivalent term labels", () => {
    const state = workspace([
      receipt(1, ["shared", "first"]),
      receipt(2, ["shared", "second"], { term: "T01" }),
    ], [question("shared"), question("first"), question("second")]);
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["shared", "first", "second"]);
  });

  it("holds duplicate or missing on-device set identities and their linked questions but preserves clean or loose neighbors", () => {
    const state = workspace([receipt(1, ["ambiguous", "missing", "clean", "loose"], {
      setIds: ["duplicated-set", "missing-set", "clean-set"],
    })], [
      question("ambiguous", { setId: "duplicated-set" }),
      question("missing", { setId: "missing-set" }),
      question("clean", { setId: "clean-set" }),
      question("loose"),
    ]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("duplicated-set"), set("duplicated-set"), set("clean-set")];
    const selected = termQuizSelection("Term 1", "account", state);
    expect(selected.questionIds).toEqual(["clean", "loose"]);
    expect(selected.setIds).toEqual(["clean-set"]);
  });
  it("does not borrow an original set from a different term download receipt", () => {
    const state = workspace([
      receipt(1, ["misbound", "matched", "loose"], { setIds: ["set-1"] }),
      receipt(2, ["separate"], { setIds: ["set-2"] }),
    ], [
      question("misbound", { setId: "set-2" }),
      question("matched", { setId: "set-1" }),
      question("loose"),
      question("separate", { setId: "set-2" }),
    ]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("set-1"), set("set-2")];
    const selection = termQuizSelection("Term 1", "account", state);
    expect(selection.questionIds).toEqual(["matched", "loose", "separate"]);
    expect(selection.setIds).toEqual(["set-1", "set-2"]);
  });

  it("does not borrow a set grant from an unrelated term's receipt", () => {
    const state = workspace([
      receipt(1, ["cross-listed"], { term: "Term 1", setIds: ["set-1"] }),
      receipt(2, ["cross-listed"], { term: "Term 2", setIds: ["set-2"] }),
    ], [question("cross-listed", { setId: "set-2" })]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("set-1"), set("set-2")];
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual([]);
    expect(termQuizSelection("Term 2", "account", state).questionIds).toEqual(["cross-listed"]);
  });

  it("holds questions contradicted by explicit original-set membership without hiding valid or loose neighbors", () => {
    const state = workspace([receipt(1, ["valid", "stale", "loose"], { setIds: ["valid-set", "stale-set"] })], [
      question("valid", { setId: "valid-set" }),
      question("stale", { setId: "stale-set" }),
      question("loose"),
    ]);
    const explicitSet = (id: string, questionIds: string[]) =>
      ({ id, questionIds }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [explicitSet("valid-set", ["valid"]), explicitSet("stale-set", ["different-question"])];
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["valid", "loose"]);
  });

  it("rejects duplicate explicit original-set members without hiding valid or legacy neighbors", () => {
    const state = workspace([receipt(1, ["adjacent", "separated", "valid", "legacy", "loose"], {
      setIds: ["adjacent-set", "separated-set", "valid-set", "legacy-set"],
    })], [
      question("adjacent", { setId: "adjacent-set" }),
      question("separated", { setId: "separated-set" }),
      question("valid", { setId: "valid-set" }),
      question("legacy", { setId: "legacy-set" }),
      question("loose"),
    ]);
    state.questionSets = [
      { id: "adjacent-set", questionIds: ["adjacent", "adjacent"] },
      { id: "separated-set", questionIds: ["separated", "unrelated", "separated"] },
      { id: "valid-set", questionIds: ["valid"] },
      { id: "legacy-set" },
    ] as unknown as typeof state.questionSets;
    const selected = termQuizSelection("Term 1", "account", state);
    expect(selected.questionIds).toEqual(["valid", "legacy", "loose"]);
    expect(selected.setIds).toEqual(["valid-set", "legacy-set"]);
  });

  it("holds malformed declared membership without rejecting legacy sets that omit the list", () => {
    const state = workspace([receipt(1, ["malformed", "legacy", "loose"], { setIds: ["bad-set", "legacy-set"] })], [
      question("malformed", { setId: "bad-set" }),
      question("legacy", { setId: "legacy-set" }),
      question("loose"),
    ]);
    state.questionSets = [
      { id: "bad-set", questionIds: "not-an-array" } as unknown as (typeof state.questionSets)[number],
      { id: "legacy-set" } as unknown as (typeof state.questionSets)[number],
    ];
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["legacy", "loose"]);
  });

  it("preserves same-term cross-listing when one receipt owns the original set", () => {
    const state = workspace([
      receipt(1, ["shared"], { setIds: ["set-1"] }),
      receipt(2, ["shared"], { setIds: ["set-2"] }),
    ], [question("shared", { setId: "set-2" })]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("set-1"), set("set-2")];
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["shared"]);
  });

  it("does not let a different account's deferred recovery hide authorized term questions", () => {
    const state = workspace([receipt(1, ["set-bound", "loose", "neighbor"], { setIds: ["owned-set"] })], [
      question("set-bound", { setId: "owned-set" }), question("loose"), question("neighbor"),
    ]);
    state.questionSets = [{ id: "owned-set" } as unknown as (typeof state.questionSets)[number]];
    state.deferredContent = { accountId: "other", questions: [{ id: "set-bound" }, { id: "loose" }],
      documents: [], sources: [], media: [] };
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["set-bound", "loose", "neighbor"]);
    expect(termQuizSelection("Term 1", "other", state).questionIds).toEqual([]);
  });

  it("continues withholding this account's deferred questions while keeping ready neighbors", () => {
    const state = workspace([receipt(1, ["deferred", "ready"])], [question("deferred"), question("ready")]);
    state.deferredContent = { accountId: "account", questions: [{ id: "deferred" }],
      documents: [], sources: [], media: [] };
    expect(termQuizSelection("Term 1", "account", state).questionIds).toEqual(["ready"]);
  });

});
