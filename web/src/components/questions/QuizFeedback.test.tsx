// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { QuizFeedback } from "./QuizFeedback";

const stem = "A 36-year-old man with tuberculosis exposure has a positive PPD skin test.";
const question: QuestionRecord = {
  id: "ppd", source: "pdf", stem,
  options: [
    { key: "A", text: "B lymphocytes" },
    { key: "B", text: "CD4+ T lymphocytes" },
    { key: "C", text: "Mast cells" },
  ],
  correctKey: "B", correctAnswerText: "CD4+ T lymphocytes",
  explanation: "The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
  objective: "Recognize delayed-type hypersensitivity.",
  bank: "Week 4 set", sourcePage: 1, citation: "Week 4 source",
  extraction: {
    confidence: "high", reviewed: true, overallImportConfidence: 0.96,
    questionSourceSnippet: `${stem}\nA. B lymphocytes\nB. CD4+ T lymphocytes`,
    questionSourcePage: 1,
    answerEvidenceSnippet: "Answer: B. CD4+ T lymphocytes",
    answerEvidencePage: 2,
    explanationSourceSnippet: "The PPD test is a type IV hypersensitivity reaction.",
    explanationSourcePage: 3,
    parserRuleIds: ["answer.explicit-letter-text"],
  },
  status: "unseen", tags: [], attempts: [],
  createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z",
};

afterEach(cleanup);

describe("QuizFeedback", () => {
  it("shows a sourced related diagram beside a revealed keyed explanation", () => {
    const rhinovirus = {
      ...question,
      stem: "A patient has runny nose and sneezing.",
      options: [{ key: "A", text: "Rhinovirus" }, { key: "B", text: "Influenza virus" }],
      correctKey: "A", correctAnswerText: "Rhinovirus",
    };
    render(<QuizFeedback question={rhinovirus} pickedKey="B" />);
    expect(screen.getByRole("complementary", { name: "Related AXOM diagram" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /CDC · About Rhinoviruses/ })).toHaveProperty("href", "https://www.cdc.gov/rhinoviruses/about/index.html");
    expect(screen.getByText(/does not verify the question’s answer key/)).toBeTruthy();
  });
  it("shows a short incorrect banner, distinct answers, and the stored clean explanation", () => {
    render(<QuizFeedback question={question} pickedKey="A" />);
    expect(screen.getByRole("status").textContent).toContain("Incorrect — you picked A, answer is B");
    expect(screen.getByText("B. CD4+ T lymphocytes")).toBeTruthy();
    expect(screen.getByText("A. B lymphocytes")).toBeTruthy();
    const explanation = document.querySelector(".feedback-explanation p") as HTMLElement;
    expect(explanation).toBeTruthy();
    expect(explanation.textContent).not.toContain(stem);
    expect(explanation.textContent).not.toContain("Answer: B");
    expect(explanation.textContent).not.toContain("Objective:");
  });

  it("shows the correct state and source metadata without mixing it into prose", () => {
    render(<QuizFeedback question={question} pickedKey="B" />);
    expect(screen.getByRole("status").textContent).toContain("Correct — you picked B");
    expect(screen.getByText("Question source")).toBeTruthy();
    expect(screen.getByText("Answer evidence")).toBeTruthy();
    expect(screen.getByText("Explanation source")).toBeTruthy();
    expect(screen.getByText("page 1")).toBeTruthy();
    expect(screen.getByText("page 2")).toBeTruthy();
    expect(screen.getByText("page 3")).toBeTruthy();
    expect(screen.getByText("Recognize delayed-type hypersensitivity.")).toBeTruthy();
  });

  it("renders a manually edited answer-line-shaped explanation verbatim", () => {
    const edited = "Answer choice B is wrong because receptor affinity alone does not determine signaling.";
    render(<QuizFeedback question={{ ...question, explanation: `  ${edited}  ` }} pickedKey="A" />);
    expect(screen.getByText(edited).textContent).toBe(edited);
  });

  it("exposes repair actions through explicit callbacks", () => {
    const review = vi.fn();
    const mapping = vi.fn();
    render(<QuizFeedback question={question} pickedKey="A" onAddReview={review} onEditMapping={mapping} />);
    screen.getByRole("button", { name: /add to review/i }).click();
    screen.getByRole("button", { name: /edit mapping/i }).click();
    expect(review).toHaveBeenCalledOnce();
    expect(mapping).toHaveBeenCalledOnce();
  });

  it("uses a needs-review banner when no reliable answer exists", () => {
    render(<QuizFeedback question={{ ...question, correctKey: undefined, correctAnswerText: undefined }} pickedKey="A" />);
    expect(screen.getByRole("status").textContent).toContain("Needs inspection — no reliable answer was mapped");
  });

  it("does not reveal an unreviewed truthy key as trusted", () => {
    render(<QuizFeedback question={{ ...question, needsReview: true }} pickedKey="B" />);
    expect(screen.getByRole("status").textContent).toContain("Needs inspection — no reliable answer was mapped");
    expect(screen.queryByText("Correct answer")).toBeNull();
  });

  it("does not mislabel a legacy combined excerpt as the question source", () => {
    render(<QuizFeedback question={{
      ...question,
      extraction: {
        confidence: "medium",
        reviewed: false,
        sourceSnippet: "Answer: B. CD4+ T lymphocytes",
      },
    }} pickedKey="A" />);
    expect(screen.getByText("Legacy source excerpt")).toBeTruthy();
    expect(screen.getByText("No separate question excerpt was stored.")).toBeTruthy();
  });
});
