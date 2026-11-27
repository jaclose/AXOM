// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionSourceIdentity } from "./QuestionSourceIdentity";
const question: QuestionRecord = { id: "synthetic", source: "manual", stem: "Which signal?", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B", explanation: "An answer hidden while solving.", status: "unseen", tags: [], attempts: [], createdAt: "2026-11-21", updatedAt: "2026-11-21" };
afterEach(cleanup);
it("preserves a supplied bank and author label alongside original source numbering", () => {
  const bank = "Synthetic review · Example Author · Original Practice Questions";
  const source = { ...question, bank, questionNumber: 17, sourcePage: 42, sourceFile: { name: "Original source.pdf", type: "application/pdf", size: 1, addedAt: "2026-11-21" } };
  const before = JSON.stringify(source);
  render(<QuestionSourceIdentity question={source} />);
  expect(screen.getByText(bank)).toBeTruthy();
  expect(screen.getByText("Original source.pdf · Source question 17 · Page 42")).toBeTruthy();
  expect(screen.queryByText(question.explanation!)).toBeNull();
  expect(JSON.stringify(source)).toBe(before);
});
it("uses available source metadata without inventing an author", () => {
  const view = render(<QuestionSourceIdentity question={question} />);
  expect(view.container.textContent).toBe("");
  view.rerender(<QuestionSourceIdentity question={{ ...question, sourceFile: { name: "Original.pdf", type: "application/pdf", size: 1, addedAt: "2026-11-21" } }} />);
  expect(view.container.textContent).toBe("Original.pdf");
});
