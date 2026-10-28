// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { blocksToPlainText, type QuestionBlock } from "../../lib/question-content/blocks";
import { blockMarks, paintBlock, plainLength, stemSelection, stemTextStarts } from "./stemMarks";

const blocks: QuestionBlock[] = [
  { type: "text", text: "  A man has chest pain." },
  { type: "image", assetId: "figure", alt: "ECG" },
  { type: "table", headers: ["Lab", "Value"], rows: [["pH", "7.55"]] },
  { type: "rich_text", html: "HCO<sub>3</sub> is high<br>and K<sup>+</sup> is low." },
  { type: "divider" },
  { type: "callout", text: "Choose one." },
];
const stem = blocksToPlainText(blocks).trim();

afterEach(() => { document.body.innerHTML = ""; window.getSelection()?.removeAllRanges(); });

describe("stem highlight offsets for imported questions", () => {
  it("places each paragraph where its words sit in the saved plain stem", () => {
    const starts = stemTextStarts(blocks, stem)!;
    expect([...starts.keys()].map((block) => block.type)).toEqual(["text", "rich_text", "callout"]);
    expect(starts.get(blocks[0])).toBe(-2);
    expect(stem.slice(starts.get(blocks[3])!, starts.get(blocks[3])! + "HCO3 is high\nand K+ is low.".length)).toBe("HCO3 is high\nand K+ is low.");
    expect(stem.slice(starts.get(blocks[5])!)).toBe("Choose one.");
  });

  it("offers no highlights once a reviewer's edit means the blocks no longer read as the stem", () => {
    expect(stemTextStarts(blocks, `${stem} Edited.`)).toBeUndefined();
  });

  it("draws one highlight across formatting as pieces and reads a drag back to stem offsets", () => {
    const starts = stemTextStarts(blocks, stem)!;
    const start = starts.get(blocks[3])!;
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.dataset.stemStart = String(start);
    root.append(paragraph);
    document.body.append(root);
    const html = "HCO<sub>3</sub> is high<br>and K<sup>+</sup> is low.";
    expect(blockMarks(start, 28, [{ id: "a", startOffset: start, endOffset: start + 4, tone: "yellow", exactText: "HCO3" } as never]))
      .toEqual([{ id: "a", from: 0, to: 4, tone: "yellow", label: "HCO3" }]);
    paintBlock(paragraph, html, "HCO3 is high\nand K+ is low.".length, [{ id: "a", from: 0, to: 4, tone: "yellow", label: "HCO3" }], false);
    expect([...paragraph.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["HCO", "3"]);
    expect(plainLength(paragraph)).toBe("HCO3 is high\nand K+ is low.".length);

    // Drag from inside "high" across the line break to "K".
    const high = [...paragraph.childNodes].find((node) => node.textContent === " is high")!;
    const and = [...paragraph.childNodes].find((node) => node.textContent === "and K")!;
    const range = document.createRange();
    range.setStart(high, 4);
    range.setEnd(and, 5);
    window.getSelection()!.addRange(range);
    const selected = stemSelection(root, window.getSelection())!;
    expect(stem.slice(selected.startOffset, selected.endOffset)).toBe("high\nand K");
  });

  it("leaves a paragraph unmarked when its rendered words differ from the stem's", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.dataset.stemStart = "0";
    root.append(paragraph);
    document.body.append(root);
    // The plain stem keeps "&#8211;" as written; the page shows one dash.
    paintBlock(paragraph, "pH 7.1&#8211;7.2", "pH 7.1&#8211;7.2".length, [{ id: "a", from: 0, to: 2, tone: "yellow", label: "pH" }], false);
    expect(paragraph.querySelectorAll("mark")).toHaveLength(0);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()!.addRange(range);
    expect(stemSelection(root, window.getSelection())).toBeNull();
  });
});
