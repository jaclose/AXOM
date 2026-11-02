// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { ExplanationBody } from "./parts";

const question: QuestionRecord = {
  id: "diagram-simulator", source: "manual", stem: "A patient has runny nose and sneezing.",
  options: [{ key: "A", text: "Rhinovirus" }, { key: "B", text: "Influenza virus" }],
  correctKey: "A", explanation: "The source explanation remains unchanged after import.",
  status: "unseen", tags: [], attempts: [],
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(cleanup);

describe("shared simulator explanation", () => {
  it("preserves the source explanation and shows a separate sourced diagram", () => {
    render(<ExplanationBody question={question} picked="B" correctKey="A" result="incorrect" seconds={12} />);
    expect(screen.getByText("The source explanation remains unchanged after import.")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Related AXOM diagram" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /CDC · About Rhinoviruses/ })).toBeTruthy();
  });

  it("keeps uncertain questions free of a diagram", () => {
    render(<ExplanationBody question={{ ...question, needsReview: true }} result="unscored" seconds={4} />);
    expect(screen.queryByRole("complementary", { name: "Related AXOM diagram" })).toBeNull();
  });
});
