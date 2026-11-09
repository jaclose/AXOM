// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import type { LibraryQuestionSetPreview } from "../../lib/sharing/questionSetLibrary";
import { QuestionSetLibraryReviewQueue } from "./QuestionSetLibraryReviewQueue";

const mocks = vi.hoisted(() => ({
  reviewer: vi.fn(), pending: vi.fn(), preview: vi.fn(), review: vi.fn(),
}));

vi.mock("../../lib/account/accountStore", async () => {
  const { create } = await import("zustand");
  return { useAccount: create<{ user: { id: string } | null }>(() => ({ user: { id: "reviewer-a" } })) };
});
vi.mock("../../lib/academicLibrary/client", () => ({ isAcademicReviewer: mocks.reviewer }));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listPendingQuestionSets: mocks.pending,
  loadPendingQuestionSetReviewPreview: mocks.preview,
  reviewQuestionSetSubmission: mocks.review,
}));

const submissionId = "00000000-0000-4000-8000-000000000021";
const submission = {
  id: submissionId, sourceId: "synthetic-review", title: "Synthetic cardiovascular review",
  credit: "Test contributor", questionCount: 21, status: "pending" as const,
  reviewNote: "", createdAt: "2026-11-09T10:00:00.000Z",
};
const questions: LibraryQuestionSetPreview["snapshot"]["questions"] = Array.from({ length: 21 }, (_, index) => ({
  id: `synthetic-question-${index + 1}`,
  stem: `Synthetic question ${index + 1}?`,
  options: [{ key: "A", text: "Supported answer" }, { key: "B", text: "Distractor" }],
  correctKey: "A",
  explanation: index === 0
    ? "AXOM AI-assisted explanation (verify against source): A is supported by the synthetic source."
    : "The synthetic source supports option A.",
  choiceRationales: index === 0 ? {
    A: "Choice A rationale comes from a provisional AI draft.",
    B: "Choice B rationale comes from a provisional AI draft.",
  } : undefined,
  tags: ["synthetic"],
  citation: "Synthetic source, page 1",
}));
const reviewPreview: LibraryQuestionSetPreview = {
  id: submissionId, status: "pending", reviewRevision: 1, contentDigest: "a".repeat(64),
  snapshot: {
    shareFormatVersion: 1, title: submission.title, tags: ["synthetic"],
    orderedQuestionIds: questions.map(question => question.id), questions,
    createdAt: submission.createdAt, copyrightNotice: "Synthetic content for testing only.",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAccount.setState({ user: { id: "reviewer-a" } as never });
  mocks.reviewer.mockImplementation(async (id: string) => id === "reviewer-a");
  mocks.pending.mockResolvedValue([submission]);
  mocks.preview.mockResolvedValue(reviewPreview);
  mocks.review.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function openPreview() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Inspect" }));
  await screen.findByRole("dialog", { name: `Review ${submission.title}` });
  return user;
}

describe("Question Set academic review preview", () => {
  it("shows AI-assisted choice rationales and gates approval until every batch is displayed", async () => {
    render(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    const user = await openPreview();
    expect(screen.getByText(/Choice A rationale comes from a provisional AI draft/)).toBeTruthy();
    expect(screen.getByText(/Choice B rationale comes from a provisional AI draft/)).toBeTruthy();
    expect(screen.getByText("AI-assisted draft · verify against source")).toBeTruthy();
    expect(screen.getByText(/AXOM AI-assisted explanation \(verify against source\)/)).toBeTruthy();
    expect(screen.getByText("Synthetic question 20?")).toBeTruthy();
    expect(screen.queryByText("Synthetic question 21?")).toBeNull();

    const approve = screen.getByRole("button", { name: "Approve for library" }) as HTMLButtonElement;
    await user.type(screen.getByRole("textbox", { name: "Review note" }), "Checked source, rights and answer evidence.");
    expect(approve.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /next 20 questions/i }));
    expect(screen.getByText("Synthetic question 21?")).toBeTruthy();
    expect(document.querySelector(".qsl-review-detail > ol")?.getAttribute("start")).toBe("21");
    const pageStatus = screen.getByText(/Showing questions 21–21 of 21/);
    expect(document.activeElement).toBe(pageStatus);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Previous 20 questions" }));
    await user.click(screen.getByRole("checkbox", { name: /I checked the set's distribution rights/ }));
    expect(approve.disabled).toBe(false);
    await user.click(approve);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(
      "reviewer-a", reviewPreview, true, "Checked source, rights and answer evidence.",
    ));
    expect(await screen.findByText("Question Set approved for search.")).toBeTruthy();
  });

  it("allows a reviewer to return a set with a reason without falsely attesting to its evidence", async () => {
    render(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    const user = await openPreview();
    await user.type(screen.getByRole("textbox", { name: "Review note" }), "Citation does not establish distribution rights.");
    await user.click(screen.getByRole("button", { name: "Return for revision" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(
      "reviewer-a", reviewPreview, false, "Citation does not establish distribution rights.",
    ));
  });

  it("hides a pending preview when the signed-in reviewer changes", async () => {
    const { rerender } = render(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    await openPreview();
    expect(screen.getByText("Synthetic question 1?")).toBeTruthy();
    act(() => { useAccount.setState({ user: { id: "reviewer-b" } as never }); });
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer-b" />);
    expect(screen.queryByText("Synthetic question 1?")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores a late preview response after switching to another account", async () => {
    let resolvePreview!: (value: LibraryQuestionSetPreview) => void;
    mocks.preview.mockImplementationOnce(() => new Promise<LibraryQuestionSetPreview>(resolve => { resolvePreview = resolve; }));
    const { rerender } = render(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    act(() => { useAccount.setState({ user: { id: "reviewer-b" } as never }); });
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer-b" />);
    await act(async () => { resolvePreview(reviewPreview); });
    expect(screen.queryByText("Synthetic question 1?")).toBeNull();
    act(() => { useAccount.setState({ user: { id: "reviewer-a" } as never }); });
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    await screen.findByRole("button", { name: "Inspect" });
    expect(screen.queryByText("Synthetic question 1?")).toBeNull();
  });

  it("does not revive an old preview when the first account signs in again", async () => {
    let resolvePreview!: (value: LibraryQuestionSetPreview) => void;
    mocks.preview.mockImplementationOnce(() => new Promise<LibraryQuestionSetPreview>(resolve => { resolvePreview = resolve; }));
    const { rerender } = render(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    act(() => { useAccount.setState({ user: { id: "reviewer-b" } as never }); });
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer-b" />);
    act(() => { useAccount.setState({ user: { id: "reviewer-a" } as never }); });
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer-a" />);
    await screen.findByRole("button", { name: "Inspect" });
    await act(async () => { resolvePreview(reviewPreview); });
    expect(screen.queryByText("Synthetic question 1?")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
