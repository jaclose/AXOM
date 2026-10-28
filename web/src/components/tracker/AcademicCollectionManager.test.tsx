// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicCollectionManager } from "./AcademicCollectionManager";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reviewer: vi.fn(), share: vi.fn(), review: vi.fn() }));
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
    mocks.reviewer.mockResolvedValue(false);
    mocks.share.mockImplementation(async (ids: string[], _account: string, options: { approve: boolean }) =>
      ids.map(collectionId => ({ collectionId, shared: true, approved: options.approve })));
    mocks.review.mockResolvedValue(undefined);
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

  it("shares private courses only after the rights attestation, and a reviewer approves them in the same step", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.list.mockResolvedValueOnce([course(1), course(2), course(3, { visibility: "shared", review_status: "approved" })]);
    const onChanged = vi.fn();
    render(<AcademicCollectionManager onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    const share = await screen.findByRole("button", { name: /Share 2 private courses/ });
    expect((share as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Approve them now/ }));
    fireEvent.click(share);
    expect(await screen.findByText(/2 courses shared and approved\. Every signed-in AXOM account can now find them\./)).toBeTruthy();
    expect(mocks.share.mock.calls.map(([ids, , options]) => [ids, options.approve])).toEqual([[[id(1)], true], [[id(2)], true]]);
    expect(screen.getByText(/3 shared with everyone\./)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledOnce();
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
    fireEvent.click(within(group).getByRole("checkbox"));
    fireEvent.click(approve);
    expect(await screen.findByText(/1 course approved\./)).toBeTruthy();
    expect(mocks.review.mock.calls.map(([collection, approved]) => [collection, approved])).toEqual([[id(1), true], [id(2), true]]);
    const failures = screen.getByRole("alert");
    expect(within(failures).getByText("Term 1 GOER")).toBeTruthy();
    expect(failures.textContent).toMatch(/The review could not be saved\./);
    await waitFor(() => expect(screen.getByText(/1 awaiting review, 1 shared with everyone\./)).toBeTruthy());
  });

  it("explains an empty library", async () => {
    mocks.list.mockResolvedValueOnce([course(1, { owned: false, visibility: "shared", review_status: "approved" })]);
    render(<AcademicCollectionManager onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show my courses/ }));
    expect(await screen.findByText(/You have not published any courses yet/)).toBeTruthy();
  });
});
