// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextAnnotation } from "../../lib/questionAnnotations";
import { blocksToPlainText, type QuestionBlock } from "../../lib/question-content/blocks";
import type { PackageQuestion } from "../../lib/question-content/package";
import { QuestionBlocks } from "./QuestionContent";

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });
const blocks: QuestionBlock[] = [
  { type: "rich_text", html: "First <b>important <sub>2</sub></b> value.<br>Next line." },
  { type: "table", caption: "Results", headers: ["Test", "Value"], rows: [["Sodium", "140"], ["Calcium", "9.2"]] },
  { type: "text", text: "Last paragraph asks for the finding." },
];
const content: PackageQuestion = { id: "q", source: { filename: "test.pdf" }, stem: blocks, choices: [], assets: [], provenance: { method: "authored" } };
const plain = blocksToPlainText(blocks);

function select(start: Node, from: number, end: Node, to: number) {
  const range = document.createRange(); range.setStart(start, from); range.setEnd(end, to);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  fireEvent.mouseUp(screen.getByLabelText("Rich stem"));
}

describe("rich question annotations use canonical source offsets", () => {
  it("selects across nested formatting, line breaks, paragraphs and table cells", () => {
    const onSelection = vi.fn();
    render(<QuestionBlocks blocks={blocks} content={content} mode="question" annotation={{ annotations: [], label: "Rich stem", onSelection }} />);
    const first = screen.getByText("important").firstChild!;
    const end = screen.getByText("140").firstChild!;
    select(first, 0, end, 2);
    const startOffset = plain.indexOf("important");
    const endOffset = plain.indexOf("140") + 2;
    expect(onSelection).toHaveBeenLastCalledWith({ startOffset, endOffset });
    expect(plain.slice(startOffset, endOffset)).toContain("Results\nTest | Value\nSodium | 14");
    expect(screen.getByText("2").closest("sub")).not.toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
    select(screen.getByText("Calcium").firstChild!, 1, screen.getByText("9.2").firstChild!, 3);
    expect(onSelection).toHaveBeenLastCalledWith({ startOffset: plain.indexOf("Calcium") + 1, endOffset: plain.indexOf("9.2") + 3 });
  });

  it("renders one stored annotation over multiple rich leaves, then erases by stable ID", () => {
    const onDelete = vi.fn();
    const annotation = createTextAnnotation({ id: "mark-1", sourceText: plain, target: "stem", startOffset: plain.indexOf("important"), endOffset: plain.indexOf("Next") + 4, tone: "cyan", now: "2026-10-23T00:00:00Z" });
    const { container } = render(<QuestionBlocks blocks={blocks} content={content} mode="question" annotation={{ annotations: [annotation], label: "Rich stem", onDelete, eraseMode: true }} />);
    expect(container.querySelectorAll('[data-annotation-id="mark-1"]').length).toBeGreaterThan(2);
    expect(container.querySelector("sub mark")?.textContent).toBe("2");
    fireEvent.keyDown(container.querySelector("mark")!, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledExactlyOnceWith("mark-1");
  });

  it("does not capture repair notices or hidden answer-image labels", () => {
    const onSelection = vi.fn();
    const hidden: QuestionBlock[] = [{ type: "text", text: "First" }, { type: "image", assetId: "answer", alt: "Secret answer", role: "answer_reveal" }, { type: "text", text: "Last" }];
    render(<QuestionBlocks blocks={hidden} content={{ ...content, assets: [{ id: "answer", filename: "answer.png", mimeType: "image/png", role: "answer_reveal", questionId: "q" }] }} mode="question" annotation={{ annotations: [], label: "Rich stem", onSelection }} />);
    expect(screen.queryByText(/Secret answer/)).toBeNull();
    select(screen.getByText("Last").firstChild!, 0, screen.getByText("Last").firstChild!, 4);
    expect(onSelection).toHaveBeenLastCalledWith({ startOffset: blocksToPlainText(hidden).indexOf("Last"), endOffset: blocksToPlainText(hidden).length });
  });
});
