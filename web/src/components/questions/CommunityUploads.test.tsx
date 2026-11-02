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
  account: { id: "owner-1" as string | undefined },
  list: vi.fn(), preview: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), review: vi.fn(),
  download: vi.fn(), reviewer: vi.fn(), owned: vi.fn(),
  explanations: vi.fn(),
  saveReference: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => {
  const state = () => ({ user: mocks.account.id ? { id: mocks.account.id } : null });
  const useAccount = (select: (value: ReturnType<typeof state>) => unknown) => select(state());
  useAccount.getState = state;
  return { useAccount };
});
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

const row = { id: ids.collection, title: "Current course", module: "NCRS", term: "Term 4",
  current_revision_id: ids.revision, ready_questions: 8, review_questions: 2,
  submitted_at: "2026-11-01T12:00:00Z", owned: false, status: "unreviewed" };

describe("Community Uploads", () => {
  beforeEach(() => {
    mocks.account.id = "owner-1";
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
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("requires sign-in and keeps unreviewed courses outside the official catalog", () => {
    mocks.account.id = undefined;
    render(<CommunityUploads onOpenLibrary={vi.fn()} />);
    expect(screen.getByText("Sign in to browse and contribute")).toBeTruthy();
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
    expect(await screen.findByText(/Your private course remains in your account/)).toBeTruthy();
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
});
