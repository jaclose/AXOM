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
  it("orders the trusted answer and learner choice first without altering source fields", () => {
    const before = JSON.stringify(question);
    render(<ChoiceTeaching question={question} pickedKey="A" />);
    const rows = [...document.querySelectorAll("[data-choice-key]")];
    expect(rows.map((row) => row.getAttribute("data-choice-key"))).toEqual(["B", "A", "C"]);
    expect(rows.slice(0, 2).every((row) => row.hasAttribute("open"))).toBe(true);
    expect(screen.getByText("The core explanation above covers why this answer is correct.")).toBeTruthy();
    expect(screen.getByText("Alpha conflicts with the stated mechanism.")).toBeTruthy();
    expect(screen.getByText("No reviewed explanation has been added for this choice yet.")).toBeTruthy();
    expect(JSON.stringify(question)).toBe(before);
  });

  it("does not reveal teaching tied to an unresolved key", () => {
    const { container } = render(<ChoiceTeaching question={{ ...question, needsReview: true }} pickedKey="A" />);
    expect(container.childElementCount).toBe(0);
  });
});
