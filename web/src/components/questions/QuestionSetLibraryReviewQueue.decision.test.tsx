// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuestionSetLibraryReviewQueue } from "./QuestionSetLibraryReviewQueue";

const mocks = vi.hoisted(() => ({
  reviewer: vi.fn(), pending: vi.fn(), preview: vi.fn(), decide: vi.fn(),
}));

vi.mock("../../lib/academicLibrary/client", () => ({
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
}));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listPendingQuestionSets: (...args: unknown[]) => mocks.pending(...args),
  loadPendingQuestionSetReviewPreview: (...args: unknown[]) => mocks.preview(...args),
  reviewQuestionSetSubmission: (...args: unknown[]) => mocks.decide(...args),
}));

const id = "11111111-1111-4111-8111-111111111111";
const pendingRow = {
  id, sourceId: "local-set", title: "Review candidate", credit: "Contributor",
  questionCount: 21, status: "pending", reviewNote: "", createdAt: "2026-11-13T10:00:00Z",
};

function reviewPreview(size: number) {
  return {
    id, status: "pending" as const, reviewRevision: 2, contentDigest: "a".repeat(64),
    snapshot: {
      title: "Review candidate",
      questions: Array.from({ length: size }, (_, index) => ({
        id: `question-${index + 1}`, stem: `Vignette ${index + 1}`,
        options: [{ key: "A", text: "First option" }, { key: "B", text: "Second option" }],
        correctKey: "A", explanation: "Source-specific rationale awaits verification.",
        citation: "Contributor supplied source",
      })),
    },
  };
}

describe("Question Set academic decisions", () => {
  beforeEach(() => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.pending.mockResolvedValue([pendingRow]);
    mocks.preview.mockResolvedValue(reviewPreview(21));
    mocks.decide.mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  async function inspect() {
    render(<QuestionSetLibraryReviewQueue accountId="independent-reviewer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await screen.findByText("Vignette 1");
  }

  it("permits reasoned rejection without falsely attesting to distribution rights or answer correctness", async () => {
    await inspect();
    const reason = "Source reproduction rights are not demonstrated.";
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), { target: { value: reason } });
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    const reject = screen.getByRole("button", { name: "Return for revision" });
    expect(reject.hasAttribute("disabled")).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(
      "independent-reviewer", expect.objectContaining({ id }), false, reason,
    ));
    await screen.findByText("Question Set returned to its contributor with your note.");
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });

  it("withholds approval until the complete set is displayed and independent review explicitly attested", async () => {
    await inspect();
    const note = "Reviewed all source references, keys and distribution rights.";
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), { target: { value: note } });
    const approve = screen.getByRole("button", { name: "Approve for library" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/20 of 21 questions displayed for inspection/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByText(/21 of 21 questions displayed for inspection/)).toBeTruthy();
    expect(approve.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approve.hasAttribute("disabled")).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(
      "independent-reviewer", expect.objectContaining({ id }), true, note,
    ));
    await screen.findByText("Question Set approved for search.");
  });

  it("never loads pending submissions for a non-reviewer", async () => {
    mocks.reviewer.mockResolvedValue(false);
    render(<QuestionSetLibraryReviewQueue accountId="ordinary-contributor" />);
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull();
  });
});
