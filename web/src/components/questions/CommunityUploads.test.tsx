// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CommunityUploads } from "./CommunityUploads";

const ids = {
  collection: "11111111-1111-4111-8111-111111111111",
  revision: "22222222-2222-4222-8222-222222222222",
  privateCollection: "33333333-3333-4333-8333-333333333333",
  privateRevision: "44444444-4444-4444-8444-444444444444",
};
const mocks = vi.hoisted(() => ({
  account: { id: "owner-1" as string | undefined, phase: "signed-in" as "signed-in" | "signed-out" | "loading" | "unconfigured" },
  openSettings: vi.fn(),
  workspace: { questionSets: [] as unknown[], questions: [] as unknown[], documents: [] as unknown[] },
  list: vi.fn(), preview: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), review: vi.fn(),
  download: vi.fn(), reviewer: vi.fn(), owned: vi.fn(),
  explanations: vi.fn(), prepareSaved: vi.fn(), upload: vi.fn(), academicClient: vi.fn(),
  saveReference: vi.fn(),
}));
vi.mock("../../lib/store", () => {
  const useStore = (select: (value: typeof mocks.workspace) => unknown) => select(mocks.workspace);
  useStore.getState = () => mocks.workspace;
  return { useStore };
});
vi.mock("../../lib/account/accountStore", () => {
  const state = () => ({ user: mocks.account.id ? { id: mocks.account.id } : null, phase: mocks.account.phase });
  const useAccount = (select: (value: ReturnType<typeof state>) => unknown) => select(state());
  useAccount.getState = state;
  return { useAccount };
});
vi.mock("../../lib/uiStore", () => ({ useUi: { getState: () => ({ requestSettings: mocks.openSettings }) } }));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: (id: string) => ({ key: id,
    assertCurrent: () => { if (mocks.account.id !== id) throw new Error("The account changed."); }, dispose: () => {},
  }),
}));
vi.mock("../../lib/academicLibrary/community", () => ({
  listCommunityUploads: (...args: unknown[]) => mocks.list(...args),
  communityPreview: (...args: unknown[]) => mocks.preview(...args),
  submitCommunityUpload: (...args: unknown[]) => mocks.submit(...args),
  withdrawCommunityUpload: (...args: unknown[]) => mocks.withdraw(...args),
  reviewCommunityUpload: (...args: unknown[]) => mocks.review(...args),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
  downloadAcademicCourse: (...args: unknown[]) => mocks.download(...args),
  academicClient: (...args: unknown[]) => mocks.academicClient(...args),
}));
vi.mock("../../lib/academicLibrary/savedSourceUpload", () => ({
  prepareSavedSourceUpload: (...args: unknown[]) => mocks.prepareSaved(...args),
}));
vi.mock("../../lib/academicLibrary/upload", () => ({
  uploadAcademicCourse: (...args: unknown[]) => mocks.upload(...args),
}));
vi.mock("../../lib/academicLibrary/explanationReview", () => ({
  inspectStoredRevisionExplanations: (...args: unknown[]) => mocks.explanations(...args),
}));
vi.mock("../../lib/academicLibrary/communityReference", () => ({
  saveCommunityReference: (...args: unknown[]) => mocks.saveReference(...args),
}));
vi.mock("../../lib/academicLibrary/ownedCourses", () => ({
  listOwnedAcademicCourses: (...args: unknown[]) => mocks.owned(...args),
  ownedCourseStatus: (course: { visibility: string }) => course.visibility,
}));
vi.mock("../tracker/AcademicCourseUpload", () => ({ AcademicCourseUpload: () => <p>Prepared package uploader</p> }));
vi.mock("./QuestionSetLibrarySubmitDialog", () => ({
  QuestionSetLibrarySubmitDialog: ({ set, onClose }: { set: { title: string; questionIds: string[] }; onClose: () => void }) =>
    <div role="dialog" aria-label={`Submit ${set.title}`}>
      <p>{set.questionIds.length} questions selected for academic review</p>
      <button type="button" onClick={onClose}>Close set review</button>
    </div>,
}));
vi.mock("./CommunityQuestionSetLibrary", () => ({
  CommunityQuestionSetLibrary: () => <section aria-label="Approved Community Question Sets">Approved standalone sets</section>,
}));

const row = { id: ids.collection, title: "Current course", module: "NCRS", term: "Term 4",
  current_revision_id: ids.revision, ready_questions: 8, review_questions: 2,
  submitted_at: "2026-11-01T12:00:00Z", owned: false, status: "unreviewed" };

describe("Community Uploads", () => {
  beforeEach(() => {
    mocks.account.id = "owner-1";
    mocks.account.phase = "signed-in";
    mocks.workspace.questionSets = [];
    mocks.workspace.questions = [];
    mocks.workspace.documents = [];
    mocks.list.mockResolvedValue([row]);
    mocks.preview.mockResolvedValue({ id: ids.revision, collection_id: ids.collection, template_text: "Week 1", ready_questions: 8, review_questions: 2 });
    mocks.submit.mockResolvedValue(undefined);
    mocks.withdraw.mockResolvedValue(undefined);
    mocks.review.mockResolvedValue(undefined);
    mocks.download.mockResolvedValue({ questionIds: ["q1", "q2"] });
    mocks.saveReference.mockResolvedValue(undefined);
    mocks.reviewer.mockResolvedValue(false);
    mocks.explanations.mockResolvedValue({ collectionId: ids.collection, revisionId: ids.revision,
      contentHash: "a".repeat(64), readyQuestions: 8, explainedReadyQuestions: 8, missingExplanations: 0 });
    mocks.owned.mockResolvedValue([]);
    mocks.academicClient.mockResolvedValue({});
    mocks.upload.mockResolvedValue({ status: "active", collection_id: ids.privateCollection, revision_id: ids.privateRevision });
    mocks.prepareSaved.mockResolvedValue({ metadata: { ready_questions: 1, term: "Term 4", module: "NCRS" } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("lets an independent Question Set be selected and reviewed without a source file, term, or course", () => {
    mocks.workspace.questionSets = [{
      id: "local-set-1", title: "Standalone renal questions", questionIds: ["q-1"],
      sourceDocumentIds: [], tags: ["renal"], aiEnhanced: false,
      createdAt: "2026-11-06T12:00:00.000Z", parserWarnings: [], kind: "custom",
    }];
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Share a Question Set" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Share a course" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "My Question Set" }), { target: { value: "local-set-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit set" }));
    expect(screen.getByRole("dialog", { name: "Submit Standalone renal questions" })).toBeTruthy();
    expect(screen.getByText("1 questions selected for academic review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close set review" }));
    expect(screen.queryByRole("dialog", { name: /Standalone renal questions/ })).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("only loads the approved Question Set catalog on request", () => {
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.queryByLabelText("Approved Community Question Sets")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browse approved Question Sets" }));
    expect(screen.getByLabelText("Approved Community Question Sets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide approved Question Sets" }));
    expect(screen.queryByLabelText("Approved Community Question Sets")).toBeNull();
  });

  it("points students with no saved Question Sets to Question Bank rather than requiring a course", () => {
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Create one in Question Bank" }).getAttribute("href")).toBe("#questions");
  });

  it("requires sign-in and keeps unreviewed courses outside the official catalog", () => {
    mocks.account.id = undefined;
    mocks.account.phase = "signed-out";
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByText("Sign in to browse and contribute")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open account settings" }));
    expect(mocks.openSettings).toHaveBeenCalledWith("account");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("offers personal practice when the account service is unavailable", () => {
    mocks.account.id = undefined;
    mocks.account.phase = "unconfigured";
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByText("Course exchange is unavailable here")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Question Bank" }).getAttribute("href")).toBe("#questions");
    expect(screen.queryByRole("button", { name: "Open account settings" })).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("shows a calm account check before sign-in status resolves", () => {
    mocks.account.id = undefined;
    mocks.account.phase = "loading";
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Checking your account");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("shows the unreviewed state, previews safely, and downloads the exact revision for inspection", async () => {
    const openLibrary = vi.fn();
    render(<CommunityUploads onOpenLibrary={openLibrary} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    expect(within(card).getByText("Unreviewed")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Approve for official catalog/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Preview course" }));
    expect(await within(card).findByText("Week 1")).toBeTruthy();
    expect(mocks.preview).toHaveBeenCalledWith(ids.collection, ids.revision, "owner-1");
    fireEvent.click(within(card).getByRole("button", { name: "Download to practice" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(ids.revision, expect.any(Function), expect.objectContaining({ key: "owner-1" })));
    expect(mocks.saveReference.mock.calls.map(call => call.slice(0, 3))).toEqual([
      [ids.revision, "owner-1", undefined], [ids.revision, "owner-1", ["q1", "q2"]],
    ]);
    fireEvent.click(await within(card).findByRole("button", { name: /Open saved questions/ }));
    expect(openLibrary).toHaveBeenCalledOnce();
  });

  it("does not begin a download when its durable Unreviewed marker cannot be saved", async () => {
    mocks.saveReference.mockRejectedValueOnce(new Error("Local status could not be saved"));
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Download to practice" }));
    expect(await screen.findByText("Local status could not be saved")).toBeTruthy();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("shows a card action failure on that card even when the result list is long", async () => {
    const many = Array.from({ length: 24 }, (_, index) => ({ ...row,
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, title: `Shared course ${index + 1}` }));
    mocks.list.mockResolvedValue(many);
    mocks.preview.mockRejectedValueOnce(new Error("Preview could not be loaded"));
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const firstCard = (await screen.findByText("Shared course 1")).closest("article")!;
    expect(await screen.findByText("Shared course 24")).toBeTruthy();
    fireEvent.click(within(firstCard).getByRole("button", { name: "Preview course" }));
    const alert = await within(firstCard).findByRole("alert");
    expect(alert.textContent).toBe("Preview could not be loaded");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("submits only a selected private revision after an explicit rights attestation", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.owned.mockResolvedValue([{ id: ids.privateCollection, current_revision_id: ids.privateRevision,
      term: "Term 2", module: "NB1", ready_questions: 4, review_questions: 1, visibility: "private" }]);
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show my private courses" }));
    fireEvent.click(await screen.findByRole("button", { name: /Term 2 · NB1/ }));
    const submit = screen.getByRole("button", { name: "Submit as Unreviewed" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course/ }));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(ids.privateCollection, ids.privateRevision, "owner-1", true));
    expect(await screen.findByText(/Submitted to Community Uploads as Unreviewed/)).toBeTruthy();
  });

  it("checks a saved source, then saves and submits its exact revision as Unreviewed", async () => {
    const document = { id: "doc-1", title: "NCRS source", fileName: "source.pdf", fileType: "pdf",
      checksum: "a".repeat(64), originalFile: { version: 1, sha256: "a".repeat(64), byteSize: 10, mimeType: "application/pdf" } };
    const question = { id: "local-q1", sourceDocumentId: "doc-1", updatedAt: "2026-11-01T12:00:00Z",
      module: "NCRS", stem: "Synthetic stem?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
      correctKey: "A", explanation: "Source explanation.", attempts: [], tags: [] };
    mocks.workspace.documents = [document];
    mocks.workspace.questionSets = [{ id: "set-1", title: "Saved source", kind: "source", tags: [], sourceDocumentIds: ["doc-1"] }];
    mocks.workspace.questions = [question];
    mocks.list.mockResolvedValue([]);
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Saved source" }), { target: { value: "doc-1" } });
    expect(screen.getByText(/all 1 questions from 1 saved set/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Term confirmed from the source" }), { target: { value: "Term 4" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /checked this source's term, module, answers and explanations/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved source" }));
    await waitFor(() => expect(mocks.prepareSaved).toHaveBeenCalledWith(document, [question],
      { term: "Term 4", module: "NCRS" }, expect.any(Function)));
    const share = await screen.findByRole("button", { name: "Save and share as Unreviewed" }) as HTMLButtonElement;
    expect(screen.getByText(/until an academic reviewer approves it/)).toBeTruthy();
    expect(screen.queryByText(/until a host approves it/)).toBeNull();
    expect(share.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share these questions/ }));
    fireEvent.click(share);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({}, "owner-1", expect.objectContaining({ metadata: expect.objectContaining({ ready_questions: 1 }) }), expect.any(Function), expect.any(Function)));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(ids.privateCollection, ids.privateRevision, "owner-1", true));
    expect(await screen.findByText(/Shared in Community Uploads as Unreviewed/)).toBeTruthy();
  });

  it("keeps an unready saved source local and explains what to repair", () => {
    mocks.workspace.documents = [{ id: "doc-1", title: "Held source", checksum: "a".repeat(64), originalFile: {} }];
    mocks.workspace.questionSets = [{ id: "set-1", kind: "source", tags: [], sourceDocumentIds: ["doc-1"] }];
    mocks.workspace.questions = [{ id: "local-q1", sourceDocumentId: "doc-1", updatedAt: "now", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
      explanation: "", attempts: [], tags: [] }];
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Saved source" }), { target: { value: "doc-1" } });
    expect(screen.getByText(/Finish the missing answer reviews and explanations/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check saved source" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.prepareSaved).not.toHaveBeenCalled();
  });

  it("keeps the verified private revision available if community submission fails", async () => {
    mocks.workspace.documents = [{ id: "doc-1", title: "Synthetic source", checksum: "a".repeat(64), originalFile: {} }];
    mocks.workspace.questionSets = [{ id: "set-1", kind: "source", tags: [], sourceDocumentIds: ["doc-1"] }];
    mocks.workspace.questions = [{ id: "local-q1", sourceDocumentId: "doc-1", updatedAt: "now", module: "NCRS",
      stem: "Synthetic stem?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
      correctKey: "A", explanation: "Synthetic rationale.", attempts: [], tags: [] }];
    mocks.submit.mockRejectedValueOnce(new Error("Connection lost"));
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Saved source" }), { target: { value: "doc-1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Term confirmed from the source" }), { target: { value: "Term 4" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /checked this source's term, module, answers and explanations/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved source" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /right to share these questions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save and share as Unreviewed" }));
    expect(await screen.findByText("Connection lost")).toBeTruthy();
    expect(await screen.findByText(/private save succeeded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit as Unreviewed" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Submitted to Community Uploads as Unreviewed/)).toBeTruthy();
  });

  it("offers exact-revision approval only to a reviewer after download and attestation", async () => {
    mocks.reviewer.mockResolvedValue(true);
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    expect(within(card).queryByRole("button", { name: /Approve for official catalog/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Download to practice" }));
    const approve = await within(card).findByRole("button", { name: /Approve for official catalog/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(await within(card).findByText(/8 of 8 ready questions have an explanation/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("checkbox", { name: /inspected this exact revision/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(ids.collection, ids.revision, true, "owner-1",
      expect.objectContaining({ missingExplanations: 0 }), true));
  });

  it("keeps missing-explanation community questions practiceable but blocks official approval", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.explanations.mockResolvedValue({ collectionId: ids.collection, revisionId: ids.revision,
      contentHash: "a".repeat(64), readyQuestions: 8, explainedReadyQuestions: 7, missingExplanations: 1 });
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Download to practice" }));
    expect(await within(card).findByText(/7 of 8 ready questions have an explanation/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Open saved questions/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole("checkbox", { name: /inspected this exact revision/ }));
    expect((within(card).getByRole("button", { name: /Approve for official catalog/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("requires an owner to confirm withdrawal and preserves the private course", async () => {
    mocks.list.mockResolvedValue([{ ...row, owned: true }]);
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw" }));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Confirm withdraw" }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledWith(ids.collection, ids.revision, "owner-1"));
    const result = await screen.findByText(/Your private course remains in your account/);
    expect(result.closest(".community-results")).toBeTruthy();
    expect(document.activeElement).toBe(result.closest(".community-feedback"));
  });

  it("does not append a stale page after the term filter changes", async () => {
    let finishOldPage: (rows: typeof row[]) => void = () => {};
    const oldPage = new Promise<typeof row[]>(resolve => { finishOldPage = resolve; });
    const first = Array.from({ length: 24 }, (_, index) => ({ ...row,
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, title: `Initial ${index + 1}` }));
    mocks.list.mockImplementation((_search: string, selectedTerm: string, after?: unknown) => after
      ? oldPage : Promise.resolve(selectedTerm === "Term 1" ? [{ ...row, title: "Filtered course" }] : first));
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(await screen.findByText("Initial 24")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more uploads" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Term" }), { target: { value: "Term 1" } });
    expect(await screen.findByText("Filtered course")).toBeTruthy();
    finishOldPage([{ ...row, title: "Stale course" }]);
    await waitFor(() => expect(screen.queryByText("Stale course")).toBeNull());
  });

  it("discards a prior account's in-flight download messages", async () => {
    let rejectOldDownload: (reason: Error) => void = () => {};
    mocks.download.mockReturnValue(new Promise((_resolve, reject) => { rejectOldDownload = reject; }));
    const { rerender } = render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Download to practice" }));
    mocks.account.id = "owner-2";
    rerender(<CommunityUploads onOpenLibrary={vi.fn()} />);
    await act(async () => { rejectOldDownload(new Error("Previous account private error")); });
    expect(screen.queryByText("Previous account private error")).toBeNull();
    expect(screen.queryByText("Checking and downloading this exact revision…")).toBeNull();
  });
  it("reuses revision-bound academic review in Host without exposing contribution controls", async () => {
    const reviewed = vi.fn();
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValue([{ ...row, owned: true }]);
    render(<CommunityUploads reviewOnly onOpenLibrary={vi.fn()} onReviewed={reviewed} />);
    expect(screen.getByRole("heading", { name: "Review course uploads" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Share a Question Set" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Share a course" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse approved Question Sets" })).toBeNull();
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Open revision for review" }));
    const approve = await within(card).findByRole("button", { name: /Approve for official catalog/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(within(card).getByRole("checkbox", { name: /inspected this exact revision/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(ids.collection, ids.revision, true, "owner-1",
      expect.objectContaining({ missingExplanations: 0 }), true));
    await waitFor(() => expect(reviewed).toHaveBeenCalledOnce());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("Host never offers approval to an operator without independent academic reviewer permission", async () => {
    mocks.reviewer.mockResolvedValue(false);
    render(<CommunityUploads reviewOnly onOpenLibrary={vi.fn()} />);
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Open revision for review" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
    expect(within(card).queryByRole("button", { name: /Approve for official catalog/ })).toBeNull();
    expect(screen.getByText(/Host owner access does not confer medical-content review permission/)).toBeTruthy();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("Host refresh rechecks newly granted reviewer access without changing the signed-in account", async () => {
    mocks.reviewer.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<CommunityUploads reviewOnly onOpenLibrary={vi.fn()} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalledTimes(2));
    const card = (await screen.findByText("NCRS")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Open revision for review" }));
    expect(await within(card).findByRole("button", { name: /Approve for official catalog/ })).toBeTruthy();
  });

});
