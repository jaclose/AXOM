// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicSharing } from "./AcademicSharing";

const mocks = vi.hoisted(() => ({ reviewer: vi.fn(), review: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "reviewer-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "reviewer-1", assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
  reviewAcademicCourse: (...args: unknown[]) => mocks.review(...args),
  academicClient: async () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
  }),
}));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

const course = (patch: Partial<AcademicCourse> = {}): AcademicCourse => ({
  id: "11111111-1111-4111-8111-111111111111", title: "GOER", module: "GOER", term: "Term 5", visibility: "shared",
  review_status: "pending", current_revision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owned: false,
  ready_questions: 3, review_questions: 0, ...patch,
});

describe("academic review controls", () => {
  beforeEach(() => { mocks.review.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue({ error: null }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("lets a reviewer approve another owner's shared course only after an explicit check", async () => {
    mocks.reviewer.mockResolvedValue(true);
    const onSaved = vi.fn();
    render(<AcademicSharing course={course()} onSaved={onSaved} />);
    expect(await screen.findByText("Academic review")).toBeTruthy();
    expect(screen.queryByText("Who can discover this course?")).toBeNull();
    expect(screen.getByText(/Review status: Waiting for review\./)).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve this version" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked this course/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(course().id, true, "reviewer-1"));
    expect(await screen.findByText(/Every signed-in AXOM account can now find this course\./)).toBeTruthy();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("withdraws approval and reports a refused review without claiming success", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.review.mockRejectedValueOnce(new Error("Only an academic reviewer can approve shared courses."));
    render(<AcademicSharing course={course({ review_status: "approved" })} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw approval" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only an academic reviewer/);
    expect(mocks.review).toHaveBeenCalledWith(course().id, false, "reviewer-1");
  });

  it("shows owners their sharing settings and hides review from non-reviewers", async () => {
    mocks.reviewer.mockResolvedValue(false);
    const { unmount } = render(<AcademicSharing course={course({ owned: true })} onSaved={vi.fn()} />);
    expect(screen.getByText("Sharing settings")).toBeTruthy();
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Academic review" })).toBeNull();
    unmount();
    const { container } = render(<AcademicSharing course={course()} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe("");
  });
});
