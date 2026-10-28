// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicPreview } from "../../lib/academicLibrary/client";
import type { ReviewSubmission } from "../../lib/academicLibrary/reviewQueue";
import { AcademicReviewQueue } from "./AcademicReviewQueue";

const mocks = vi.hoisted(() => ({
  account: { user: { id: "reviewer" } as { id: string } | null },
  canReview: vi.fn(), list: vi.fn(), preview: vi.fn(), decide: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (selector: (account: typeof mocks.account) => unknown) => selector(mocks.account),
}));
vi.mock("../../lib/academicLibrary/reviewQueue", () => ({
  canReviewAcademicCourses: mocks.canReview, listAcademicReviewQueue: mocks.list,
  previewAcademicReview: mocks.preview, decideAcademicReview: mocks.decide,
}));

function submission(index = 1, owner = "Course owner"): ReviewSubmission {
  return { id: `course-${index}`, current_revision_id: `revision-${index}`, title: `Course ${index}`,
    term: "Term 5", module: "GOER", owner_display_name: owner,
    ready_questions: 12, review_questions: 3, submitted_at: new Date(Date.UTC(2026, 9, 28, 12) + index * 60_000).toISOString() };
}
const first = submission();
const previewFor = (item: ReviewSubmission): AcademicPreview => ({ id: item.current_revision_id, collection_id: item.id,
  template_text: "Week 1\nLecture 1: Synthetic plan", ready_questions: item.ready_questions, review_questions: item.review_questions });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.account.user = { id: "reviewer" };
  mocks.canReview.mockReset().mockResolvedValue(true);
  mocks.list.mockReset().mockResolvedValue([first]);
  mocks.preview.mockReset().mockImplementation(async (item: ReviewSubmission) => previewFor(item));
  mocks.decide.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("shared academic review queue", () => {
  it("shows no queue or submission request to signed-out accounts and non-reviewers", async () => {
    mocks.account.user = null;
    const view = render(<AcademicReviewQueue />);
    expect(view.container.textContent).toBe(""); expect(mocks.canReview).not.toHaveBeenCalled();
    mocks.account.user = { id: "learner" }; mocks.canReview.mockResolvedValue(false);
    view.rerender(<AcademicReviewQueue />);
    await act(async () => {});
    expect(mocks.canReview).toHaveBeenCalledWith("learner");
    expect(view.container.textContent).toBe(""); expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists metadata from multiple owners and requires an opened preview before decisions", async () => {
    mocks.list.mockResolvedValue([first, submission(2, "Another owner")]);
    const pending = deferred<AcademicPreview>(); mocks.preview.mockReturnValueOnce(pending.promise);
    render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    expect(row.textContent).toContain("Term 5 · GOER");
    expect(row.textContent).toContain("Submitted by Course owner");
    expect(row.textContent).toContain("12 ready · 3 awaiting review");
    expect(screen.getByText("Submitted by Another owner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    expect(screen.getByText("Opening the submitted preview…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    await act(async () => pending.resolve(previewFor(first)));
    expect(screen.getByRole("group", { name: "Preview Course 1" }).textContent).toContain("Synthetic plan");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it.each([true, false])("saves an exact preview decision (%s), prevents duplicate submits and removes only its row", async approved => {
    const pending = deferred<void>(); mocks.decide.mockReturnValue(pending.promise);
    mocks.list.mockResolvedValue([first, submission(2)]);
    render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    const button = await screen.findByRole("button", { name: approved ? "Approve" : "Reject" });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.decide).toHaveBeenCalledWith(first, approved, "reviewer");
    await act(async () => pending.resolve());
    await screen.findByText(`${approved ? "Approved" : "Rejected"}: Course 1.`);
    expect(screen.queryByRole("article", { name: "Course 1" })).toBeNull();
    expect(screen.getByRole("article", { name: "Course 2" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("article", { name: "Course 2" })).getByRole("button", { name: "Open preview" })));
  });

  it("keeps the received cursor after its last submission is reviewed", async () => {
    const page = Array.from({ length: 24 }, (_, index) => submission(index + 1));
    mocks.list.mockResolvedValueOnce(page).mockResolvedValueOnce([submission(25)]);
    render(<AcademicReviewQueue />);
    const last = await screen.findByRole("article", { name: "Course 24" });
    fireEvent.click(within(last).getByRole("button", { name: "Open preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await screen.findByText("Approved: Course 24.");
    fireEvent.click(screen.getByRole("button", { name: "Load more submissions" }));
    await screen.findByRole("article", { name: "Course 25" });
    expect(mocks.list).toHaveBeenLastCalledWith("reviewer", { submittedAt: page[23].submitted_at, id: page[23].id });
    expect(screen.getAllByRole("article")).toHaveLength(24);
    expect(screen.queryByRole("button", { name: "Load more submissions" })).toBeNull();
  });

  it("retries a failed list without fabricating an empty queue", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Submissions are unavailable."));
    render(<AcademicReviewQueue />);
    await screen.findByText("Submissions are unavailable.");
    expect(screen.queryByText("No shared courses are waiting for review.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry submissions" }));
    await screen.findByRole("article", { name: "Course 1" });
    expect(mocks.canReview).toHaveBeenCalledTimes(2);
  });

  it("rejects a repeated page without advancing the cursor or duplicating rows", async () => {
    const page = Array.from({ length: 24 }, (_, index) => submission(index + 1));
    mocks.list.mockResolvedValueOnce(page).mockResolvedValueOnce(page);
    render(<AcademicReviewQueue />);
    await screen.findByRole("article", { name: "Course 24" });
    fireEvent.click(screen.getByRole("button", { name: "Load more submissions" }));
    await screen.findByText("Submissions changed while loading. Refresh the review queue before continuing.");
    expect(screen.getAllByRole("article")).toHaveLength(24);
    expect(mocks.list).toHaveBeenLastCalledWith("reviewer", { submittedAt: page[23].submitted_at, id: page[23].id });
  });

  it("accepts SQL's oldest-first order across equal instants with different timezone formats and microseconds", async () => {
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const page = Array.from({ length: 24 }, (_, index) => ({ ...submission(index + 1), id: id(index + 1), submitted_at: "2026-10-28T12:00:00.123456+00:00" }));
    const later = [
      { ...submission(25), id: id(25), submitted_at: "2026-10-28T08:00:00.123456-04:00" },
      { ...submission(26), id: id(0), submitted_at: "2026-10-28T12:00:00.123457Z" },
    ];
    mocks.list.mockResolvedValueOnce(page).mockResolvedValueOnce(later);
    render(<AcademicReviewQueue />);
    await screen.findByRole("article", { name: "Course 24" });
    fireEvent.click(screen.getByRole("button", { name: "Load more submissions" }));
    await screen.findByRole("article", { name: "Course 26" });
    expect(screen.getAllByRole("article")).toHaveLength(26);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.list).toHaveBeenLastCalledWith("reviewer", { submittedAt: page[23].submitted_at, id: page[23].id });
  });

  it("checks the first new row against the cursor even when the page ends later", async () => {
    const page = Array.from({ length: 24 }, (_, index) => submission(index + 1));
    mocks.list.mockResolvedValueOnce(page).mockResolvedValueOnce([submission(0), submission(25)]);
    render(<AcademicReviewQueue />);
    await screen.findByRole("article", { name: "Course 24" });
    fireEvent.click(screen.getByRole("button", { name: "Load more submissions" }));
    await screen.findByText("Submissions changed while loading. Refresh the review queue before continuing.");
    expect(screen.queryByRole("article", { name: "Course 0" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Course 25" })).toBeNull();
  });

  it("keeps a failed decision in the queue and requires a fresh preview to retry", async () => {
    mocks.decide.mockRejectedValueOnce(new Error("This submission changed. Refresh the review queue before deciding."));
    render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await screen.findByText("This submission changed. Refresh the review queue before deciding.");
    expect(screen.getByRole("article", { name: "Course 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    await screen.findByRole("button", { name: "Approve" });
    expect(mocks.preview).toHaveBeenCalledTimes(2);
  });

  it("does not let a late preview replace the newly selected submission", async () => {
    const pending = deferred<AcademicPreview>();
    mocks.list.mockResolvedValue([first, submission(2)]); mocks.preview.mockReturnValueOnce(pending.promise);
    render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    fireEvent.click(within(screen.getByRole("article", { name: "Course 2" })).getByRole("button", { name: "Open preview" }));
    await screen.findByRole("button", { name: "Approve" });
    await act(async () => pending.resolve(previewFor(first)));
    expect(screen.queryByRole("group", { name: "Preview Course 1" })).toBeNull();
    expect(screen.getByRole("group", { name: "Preview Course 2" })).toBeTruthy();
  });

  it("removes the prior account's rows immediately and ignores its late preview", async () => {
    const pending = deferred<AcademicPreview>(); mocks.preview.mockReturnValueOnce(pending.promise);
    const view = render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    mocks.account.user = { id: "non-reviewer" }; mocks.canReview.mockResolvedValue(false);
    view.rerender(<AcademicReviewQueue />);
    expect(view.container.textContent).toBe("");
    await act(async () => pending.resolve(previewFor(first)));
    expect(view.container.textContent).toBe("");
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("checks membership again on refresh and hides the queue if access was removed", async () => {
    const view = render(<AcademicReviewQueue />);
    await screen.findByRole("article", { name: "Course 1" });
    mocks.canReview.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh review queue" }));
    expect(view.container.textContent).toBe("");
    await act(async () => {});
    expect(view.container.textContent).toBe(""); expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("shows an empty queue and a plan-less preview without implying missing questions are visible", async () => {
    mocks.preview.mockResolvedValue({ ...previewFor(first), template_text: "" });
    render(<AcademicReviewQueue />);
    const row = await screen.findByRole("article", { name: "Course 1" });
    fireEvent.click(within(row).getByRole("button", { name: "Open preview" }));
    await screen.findByText("No weekly plan was submitted for this question collection.");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText("No shared courses are waiting for review.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refresh review queue" })));
  });

  it("rejects a mismatched preview before exposing decision buttons", async () => {
    mocks.preview.mockResolvedValue({ ...previewFor(first), id: "unexpected-revision" });
    render(<AcademicReviewQueue />);
    fireEvent.click(within(await screen.findByRole("article", { name: "Course 1" })).getByRole("button", { name: "Open preview" }));
    await screen.findByText("This submission changed. Refresh the review queue before deciding.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
