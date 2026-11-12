// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAcademicReviewer } from "../../lib/academicLibrary/client";
import {
  listPendingQuestionSets, loadPendingQuestionSetReviewPreview, reviewQuestionSetSubmission,
  type LibraryQuestionSetPreview, type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { QuestionSetLibraryReviewQueue } from "./QuestionSetLibraryReviewQueue";

vi.mock("../../lib/academicLibrary/client", () => ({ isAcademicReviewer: vi.fn() }));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listPendingQuestionSets: vi.fn(),
  loadPendingQuestionSetReviewPreview: vi.fn(),
  reviewQuestionSetSubmission: vi.fn(),
}));

const row: LibrarySubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceId: "synthetic-source",
  title: "Synthetic pending set",
  credit: "Synthetic author",
  questionCount: 1,
  status: "pending",
  reviewNote: "",
  createdAt: "2026-11-11T00:00:00.000Z",
};
const preview: LibraryQuestionSetPreview = {
  id: row.id,
  status: "pending",
  reviewRevision: 1,
  contentDigest: "a".repeat(64),
  snapshot: {
    shareFormatVersion: 1,
    title: row.title,
    createdAt: row.createdAt,
    copyrightNotice: "Synthetic content for local review tests only.",
    tags: [],
    orderedQuestionIds: ["synthetic-question"],
    questions: [{
      id: "synthetic-question",
      stem: "Which synthetic option is the reviewed key?",
      options: [{ key: "A", text: "First label" }, { key: "B", text: "Second label" }],
      correctKey: "B",
      correctAnswerText: "Second label",
      explanation: "The synthetic test defines the second label as correct.",
      citation: "Synthetic review fixture",
      tags: [],
    }],
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAcademicReviewer).mockResolvedValue(true);
  vi.mocked(listPendingQuestionSets).mockResolvedValue([row]);
  vi.mocked(loadPendingQuestionSetReviewPreview).mockResolvedValue(preview);
  vi.mocked(reviewQuestionSetSubmission).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Host standalone Question Set review queue", () => {
  it("rechecks grants and revocations when the outer Host refreshes", async () => {
    vi.mocked(isAcademicReviewer).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { rerender } = render(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={0} />);
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={1} />);
    expect(await screen.findByText(row.title)).toBeTruthy();
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={2} />);
    await waitFor(() => expect(isAcademicReviewer).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText(row.title)).toBeNull());
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
  });

  it("discards late pending results from a prior authorized refresh after access is revoked", async () => {
    let resolveFirst!: (rows: LibrarySubmission[]) => void;
    const first = new Promise<LibrarySubmission[]>(resolve => { resolveFirst = resolve; });
    vi.mocked(listPendingQuestionSets).mockReturnValueOnce(first);
    vi.mocked(isAcademicReviewer).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { rerender } = render(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={0} />);
    await waitFor(() => expect(listPendingQuestionSets).toHaveBeenCalledTimes(1));
    rerender(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={1} />);
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    await act(async () => { resolveFirst([row]); });
    expect(screen.queryByText(row.title)).toBeNull();
  });

  it("notifies Host after a verified decision and never before it resolves", async () => {
    const user = userEvent.setup();
    const completed = vi.fn();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(reviewQuestionSetSubmission).mockReturnValueOnce(pending);
    render(<QuestionSetLibraryReviewQueue accountId="reviewer" refreshSignal={0} onReviewed={completed} />);
    expect(await screen.findByText(row.title)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    const dialog = await screen.findByRole("dialog", { name: `Review ${row.title}` });
    await user.type(within(dialog).getByRole("textbox", { name: "Review note" }), "Synthetic source and redistribution rights checked.");
    await user.click(within(dialog).getByRole("checkbox", { name: /I checked the set's distribution rights/ }));
    await user.click(within(dialog).getByRole("button", { name: "Approve for library" }));
    await waitFor(() => expect(reviewQuestionSetSubmission).toHaveBeenCalledTimes(1));
    expect(completed).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Question Set approved for search.")).toBeTruthy();
  });
});
