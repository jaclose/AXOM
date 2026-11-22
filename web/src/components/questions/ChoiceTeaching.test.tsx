// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { ChoiceTeaching } from "./ChoiceTeaching";

const question: QuestionRecord = {
  id: "q1", source: "pdf", stem: "Which option is supported?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
  correctKey: "B", correctAnswerText: "Beta", explanation: "Beta follows from the reviewed source explanation.",
  choiceRationales: { A: "Alpha conflicts with the stated mechanism." },
  extraction: { confidence: "high", reviewed: true }, status: "unseen", tags: [], attempts: [],
  createdAt: "2026-10-23T00:00:00.000Z", updatedAt: "2026-10-23T00:00:00.000Z",
};

afterEach(cleanup);

describe("ChoiceTeaching", () => {
  it("does not count a retained answer notice as correct-choice teaching", () => {
    const source = { ...question, explanation: "PowerPoint slide note 12 explicitly marks B. The supplied notes do not provide a teaching rationale." };
    const before = JSON.stringify(source);
    render(<ChoiceTeaching question={source} pickedKey="A" />);
    expect(screen.getByText("1 separate explanation")).toBeTruthy();
    expect(screen.queryByText("The core explanation above covers why this answer is correct.")).toBeNull();
    expect(JSON.stringify(source)).toBe(before);
  });

  it("orders the trusted answer and learner choice first without altering source fields", () => {
    const before = JSON.stringify(question);
    render(<ChoiceTeaching question={question} pickedKey="A" />);
    const rows = [...document.querySelectorAll("[data-choice-key]")];
    expect(rows.map((row) => row.getAttribute("data-choice-key"))).toEqual(["B", "A", "C"]);
    expect(rows.slice(0, 2).every((row) => row.hasAttribute("open"))).toBe(true);
    expect(screen.getByText("1 separate explanation")).toBeTruthy();
    expect(screen.getByText("Alpha conflicts with the stated mechanism.")).toBeTruthy();
    expect(screen.getAllByText("No separate explanation")).toHaveLength(2);
    expect(screen.getAllByText(/See the main explanation above/)).toHaveLength(2);
    expect(screen.queryByText("Pending review")).toBeNull();
    expect(JSON.stringify(question)).toBe(before);
  });

  it("does not treat a main explanation as a separate choice rationale", () => {
    const source = { ...question, choiceRationales: undefined };
    const before = JSON.stringify(source);
    const { container } = render(<ChoiceTeaching question={source} pickedKey="A" />);
    expect(container.childElementCount).toBe(0);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("counts only nonempty explicit rationales for actual choices", () => {
    const source = { ...question, choiceRationales: { A: "Alpha fails the stated condition.", B: "Beta meets the stated condition.", C: "  ", Z: "An old option is no longer present." } };
    const before = JSON.stringify(source);
    render(<ChoiceTeaching question={source} pickedKey="A" />);
    expect(screen.getByText("2 separate explanations")).toBeTruthy();
    expect(screen.getByText("Alpha fails the stated condition.")).toBeTruthy();
    expect(screen.getByText("Beta meets the stated condition.")).toBeTruthy();
    expect(screen.getAllByText("No separate explanation")).toHaveLength(1);
    expect(screen.queryByText("An old option is no longer present.")).toBeNull();
    expect(screen.queryByText("Pending review")).toBeNull();
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not reveal teaching tied to an unresolved key", () => {
    const { container } = render(<ChoiceTeaching question={{ ...question, needsReview: true }} pickedKey="A" />);
    expect(container.childElementCount).toBe(0);
  });
});
