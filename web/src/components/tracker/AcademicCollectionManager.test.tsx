// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicCollectionManager } from "./AcademicCollectionManager";

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), community: vi.fn(), reviewer: vi.fn(), share: vi.fn(), review: vi.fn(), explanations: vi.fn(), scopeCheck: vi.fn(), userId: "owner-1" }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: mocks.userId } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "owner-1", assertCurrent: () => mocks.scopeCheck(), dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  listAcademicCourses: (...args: unknown[]) => mocks.list(...args),
  getAcademicCourse: (...args: unknown[]) => mocks.detail(...args),
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
  shareAcademicCourses: (...args: unknown[]) => mocks.share(...args),
  reviewAcademicCourse: (...args: unknown[]) => mocks.review(...args),
}));
vi.mock("../../lib/academicLibrary/community", () => ({
  listCommunityUploads: (...args: unknown[]) => mocks.community(...args),
}));
vi.mock("../../lib/academicLibrary/explanationReview", () => ({
  inspectStoredRevisionExplanations: (...args: unknown[]) => mocks.explanations(...args),
}));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    <button type="button" {...props}>{children}</button>,
  GhostButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  Tag: ({ children }: { children: React.ReactNode }) => <span data-tag="">{children}</span>,
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const course = (n: number, patch: Partial<AcademicCourse> = {}): AcademicCourse => ({
  id: id(n), title: `Course ${n}`, module: `M${n}`, term: "Term 1", visibility: "private", review_status: "pending",
  current_revision_id: id(1000 + n), owned: true, ready_questions: 2, review_questions: 0, ...patch,
});

describe("your published courses", () => {
  beforeEach(() => {
    mocks.userId = "owner-1";
    mocks.scopeCheck.mockReset();
    mocks.community.mockResolvedValue([]);
    mocks.reviewer.mockResolvedValue(false);
    mocks.share.mockImplementation(async (ids: string[]) =>
      ids.map(collectionId => ({ collectionId, shared: true })));
    mocks.review.mockResolvedValue(undefined);
    mocks.explanations.mockImplementation(async (collectionId: string, revisionId: string) => ({
      collectionId, revisionId, contentHash: "a".repeat(64), readyQuestions: 2,
      explainedReadyQuestions: 2, missingExplanations: 0,
    }));
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("reads every catalog page and lists only this account's courses by term and status", async () => {
    const first = Array.from({ length: 24 }, (_, index) => course(index + 1, index % 2 ? { owned: false, visibility: "shared", review_status: "approved" } : {}));
    const finalPage = [
      course(30, { term: "Term 4", visibility: "shared", review_status: "approved" }),
      course(31, { term: "Term 4", visibility: "shared" }),
    ];
    // The readback repeats both observed pages and rechecks the cursor;
    // bulk sharing cannot rely on the original cross-transaction scan alone.
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce(finalPage)
      .mockResolvedValueOnce(first).mockResolvedValueOnce(finalPage);
    mocks.detail.mockResolvedValue(first.at(-1));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText("14 courses")).toBeTruthy();
    expect(mocks.list).toHaveBeenNthCalledWith(2, "", "", id(24));
    expect(mocks.detail).toHaveBeenCalledWith(id(24), "owner-1");
    expect(screen.getByText(/12 private, 1 awaiting review, 1 shared with everyone\./)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 4 }).map(heading => heading.textContent)).toEqual(["Term 1", "Term 4"]);
    // Not a reviewer: no approval controls, only an explanation.
    expect(screen.queryByRole("group", { name: /Approve courses awaiting review/ })).toBeNull();
    expect(screen.getByText(/1 course is waiting for an academic reviewer/)).toBeTruthy();
  });

  it("shares private courses for review before any reviewer attestation or approval", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1), course(2), course(3, { visibility: "shared", review_status: "approved" })]);
    const onChanged = vi.fn();
    render(<AcademicCollectionManager onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 2 private courses/ });
    expect((share as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    expect(screen.queryByRole("checkbox", { name: /Approve them now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check stored explanations" })).toBeNull();
    fireEvent.click(share);
    expect(await screen.findByText(/2 courses shared for review\. Other accounts can find them only after academic approval\./)).toBeTruthy();
    expect(mocks.share.mock.calls.map(([ids, , options]) => [ids, Object.hasOwn(options, "approve")])).toEqual([[[id(1)], false], [[id(2)], false]]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(screen.getByText(/2 awaiting review, 1 shared with everyone\./)).toBeTruthy();
    const approve = await screen.findByRole("button", { name: /Approve 2 courses/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await screen.findByText(/Explanation readback complete/);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    fireEvent.click(approve);
    expect(await screen.findByText(/2 courses approved\. Every signed-in AXOM account can now find them\./)).toBeTruthy();
    expect(mocks.review.mock.calls.map(([collection, approved]) => [collection, approved])).toEqual([[id(1), true], [id(2), true]]);
    expect(screen.getByText(/3 shared with everyone\./)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("lets an owner submit for review without reviewer membership or a review call", async () => {
    mocks.list.mockResolvedValueOnce([course(1)]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 1 private course/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(share);
    expect(await screen.findByText(/1 course shared for review/)).toBeTruthy();
    expect(mocks.share.mock.calls.map(([, , options]) => Object.hasOwn(options, "approve"))).toEqual([false]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Check stored explanations" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    expect(screen.getByText(/1 awaiting review/)).toBeTruthy();
  });

  it("approves every course awaiting review after the reviewer's check, and lists the ones that failed", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" }), course(2, { visibility: "shared", module: "GOER" })]);
    mocks.review.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("The review could not be saved."));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const group = await screen.findByRole("group", { name: /Approve courses awaiting review/ });
    const approve = within(group).getByRole("button", { name: /Approve 2 courses/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await screen.findByText(/Explanation readback complete/);
    fireEvent.click(within(group).getByRole("checkbox"));
    fireEvent.click(approve);
    expect(await screen.findByText(/1 course approved\./)).toBeTruthy();
    expect(mocks.review.mock.calls.map(([collection, approved]) => [collection, approved])).toEqual([[id(1), true], [id(2), true]]);
    const failures = screen.getByRole("alert");
    expect(within(failures).getByText("Term 1 GOER")).toBeTruthy();
    expect(failures.textContent).toMatch(/The review could not be saved\./);
    await waitFor(() => expect(screen.getByText(/1 awaiting review, 1 shared with everyone\./)).toBeTruthy());
  });

  it("shows a missing explanation count and keeps bulk approval disabled", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    mocks.explanations.mockResolvedValueOnce({ collectionId: id(1), revisionId: id(1001),
      contentHash: "a".repeat(64), readyQuestions: 2, explainedReadyQuestions: 1, missingExplanations: 1 });
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const approve = await screen.findByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/1 ready question without an explanation/);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    expect(approve.disabled).toBe(true);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("explains an empty library", async () => {
    mocks.list.mockResolvedValueOnce([course(1, { owned: false, visibility: "shared", review_status: "approved" })]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText(/You have not published any courses yet/)).toBeTruthy();
  });

  it("routes pending community submissions away from legacy share and approval", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([
      course(1), course(2, { visibility: "shared" }),
      course(3), course(4, { visibility: "shared" }),
    ]);
    mocks.community.mockResolvedValueOnce([1, 2].map(n => ({
      id: id(n), current_revision_id: id(1000 + n), submitted_at: "2026-11-01T10:00:00Z",
    })));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 1 private course/ });
    const approve = screen.getByRole("button", { name: /Approve 1 course/ });
    expect(screen.getByText(/2 unreviewed community uploads/)).toBeTruthy();
    expect(screen.getByText(/Question Bank → Community Uploads/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await screen.findByText(/Explanation readback complete/);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledOnce());
    expect(mocks.review.mock.calls[0][0]).toBe(id(4));
    fireEvent.click(share);
    await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
    expect(mocks.share.mock.calls[0][0]).toEqual([id(3)]);
  });

  it("invalidates previous sharing and approval permissions after a failed community refresh", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValue([course(1), course(2, { visibility: "shared" })]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 1 private course/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    expect(share.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await screen.findByText(/Explanation readback complete/);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    expect((screen.getByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement).disabled).toBe(false);

    // A previously valid catalog is now untrustworthy: a failed second read
    // must not resurrect rights or approval controls when busy clears.
    mocks.community.mockRejectedValueOnce(new Error("The community upload list changed while loading. Refresh before sharing or approving courses."));
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/community upload list changed/i);
    await waitFor(() => expect((screen.getByRole("button", { name: /Show my courses/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: /Share 1 private course/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();

    // A subsequent clean read restores only the catalog, not stale consent
    // or the old exact-revision explanation-review attestation.
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const recoveredShare = await screen.findByRole("button", { name: /Share 1 private course/ }) as HTMLButtonElement;
    const recoveredApprove = screen.getByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    expect(recoveredShare.disabled).toBe(true);
    expect(recoveredApprove.disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /right to share this course material/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /I checked every stored explanation/ }) as HTMLInputElement).checked).toBe(false);
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("does not offer bulk actions when community status cannot be checked", async () => {
    mocks.list.mockResolvedValueOnce([course(1)]);
    mocks.community.mockRejectedValueOnce(new Error("Community uploads could not be loaded."));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Community uploads could not be loaded.");
    expect(screen.queryByRole("button", { name: /Share 1 private course/ })).toBeNull();
  });

  it("fails closed when community pagination silently skips a pending upload after a keyset move", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    const first = Array.from({ length: 24 }, (_, index) => ({
      id: id(index + 100), current_revision_id: id(index + 1100),
      submitted_at: "2026-11-01T10:00:00Z",
    }));
    mocks.community.mockResolvedValueOnce(first).mockResolvedValueOnce([])
      .mockResolvedValueOnce([first[0], ...first.slice(1, 23), {
        id: id(1), current_revision_id: id(1001), submitted_at: "2026-11-01T10:01:00Z",
      }]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/community.*changed/i);
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Share 1 private course/ })).toBeNull();
  });

  it("refuses duplicate community IDs across pages instead of bypassing the review queue", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    const first = Array.from({ length: 24 }, (_, index) => ({
      id: id(index + 100), current_revision_id: id(index + 1100),
      submitted_at: "2026-11-01T10:00:00Z",
    }));
    mocks.community.mockResolvedValueOnce(first).mockResolvedValueOnce([first[5]]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/community.*changed/i);
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
  });

  it("routes a stable second-page exact revision to Community review without legacy approval", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    const first = Array.from({ length: 24 }, (_, index) => ({
      id: id(index + 100), current_revision_id: id(index + 1100),
      submitted_at: "2026-11-01T10:00:00Z",
    }));
    const finalPage = [{ id: id(1), current_revision_id: id(1001), submitted_at: "2026-10-31T10:00:00Z" }];
    mocks.community.mockResolvedValueOnce(first).mockResolvedValueOnce(finalPage)
      .mockResolvedValueOnce(first).mockResolvedValueOnce(finalPage);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText(/1 unreviewed community upload/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    expect(mocks.community).toHaveBeenCalledTimes(4);
  });

  it("discards an old account's community readback after account identity becomes invalid", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    mocks.community.mockImplementationOnce(async () => {
      mocks.scopeCheck.mockImplementation(() => { throw new Error("The account changed."); });
      return [];
    });
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /Show my courses/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/1 course/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not retain a stopped in-flight explanation receipt as approval evidence", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    let resolveRead: (receipt: unknown) => void = () => {};
    mocks.explanations.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const approve = await screen.findByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await waitFor(() => expect(mocks.explanations).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    resolveRead({ collectionId: id(1), revisionId: id(1001), contentHash: "a".repeat(64),
      readyQuestions: 2, explainedReadyQuestions: 2, missingExplanations: 0 });
    expect(await screen.findByText(/Explanation check stopped/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    expect(approve.disabled).toBe(true);
    expect(screen.queryByText(/0 ready questions without an explanation/)).toBeNull();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("discards an explanation readback when its account scope was invalidated", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    let resolveRead: (receipt: unknown) => void = () => {};
    mocks.explanations.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const approve = await screen.findByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await waitFor(() => expect(mocks.explanations).toHaveBeenCalledOnce());
    mocks.scopeCheck.mockImplementation(() => { throw new Error("The account changed."); });
    resolveRead({ collectionId: id(1), revisionId: id(1001), contentHash: "a".repeat(64),
      readyQuestions: 2, explainedReadyQuestions: 2, missingExplanations: 0 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    expect(approve.disabled).toBe(true);
    expect(screen.queryByText(/Explanation readback complete/)).toBeNull();
    expect(screen.queryByText(/0 ready questions without an explanation/)).toBeNull();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("lets Stop release a hanging explanation read immediately, and ignores its late receipt after restart", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })]);
    let resolveStale: (receipt: unknown) => void = () => {};
    mocks.explanations.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const approve = await screen.findByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await waitFor(() => expect(mocks.explanations).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    // The original remote read intentionally NEVER settles before the retry.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(screen.getByText(/Explanation check stopped/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await waitFor(() => expect(mocks.explanations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Explanation readback complete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    expect(approve.disabled).toBe(false);

    // Resolving the abandoned call must not overwrite the fresh audit.
    await act(async () => { resolveStale({
      collectionId: id(1), revisionId: id(1001), contentHash: "b".repeat(64),
      readyQuestions: 2, explainedReadyQuestions: 0, missingExplanations: 2,
    }); });
    expect(screen.getByText(/Explanation readback complete/)).toBeTruthy();
    expect(screen.queryByText(/2 ready questions without an explanation/)).toBeNull();
    expect(approve.disabled).toBe(false);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("releases a hanging owned-course read on Stop and ignores its late response after restart", async () => {
    let resolveOld: (rows: AcademicCourse[]) => void = () => {};
    mocks.list.mockImplementationOnce(() => new Promise<AcademicCourse[]>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce([course(2)]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    // The first RPC is still pending: a cancelled read must not lock loading.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    const retry = screen.getByRole("button", { name: /Show my courses/ }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(await screen.findByText("M2")).toBeTruthy();
    expect(screen.queryByText("M1")).toBeNull();

    await act(async () => { resolveOld([course(1)]); });
    expect(screen.getByText("M2")).toBeTruthy();
    expect(screen.queryByText("M1")).toBeNull();
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("releases a hanging Community Uploads read on Stop without reviving a stale approval", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })])
      .mockResolvedValueOnce([course(2, { visibility: "shared" })]);
    let resolveOld: (rows: { id: string; current_revision_id: string; submitted_at: string }[]) => void = () => {};
    mocks.community.mockImplementationOnce(() =>
      new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    await waitFor(() => expect(mocks.community).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(screen.queryByRole("button", { name: /Approve 1 course/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText("M2")).toBeTruthy();
    expect(screen.queryByText("M1")).toBeNull();
    const approve = screen.getByRole("button", { name: /Approve 1 course/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    await act(async () => { resolveOld([{ id: id(1), current_revision_id: id(1001),
      submitted_at: "2026-11-01T10:00:00Z" }]); });
    expect(screen.getByText("M2")).toBeTruthy();
    expect(screen.queryByText("M1")).toBeNull();
    expect(approve.disabled).toBe(true);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("unlocks the new account while a previous share RPC is pending and rejects its late error", async () => {
    mocks.list.mockResolvedValueOnce([course(1)]).mockResolvedValueOnce([course(2)]);
    let rejectOld: (reason: Error) => void = () => {};
    mocks.share.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const onChanged = vi.fn();
    const { rerender } = render(<AcademicCollectionManager onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 1 private course/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(share);
    await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));

    mocks.userId = "owner-2";
    rerender(<AcademicCollectionManager onChanged={onChanged} />);
    const reload = screen.getByRole("button", { name: /Show my courses/ }) as HTMLButtonElement;
    await waitFor(() => expect(reload.disabled).toBe(false));
    fireEvent.click(reload);
    expect(await screen.findByText("M2")).toBeTruthy();

    await act(async () => { rejectOld(new Error("Old account sharing error.")); });
    expect(screen.getByText("M2")).toBeTruthy();
    expect(screen.queryByText(/Old account sharing error/)).toBeNull();
    expect(screen.queryByText(/1 course shared before stopping/)).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps a new account's catalog intact after the old account's pending approval settles", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1, { visibility: "shared" })])
      .mockResolvedValueOnce([course(2, { visibility: "shared" })]);
    let resolveOld: () => void = () => {};
    mocks.review.mockImplementationOnce(() => new Promise<void>(resolve => { resolveOld = resolve; }));
    const onChanged = vi.fn();
    const { rerender } = render(<AcademicCollectionManager onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const approve = await screen.findByRole("button", { name: /Approve 1 course/ });
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    await screen.findByText(/Explanation readback complete/);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every stored explanation/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledTimes(1));

    mocks.userId = "owner-2";
    rerender(<AcademicCollectionManager onChanged={onChanged} />);
    const reload = screen.getByRole("button", { name: /Show my courses/ }) as HTMLButtonElement;
    await waitFor(() => expect(reload.disabled).toBe(false));
    fireEvent.click(reload);
    expect(await screen.findByText("M2")).toBeTruthy();

    await act(async () => { resolveOld(); });
    expect(screen.getByText("M2")).toBeTruthy();
    expect(screen.queryByText("M1")).toBeNull();
    expect(screen.queryByText(/Approval may have saved/)).toBeNull();
    expect(screen.queryByText(/1 course approved/)).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

});
