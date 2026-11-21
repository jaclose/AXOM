// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAcademicReviewer } from "../../lib/academicLibrary/client";
import {
  listPendingQuestionSets, loadPendingQuestionSetReviewPreview, reviewQuestionSetSubmission,
} from "../../lib/sharing/questionSetLibrary";
import { QuestionSetLibraryReviewQueue } from "./QuestionSetLibraryReviewQueue";

vi.mock("../../lib/academicLibrary/client", () => ({ isAcademicReviewer: vi.fn() }));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listPendingQuestionSets: vi.fn(),
  loadPendingQuestionSetReviewPreview: vi.fn(),
  reviewQuestionSetSubmission: vi.fn(),
}));

type Props = Parameters<typeof QuestionSetLibraryReviewQueue>[0];
type Preview = Awaited<ReturnType<typeof loadPendingQuestionSetReviewPreview>>;

const pending = [{
  id: "pending-1", title: "Review-only medical questions", questionCount: 1,
  credit: "Reviewer", createdAt: "2026-11-21T00:00:00.000Z",
}] as Awaited<ReturnType<typeof listPendingQuestionSets>>;

const privatePreview = {
  snapshot: {
    title: "Confidential review-only teaching",
    questions: [{
      id: "question-1", stem: "Sensitive question stem", correctKey: "B",
      options: [{ key: "A", text: "Distractor" }, { key: "B", text: "Correct" }],
      explanation: "Restricted explanation", citation: "Private source",
    }],
  },
} as unknown as Preview;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function props(refreshSignal: number, accessSuspended: boolean): Props {
  // The explicit Host reauthorization prop is deliberately exercised at runtime.
  // This cast permits a behavioral RED test against the older queue contract.
  return { accountId: "reviewer-a", refreshSignal, accessSuspended } as Props;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAcademicReviewer).mockResolvedValue(true);
  vi.mocked(listPendingQuestionSets).mockResolvedValue(pending);
  vi.mocked(loadPendingQuestionSetReviewPreview).mockResolvedValue(privatePreview);
  vi.mocked(reviewQuestionSetSubmission).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Host reviewer portal reauthorization", () => {
  it("removes a portaled private preview immediately while Host access is rechecked", async () => {
    const delayedReviewer = deferred<boolean>();
    vi.mocked(isAcademicReviewer).mockResolvedValueOnce(true).mockReturnValueOnce(delayedReviewer.promise);
    const { rerender } = render(<QuestionSetLibraryReviewQueue {...props(0, false)} />);
    const inspect = await screen.findByRole("button", { name: "Inspect" });
    inspect.focus();
    fireEvent.click(inspect);
    expect(await screen.findByRole("dialog")).toHaveProperty("textContent",
      expect.stringContaining("Restricted explanation"));

    rerender(<QuestionSetLibraryReviewQueue {...props(1, true)} />);
    // Modal portals to document.body, outside Host's hidden wrapper.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("Restricted explanation");
    expect(document.activeElement?.closest('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.closest(".qsl-review-queue")).toBeNull();

    await act(async () => { delayedReviewer.resolve(false); });
    rerender(<QuestionSetLibraryReviewQueue {...props(1, false)} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cannot reopen a stale portaled preview when an older Inspect request settles after reauthorization", async () => {
    const slowPreview = deferred<Preview>();
    vi.mocked(loadPendingQuestionSetReviewPreview).mockReturnValueOnce(slowPreview.promise);
    const { rerender } = render(<QuestionSetLibraryReviewQueue {...props(0, false)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(loadPendingQuestionSetReviewPreview).toHaveBeenCalledTimes(1));

    rerender(<QuestionSetLibraryReviewQueue {...props(1, true)} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<QuestionSetLibraryReviewQueue {...props(1, false)} />);
    await screen.findByRole("button", { name: "Inspect" });

    await act(async () => { slowPreview.resolve(privatePreview); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("Sensitive question stem");
  });

  it("releases a superseded Inspect lock after same-account Host authorization, without unlocking newer Inspect", async () => {
    const oldInspect = deferred<Preview>();
    const newInspect = deferred<Preview>();
    vi.mocked(loadPendingQuestionSetReviewPreview)
      .mockReturnValueOnce(oldInspect.promise).mockReturnValueOnce(newInspect.promise);
    const { rerender } = render(<QuestionSetLibraryReviewQueue {...props(0, false)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(loadPendingQuestionSetReviewPreview).toHaveBeenCalledTimes(1));

    rerender(<QuestionSetLibraryReviewQueue {...props(1, true)} />);
    rerender(<QuestionSetLibraryReviewQueue {...props(1, false)} />);
    const inspect = await screen.findByRole("button", { name: "Inspect" });
    await waitFor(() => expect((inspect as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(inspect);
    await waitFor(() => expect(loadPendingQuestionSetReviewPreview).toHaveBeenCalledTimes(2));

    await act(async () => { oldInspect.resolve(privatePreview); });
    expect((screen.getByRole("button", { name: "Inspect" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { newInspect.resolve(privatePreview); });
    expect(await screen.findByRole("dialog")).toHaveProperty("textContent",
      expect.stringContaining("Restricted explanation"));
  });

  it("keeps a pending review decision exclusive across reauthorization", async () => {
    const decision = deferred<void>();
    vi.mocked(reviewQuestionSetSubmission).mockReturnValueOnce(decision.promise);
    const { rerender } = render(<QuestionSetLibraryReviewQueue {...props(0, false)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: { value: "Reviewed rights and source evidence." },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Approve for library" }));
    await waitFor(() => expect(reviewQuestionSetSubmission).toHaveBeenCalledTimes(1));

    rerender(<QuestionSetLibraryReviewQueue {...props(1, true)} />);
    rerender(<QuestionSetLibraryReviewQueue {...props(1, false)} />);
    const inspect = await screen.findByRole("button", { name: "Inspect" });
    expect((inspect as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { decision.resolve(); });
    await waitFor(() => expect((screen.getByRole("button", { name: "Inspect" }) as HTMLButtonElement).disabled).toBe(false));
    expect(reviewQuestionSetSubmission).toHaveBeenCalledTimes(1);
  });

  it("retains a completed review receipt across same-account refresh, without retaining its modal", async () => {
    const { rerender } = render(<QuestionSetLibraryReviewQueue {...props(0, false)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: { value: "Verified source and distribution rights." },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Approve for library" }));
    expect(await screen.findByText("Question Set approved for search.")).toBeTruthy();
    rerender(<QuestionSetLibraryReviewQueue {...props(1, true)} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<QuestionSetLibraryReviewQueue {...props(1, false)} />);
    expect(screen.getByText("Question Set approved for search.")).toBeTruthy();
  });
});
