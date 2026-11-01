// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { AXOM_DIAGRAMS } from "../../lib/diagrams/registry";
import { matchAxomDiagram } from "../../lib/diagrams/match";
import { AxomDiagramCard } from "./AxomDiagramCard";

vi.mock("../../lib/diagrams/match", () => ({ matchAxomDiagram: vi.fn() }));

const question: QuestionRecord = {
  id: "synthetic-review", source: "manual", stem: "A synthetic review question.",
  options: [{ key: "A", text: "Sample" }, { key: "B", text: "Other" }], correctKey: "A",
  status: "unseen", tags: [], attempts: [],
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
};
const brachial = AXOM_DIAGRAMS.find((entry) => entry.id === "brachial-plexus-posterior-cord")!;
const match = vi.mocked(matchAxomDiagram);

beforeEach(() => match.mockReturnValue(brachial));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AXOM diagram card", () => {
  it("shows authored art and a full-size link without exposing a routing tag in copy", () => {
    render(<AxomDiagramCard question={question} />);
    const image = screen.getByRole("img", { name: brachial.illustration!.alt });
    expect(image.getAttribute("src")).toBe("/academic-diagrams/brachial-plexus-posterior-cord.svg");
    expect(screen.getByRole("link", { name: /open full diagram/i }).getAttribute("href")).toBe(image.getAttribute("src"));
    expect(screen.getByText("AXOM topic · Clinical anatomy")).toBeTruthy();
    expect(screen.queryByText(brachial.topicTag)).toBeNull();
  });

  it("hides a failed image but retries the same topic on another question", () => {
    const { rerender } = render(<AxomDiagramCard question={question} />);
    fireEvent.error(screen.getByRole("img", { name: brachial.illustration!.alt }));
    expect(screen.queryByRole("complementary", { name: "Related AXOM diagram" })).toBeNull();
    rerender(<AxomDiagramCard question={{ ...question, id: "another-synthetic-review" }} />);
    expect(screen.getByRole("img", { name: brachial.illustration!.alt })).toBeTruthy();
    rerender(<AxomDiagramCard question={question} />);
    expect(screen.getByRole("img", { name: brachial.illustration!.alt })).toBeTruthy();
  });
});
