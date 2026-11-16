// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicSharing } from "./AcademicSharing";

const mocks = vi.hoisted(() => ({ reviewer: vi.fn(), review: vi.fn(), rpc: vi.fn(), explanations: vi.fn(), offerState: vi.fn(), offer: vi.fn() }));
vi.mock("../../lib/academicLibrary/publicCatalog", () => ({
  publicOfferState: (...args: unknown[]) => mocks.offerState(...args),
  offerCoursePublicly: (...args: unknown[]) => mocks.offer(...args),
}));
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
vi.mock("../../lib/academicLibrary/explanationReview", () => ({
  inspectStoredRevisionExplanations: (...args: unknown[]) => mocks.explanations(...args),
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
  beforeEach(() => {
    mocks.review.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue({ error: null });
    mocks.offerState.mockResolvedValue("unavailable"); mocks.offer.mockResolvedValue(undefined);
    mocks.explanations.mockResolvedValue({ collectionId: course().id, revisionId: course().current_revision_id,
      contentHash: "a".repeat(64), readyQuestions: 3, explainedReadyQuestions: 3, missingExplanations: 0 });
  });
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
    fireEvent.click(screen.getByRole("button", { name: "Check stored explanations" }));
    expect(await screen.findByText(/3 of 3 ready questions have an explanation/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every explanation/ }));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(course().id, true, "reviewer-1",
      expect.objectContaining({ missingExplanations: 0 }), true));
    expect(await screen.findByText(/Every signed-in AXOM account can now find this course\./)).toBeTruthy();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("withdraws approval and reports a refused review without claiming success", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.review.mockRejectedValueOnce(new Error("Only an academic reviewer can approve shared courses."));
    render(<AcademicSharing course={course({ review_status: "approved" })} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw approval" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only an academic reviewer/);
    expect(mocks.review).toHaveBeenCalledWith(course().id, false, "reviewer-1", undefined, false);
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

describe("offering a course to visitors without an account", () => {
  const open = (container: HTMLElement) => {
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
  };
  const offer = () => screen.queryByRole("group", { name: "Visitors without an account" });
  beforeEach(() => { mocks.reviewer.mockResolvedValue(true); mocks.offer.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue({ error: null }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("lets the reviewer who owns an approved, shared course offer its exact revision, then end the offer", async () => {
    mocks.offerState.mockResolvedValue("not-offered");
    const onSaved = vi.fn();
    const approved = course({ owned: true, review_status: "approved" });
    const { container } = render(<AcademicSharing course={approved} onSaved={onSaved} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalled());
    // Nothing is asked of the server until the reviewer opens the settings.
    expect(mocks.offerState).not.toHaveBeenCalled();
    open(container);
    expect(await screen.findByText("Not offered to visitors.")).toBeTruthy();
    expect(offer()!.textContent).toContain("Questions, images and source files always need an account.");
    fireEvent.click(screen.getByRole("button", { name: "Offer this version to visitors" }));
    await waitFor(() => expect(mocks.offer).toHaveBeenCalledWith(approved, true, "reviewer-1"));
    expect(await screen.findByText("Offered to visitors.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("can now find this version");
    expect(onSaved).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Stop offering to visitors" }));
    await waitFor(() => expect(mocks.offer).toHaveBeenLastCalledWith(approved, false, "reviewer-1"));
    expect(await screen.findByText("Not offered to visitors.")).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("explains why an unapproved or unshared course cannot be offered and reports a refusal without claiming success", async () => {
    mocks.offerState.mockResolvedValue("not-offered");
    const first = render(<AcademicSharing course={course({ owned: true, review_status: "pending" })} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalled());
    open(first.container);
    expect(await screen.findByText("Only an approved course shared with every signed-in account can be offered.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Offer this version to visitors" }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();

    mocks.offer.mockRejectedValueOnce(new Error("This course changed. Refresh it, check its current revision, then decide again."));
    const onSaved = vi.fn();
    const second = render(<AcademicSharing course={course({ owned: true, review_status: "approved" })} onSaved={onSaved} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalledTimes(2));
    open(second.container);
    fireEvent.click(await screen.findByRole("button", { name: "Offer this version to visitors" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This course changed");
    expect(screen.getByText("Not offered to visitors.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("offers no control to a reviewer who does not own the course, or when the backend has no visitor catalog", async () => {
    mocks.offerState.mockResolvedValue("not-offered");
    const first = render(<AcademicSharing course={course({ owned: false, review_status: "approved" })} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalled());
    open(first.container);
    expect(offer()).toBeNull();
    expect(mocks.offerState).not.toHaveBeenCalled();
    first.unmount();

    mocks.offerState.mockResolvedValue("unavailable");
    const second = render(<AcademicSharing course={course({ owned: true, review_status: "approved" })} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.reviewer).toHaveBeenCalledTimes(2));
    open(second.container);
    await waitFor(() => expect(mocks.offerState).toHaveBeenCalledOnce());
    expect(offer()).toBeNull();
  });
});
