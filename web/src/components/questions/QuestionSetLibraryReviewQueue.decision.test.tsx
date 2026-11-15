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
      copyrightNotice: "Contributor declares original synthetic material.",
      questions: Array.from({ length: size }, (_, index) => ({
        id: `question-${index + 1}`, stem: `Vignette ${index + 1}`,
        options: [{ key: "A", text: "First option" }, { key: "B", text: "Second option" }],
        correctKey: "A",
        explanation: index === 0
          ? "AXOM AI-assisted explanation (verify against source): Synthetic explanation for inspection."
          : "Source-specific rationale awaits verification.",
        choiceRationales: index === 0
          ? { A: "Source-matched choice A has the recorded synthetic criterion.",
              B: "AXOM AI-assisted rationale (verify against source): Synthetic distractor reasoning." }
          : undefined,
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

  it("shows rights assertions, choice-by-choice evidence gaps and AI provenance without treating them as approval", async () => {
    await inspect();
    expect(screen.getByText(/Recorded publication rights notice:/)).toBeTruthy();
    expect(screen.getByText(/Contributor declares original synthetic material/)).toBeTruthy();
    expect(screen.getByText(/not independently verified redistribution permission/i)).toBeTruthy();
    expect(screen.getByText(/Source-matched choice A has the recorded synthetic criterion/)).toBeTruthy();
    expect(screen.getByText(/Synthetic distractor reasoning/)).toBeTruthy();
    expect(screen.getByText(/AI-assisted explanation: source and medical claims require independent review/i)).toBeTruthy();
    expect(screen.getByText(/AI-assisted rationale: independently verify the source claim/i)).toBeTruthy();
    expect(screen.getAllByText(/No choice-specific rationale recorded/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("summarizes evidence gaps across undisplayed questions and blocks approval of an explanation-free legacy pending set", async () => {
    const candidate = reviewPreview(21);
    candidate.snapshot.questions[19].explanation = "Answer: A";
    candidate.snapshot.questions[20].explanation = "";
    candidate.snapshot.questions[20].citation = "";
    mocks.preview.mockResolvedValue(candidate);
    await inspect();
    const inventory = screen.getByTestId("qsl-review-evidence-inventory").textContent ?? "";
    expect(inventory).toContain("0 without recorded answer keys");
    expect(inventory).toContain("1 without source citations");
    expect(inventory).toContain("2 without explanation prose");
    expect(inventory).toContain("20 lacking at least one choice rationale");
    expect(inventory).toContain("1 containing AI-assisted teaching");
    expect(inventory).toContain("not verified answer keys or image rights");
    expect(inventory).toContain("Approval is blocked until every question records an answer key, a source citation and explanation prose");
    const note = "The final question has no source citation or explanation.";
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), { target: { value: note } });
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Return for revision" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(
      "independent-reviewer", expect.objectContaining({ id }), false, note,
    ));
  });

  it("requires key and citation evidence across undisplayed questions even when explanations have prose", async () => {
    const candidate = reviewPreview(21);
    candidate.snapshot.questions[19].correctKey = "";
    candidate.snapshot.questions[20].citation = "";
    mocks.preview.mockResolvedValue(candidate);
    await inspect();

    const inventory = screen.getByTestId("qsl-review-evidence-inventory").textContent ?? "";
    expect(inventory).toContain("1 without recorded answer keys");
    expect(inventory).toContain("1 without source citations");
    expect(inventory).toContain("0 without explanation prose");
    expect(inventory).toContain("Approval is blocked");
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: { value: "The final entries need a recorded source and answer key." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Return for revision" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(
      "independent-reviewer", expect.objectContaining({ id }), false,
      "The final entries need a recorded source and answer key.",
    ));
  });

  it("blocks an otherwise keyed and explained set when only its final source citation is missing", async () => {
    const candidate = reviewPreview(21);
    candidate.snapshot.questions[20].citation = "";
    mocks.preview.mockResolvedValue(candidate);
    await inspect();

    const inventory = screen.getByTestId("qsl-review-evidence-inventory").textContent ?? "";
    expect(inventory).toContain("0 without recorded answer keys");
    expect(inventory).toContain("1 without source citations");
    expect(inventory).toContain("0 without explanation prose");
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: { value: "The original source for question 21 was not recorded." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Return for revision" }).hasAttribute("disabled")).toBe(false);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("blocks an otherwise cited and explained set when only the final answer key is missing", async () => {
    const candidate = reviewPreview(21);
    candidate.snapshot.questions[20].correctKey = "";
    mocks.preview.mockResolvedValue(candidate);
    await inspect();

    const inventory = screen.getByTestId("qsl-review-evidence-inventory").textContent ?? "";
    expect(inventory).toContain("1 without recorded answer keys");
    expect(inventory).toContain("0 without source citations");
    expect(inventory).toContain("0 without explanation prose");
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByText("Unresolved")).toBeTruthy();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("flags placeholder teaching notices that pass generic prose detection but fail the publication admission contract", async () => {
    const candidate = reviewPreview(21);
    candidate.snapshot.questions[20].explanation = "Explanation: will be added";
    mocks.preview.mockResolvedValue(candidate);
    await inspect();

    const inventory = screen.getByTestId("qsl-review-evidence-inventory").textContent ?? "";
    expect(inventory).toContain("1 without explanation prose");
    fireEvent.click(screen.getByRole("button", { name: "Show next 20 questions" }));
    expect(await screen.findByText("Vignette 21")).toBeTruthy();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Approve for library" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: { value: "Question 21 still contains a placeholder rationale." },
    });
    expect(screen.getByRole("button", { name: "Return for revision" }).hasAttribute("disabled")).toBe(false);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

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
    // A deliberate refresh is different from the completion-triggered refresh:
    // clear the old confirmation before re-checking reviewer access.
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByText("Question Set returned to its contributor with your note.")).toBeNull();
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
