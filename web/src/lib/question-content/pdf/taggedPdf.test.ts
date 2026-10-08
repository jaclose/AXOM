// Invented pages throughout: structure trees and text items written by hand,
// in the shapes pdf.js gives for a file exported from Word or PowerPoint.
import { describe, expect, it } from "vitest";
import { dropPageNumbers, figureRegions, figureTarget, marksOnAnswerPage, parseFigureTarget, readTaggedPage, type StructNode, type TaggedPageInput, type TextItem } from "./taggedPdf";

/** A page being drawn: each piece of text is given where it sits, counted from the top left. */
function sheet(width = 612, height = 792) {
  const items: TextItem[] = [];
  let next = 0;
  const text = (str: string, left: number, top: number, size = 12, turned = false): StructNode => {
    const id = `mc${(next += 1)}`;
    const baseline = height - top;
    items.push(
      { type: "beginMarkedContentProps", id },
      { str, transform: turned ? [0, size, -size, 0, left, baseline] : [size, 0, 0, size, left, baseline], width: str.length * size * 0.5, height: size },
      { type: "endMarkedContent" },
    );
    return { type: "content", id };
  };
  const loose = (str: string, left: number, top: number): void => void items.push({ str, transform: [12, 0, 0, 12, left, height - top], width: str.length * 6, height: 12 });
  const page = (tree: StructNode, extra: Partial<TaggedPageInput> = {}): TaggedPageInput => ({ page: 1, width, height, tree, items, ...extra });
  return { text, loose, page, height };
}
const node = (role: string, ...children: StructNode[]): StructNode => ({ role, children });
/** A figure's box as the file gives it: corners counted from the bottom left. */
const figure = (height: number, left: number, top: number, width: number, tall: number, alt?: string): StructNode =>
  ({ role: "Figure", bbox: [left, height - top - tall, left + width, height - top], ...(alt ? { alt } : {}) });

describe("a tagged page read in the order of its tags", () => {
  it("reads paragraphs in tag order, whatever order they were drawn in, and leaves out what is not tagged", () => {
    const s = sheet();
    const second = s.text("drawn first, tagged second", 72, 200);
    const first = s.text("drawn second, tagged first", 72, 100);
    s.loose("Page footer the file marks as furniture", 72, 760);
    const body = readTaggedPage(s.page(node("Document", node("P", first), node("P", second))));
    expect(body.elements).toEqual([{ kind: "paragraph", text: "drawn second, tagged first" }, { kind: "paragraph", text: "drawn first, tagged second" }]);
    expect(body.order).toBe("tags");
    expect(body.lines).toEqual([{ top: 100, text: "drawn second, tagged first" }, { top: 200, text: "drawn first, tagged second" }]);
    expect(body.coverage.tagged).toBeLessThan(body.coverage.all);
  });

  it("joins the pieces of a paragraph, across lines, with single spaces", () => {
    const s = sheet();
    const body = readTaggedPage(s.page(node("Document", node("P", s.text("A patient has a fever", 72, 100), s.text("and a new murmur.", 72, 116)))));
    expect(body.elements).toEqual([{ kind: "paragraph", text: "A patient has a fever and a new murmur." }]);
  });

  it("writes a raised or lowered piece as Unicode only when every character has one", () => {
    const height = 792;
    const items: TextItem[] = [
      { type: "beginMarkedContentProps", id: "a" },
      { str: "Na", transform: [12, 0, 0, 12, 72, height - 100], width: 14, height: 12 },
      { str: "+", transform: [8, 0, 0, 8, 86, height - 95], width: 5, height: 8 },
      { str: " and CO", transform: [12, 0, 0, 12, 91, height - 100], width: 42, height: 12 },
      { str: "2", transform: [8, 0, 0, 8, 133, height - 102], width: 4, height: 8 },
      { str: " and x", transform: [12, 0, 0, 12, 137, height - 100], width: 36, height: 12 },
      { str: "q", transform: [8, 0, 0, 8, 173, height - 95], width: 4, height: 8 },
      { type: "endMarkedContent" },
    ];
    const body = readTaggedPage({ page: 1, width: 612, height, tree: node("Document", node("P", { type: "content", id: "a" })), items });
    expect(body.elements).toEqual([{ kind: "paragraph", text: "Na⁺ and CO₂ and xq" }]);
  });

  it("reads a table from its rows and cells, with its heading row and row names", () => {
    const s = sheet();
    const cell = (role: "TH" | "TD", str: string, left: number, top: number): StructNode => node(role, node("P", s.text(str, left, top)));
    const table = node("Table",
      node("THead", node("TR", cell("TH", "Group", 72, 100), cell("TH", "Cases", 200, 100), cell("TH", "Controls", 300, 100))),
      node("TBody",
        node("TR", cell("TH", "Exposed", 72, 120), cell("TD", "30", 200, 120), cell("TD", "10", 300, 120)),
        node("TR", cell("TH", "Not exposed", 72, 140), cell("TD", "20", 200, 140), cell("TD", "40", 300, 140))));
    const body = readTaggedPage(s.page(node("Document", node("P", s.text("Use the table.", 72, 80)), table)));
    expect(body.elements[1]).toEqual({ kind: "table", rows: [["Group", "Cases", "Controls"], ["Exposed", "30", "10"], ["Not exposed", "20", "40"]], headerRows: 1, rowHeaders: true });
  });

  it("pads a short row, keeps two paragraphs of a cell on two lines, and drops a table with nothing in it", () => {
    const s = sheet();
    const table = node("Table",
      node("TR", node("TD", node("P", s.text("first line", 72, 100)), node("P", s.text("second line", 72, 114))), node("TD", node("P", s.text("b", 200, 100)))),
      node("TR", node("TD", node("P", s.text("c", 72, 130)))));
    const body = readTaggedPage(s.page(node("Document", table, node("Table", node("TR", node("TD"))))));
    expect(body.elements).toEqual([{ kind: "table", rows: [["first line\nsecond line", "b"], ["c", ""]] }]);
  });

  it("reads a list item's label as part of its line", () => {
    const s = sheet();
    const item = (label: string, str: string, top: number): StructNode => node("LI", node("Lbl", s.text(label, 72, top)), node("LBody", node("P", s.text(str, 90, top))));
    const body = readTaggedPage(s.page(node("Document", node("L", item("1.", "Which sign is most likely?", 100), node("L", item("A.", "Fever", 120), item("B.", "Rash", 140))))));
    expect(body.elements.map((element) => (element.kind === "paragraph" ? element.text : element.kind))).toEqual(["1. Which sign is most likely?", "A. Fever", "B. Rash"]);
  });

  it("puts a figure where the tags put it, and leaves a rule or a bullet out of the text", () => {
    const s = sheet();
    const body = readTaggedPage(s.page(node("Document",
      node("P", s.text("The graph shows two curves.", 72, 100)),
      figure(s.height, 100, 120, 300, 200, "Two dose-response curves"),
      figure(s.height, 72, 340, 400, 2),
      node("P", s.text("Which drug is more potent?", 72, 360)))));
    expect(body.elements).toEqual([
      { kind: "paragraph", text: "The graph shows two curves." },
      { kind: "image", target: "page:1:figure:0", alt: "Two dose-response curves" },
      { kind: "paragraph", text: "Which drug is more potent?" },
    ]);
    expect(body.figures).toEqual([{ left: 100, top: 120, width: 300, height: 200, alt: "Two dose-response curves" }, { left: 72, top: 340, width: 400, height: 2 }]);
    expect(body.regions).toEqual([]);
  });

  it("gives a figure tag with no box of its own the picture drawn on the page", () => {
    const s = sheet();
    const body = readTaggedPage(s.page(node("Document", node("P", s.text("See the image.", 72, 100)), { role: "Figure", alt: "A micrograph" }), { imageBoxes: [{ left: 90, top: 130, width: 240, height: 180 }] }));
    expect(body.elements[1]).toEqual({ kind: "image", target: "page:1:figure:0", alt: "A micrograph" });
    expect(body.figures).toEqual([{ left: 90, top: 130, width: 240, height: 180, alt: "A micrograph" }]);
  });

  it("keeps the text of each block the tags call a heading", () => {
    const s = sheet();
    const body = readTaggedPage(s.page(node("Document", node("H1", s.text("Epidemiology", 72, 80)), node("P", s.text("Epidemiology", 72, 100)), node("Title", s.text("Week 2 practice", 72, 60)))));
    expect(body.headings).toEqual(["Epidemiology", "Week 2 practice"]);
  });

  it("names a figure in the text so it can be found again", () => {
    expect(parseFigureTarget(figureTarget(12, 3))).toEqual({ page: 12, index: 3 });
    expect(parseFigureTarget("word/media/image1.png")).toBeUndefined();
  });
});

describe("a slide, read by where things sit", () => {
  const slide = () => sheet(720, 540);

  it("orders text boxes by position, not by the order they were made in", () => {
    const s = slide();
    const choices = node("P", s.text("A. Half-life", 60, 300, 18));
    const stem = node("P", s.text("1. Which value sets the dosing interval?", 40, 60, 20));
    const body = readTaggedPage(s.page(node("Sect", choices, stem), { slide: true }));
    expect(body.order).toBe("position");
    expect(body.elements.map((element) => (element.kind === "paragraph" ? element.text : element.kind))).toEqual(["1. Which value sets the dosing interval?", "A. Half-life"]);
  });

  it("reads a letter in one box and its answer in another, at the same height, as one line", () => {
    const s = slide();
    const body = readTaggedPage(s.page(node("Sect", node("P", s.text("Clearance", 100, 300, 18)), node("P", s.text("B.", 60, 301, 18))), { slide: true }));
    expect(body.elements).toEqual([{ kind: "paragraph", text: "B. Clearance" }]);
  });

  /** A graph at the right of the slide, drawn as two shapes, with its numbers and letters as text of the slide. */
  function slideWithGraph() {
    const s = slide();
    const tree = node("Sect",
      node("P", s.text("4. The graph shows three drugs. Which is the most potent?", 30, 40, 18)),
      node("P", s.text("A. Drug X", 74, 250, 18)),
      node("P", s.text("B. Drug Y", 74, 282, 18)),
      node("P", s.text("C. Drug Z", 74, 314, 18)),
      // The graph's own words: tick numbers at the heights of the choices, a title on its side, curve letters, the axis below.
      node("P", s.text("50", 345, 250, 12)),
      node("P", s.text("25", 345, 282, 12)),
      node("P", s.text("0", 350, 314, 12)),
      node("P", s.text("Percent of maximal effect", 330, 440, 12, true)),
      figure(s.height, 370, 230, 280, 228),
      figure(s.height, 372, 260, 270, 190),
      node("P", s.text("X", 655, 262, 12)),
      node("P", s.text("Y", 655, 300, 12)),
      node("P", s.text("1 10 100 1000", 380, 476, 12)),
      node("P", s.text("Dose (mg)", 480, 492, 12)));
    return readTaggedPage(s.page(tree, { slide: true }));
  }

  it("keeps a graph's numbers and letters with the graph, out of the answer choices", () => {
    const body = slideWithGraph();
    expect(body.elements.map((element) => (element.kind === "paragraph" ? element.text : element.kind))).toEqual([
      "4. The graph shows three drugs. Which is the most potent?", "A. Drug X", "B. Drug Y", "C. Drug Z",
    ]);
    expect(body.regions).toHaveLength(1);
    expect([...body.regions[0].labels!].sort()).toEqual(["0", "1 10 100 1000", "25", "50", "Dose (mg)", "Percent of maximal effect", "X", "Y"]);
  });

  it("grows the region to cover those labels, so the picture cut from the slide shows its own axes", () => {
    const [region] = slideWithGraph().regions;
    // Out to the title set on its side at the left, the curve letters at the right, and the axis title below.
    expect(region.left).toBeLessThan(332);
    expect(region.left + region.width).toBeGreaterThan(655);
    expect(region.top + region.height).toBeGreaterThan(480);
    // And no further: the choices and the stem are outside it.
    expect(region.left).toBeGreaterThan(200);
    expect(region.top).toBeGreaterThan(100);
  });

  it("never takes a line shaped like a choice or a numbered question, however close to a drawing it sits", () => {
    const s = slide();
    const body = readTaggedPage(s.page(node("Sect",
      figure(s.height, 300, 200, 300, 200),
      node("P", s.text("A. 5", 262, 260, 12)),
      node("P", s.text("2. Next", 262, 300, 12)),
      node("P", s.text("(B) 10", 262, 340, 12))), { slide: true }));
    expect(body.elements.map((element) => (element.kind === "paragraph" ? element.text : element.kind))).toEqual(["A. 5", "2. Next", "(B) 10"]);
    expect(body.regions[0].labels).toBeUndefined();
  });

  it("never takes the text beside a bare choice letter", () => {
    const s = slide();
    const body = readTaggedPage(s.page(node("Sect",
      figure(s.height, 300, 200, 300, 200),
      node("P", s.text("C.", 180, 260, 12)),
      node("P", s.text("20 mg", 262, 260, 12))), { slide: true }));
    expect(body.elements).toEqual([{ kind: "paragraph", text: "C. 20 mg" }]);
  });

  it("leaves a sentence beside a drawing in the text", () => {
    const s = slide();
    const body = readTaggedPage(s.page(node("Sect",
      figure(s.height, 300, 200, 300, 200),
      node("P", s.text("The curve shifts to the right when an antagonist is added.", 300, 420, 12))), { slide: true }));
    expect(body.elements).toHaveLength(1);
    expect(body.regions[0].labels).toBeUndefined();
  });
});

describe("across the pages of a file", () => {
  const pageWith = (number: number, lines: { top: number; text: string }[]) => ({
    page: number, height: 540, headings: [], figures: [], regions: [], coverage: { tagged: 0, all: 0 }, order: "position" as const,
    lines: lines.map((line) => ({ ...line })),
    elements: lines.map((line) => ({ kind: "paragraph" as const, text: line.text })),
  });

  it("takes out a bare number at the foot of the page when several pages have one", () => {
    const pages = [1, 2, 3].map((number) => pageWith(number, [{ top: 60, text: `${number}. A stem that ends in the number 3` }, { top: 300, text: "E. 3" }, { top: 520, text: String(number + 1) }]));
    expect(dropPageNumbers(pages)).toBe(3);
    expect(pages[1].elements.map((element) => element.text)).toEqual(["2. A stem that ends in the number 3", "E. 3"]);
    expect(pages[1].lines).toHaveLength(2);
  });

  it("removes the number at the foot, not the same digits used as a choice higher up", () => {
    const pages = [1, 2, 3].map((number) => pageWith(number, [{ top: 300, text: "4" }, { top: 520, text: "4" }]));
    dropPageNumbers(pages);
    expect(pages[0].lines).toEqual([{ top: 300, text: "4" }]);
    expect(pages[0].elements).toHaveLength(1);
  });

  it("leaves a lone number alone when too few pages have one to call it a page number", () => {
    const pages = [pageWith(1, [{ top: 520, text: "7" }]), pageWith(2, [{ top: 100, text: "A stem" }])];
    expect(dropPageNumbers(pages)).toBe(0);
    expect(pages[0].elements).toHaveLength(1);
  });

  it("makes one region of shapes that touch, and drops what is too small or covers the page", () => {
    const page = { width: 720, height: 540 };
    const regions = figureRegions([
      { left: 100, top: 100, width: 200, height: 10 },
      { left: 100, top: 112, width: 10, height: 150 },
      { left: 120, top: 130, width: 160, height: 100, alt: "A curve" },
      { left: 600, top: 500, width: 20, height: 20 },
      { left: 0, top: 0, width: 720, height: 540 },
    ].slice(0, 4), page);
    expect(regions).toEqual([{ left: 100, top: 100, width: 200, height: 162, alt: "A curve" }]);
    expect(figureRegions([{ left: 0, top: 0, width: 720, height: 540 }], page)).toEqual([]);
  });

  it("finds the shapes an answer slide has that its question slide does not", () => {
    const graph = { left: 300, top: 200, width: 300, height: 200 };
    const mark = { left: 50, top: 282, width: 18, height: 18 };
    expect(marksOnAnswerPage([graph], [{ ...graph, left: 300.4 }, mark])).toEqual([mark]);
    expect(marksOnAnswerPage([graph], [graph])).toEqual([]);
  });
});
