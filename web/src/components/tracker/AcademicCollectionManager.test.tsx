// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicCollectionManager } from "./AcademicCollectionManager";

const mocks = vi.hoisted(() => ({ list: vi.fn(), community: vi.fn(), reviewer: vi.fn(), share: vi.fn(), review: vi.fn(), explanations: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "owner-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "owner-1", assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  listAcademicCourses: (...args: unknown[]) => mocks.list(...args),
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
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([
      course(30, { term: "Term 4", visibility: "shared", review_status: "approved" }),
      course(31, { term: "Term 4", visibility: "shared" }),
    ]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText("14 courses")).toBeTruthy();
    expect(mocks.list).toHaveBeenNthCalledWith(2, "", "", id(24));
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

  it("does not offer bulk actions when community status cannot be checked", async () => {
    mocks.list.mockResolvedValueOnce([course(1)]);
    mocks.community.mockRejectedValueOnce(new Error("Community uploads could not be loaded."));
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Community uploads could not be loaded.");
    expect(screen.queryByRole("button", { name: /Share 1 private course/ })).toBeNull();
  });
});
