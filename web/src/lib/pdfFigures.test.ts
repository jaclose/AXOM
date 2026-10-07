import { describe, expect, it } from "vitest";
import { figureBoxes, imageBoxes, locateQuestionPages, placeFigures, withoutDecorations } from "./pdfFigures";

const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4 };
const PAGE = { width: 612, height: 792 };
// A page's viewport transform at scale 1: flips y so the origin is the top left.
const VIEW = [1, 0, 0, -1, 0, 792];

describe("where images sit on a PDF page", () => {
  it("carries the image's unit square through the transforms in force", () => {
    const boxes = imageBoxes({
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject],
      argsArray: [null, [200, 0, 0, 120, 72, 420], ["img1"], null, ["img2"]],
    }, OPS, VIEW);
    // Drawn at x 72..272, y 420..540 from the bottom: 252 from the top.
    expect(boxes[0]).toEqual({ left: 72, top: 252, width: 200, height: 120 });
    // After restore the transform is gone: the second image is one point square.
    expect(boxes[1]).toMatchObject({ width: 1, height: 1 });
  });

  it("nests transforms inside a saved state", () => {
    const [box] = imageBoxes({
      fnArray: [OPS.transform, OPS.save, OPS.transform, OPS.paintImageXObject],
      argsArray: [[1, 0, 0, 1, 100, 100], null, [50, 0, 0, 60, 0, 0], ["img"]],
    }, OPS, VIEW);
    expect(box).toEqual({ left: 100, top: 632, width: 50, height: 60 });
  });

  it("keeps figures, drops logos and rules, and recognises a page that is one image", () => {
    const { figures, pageIsImage } = figureBoxes([
      { left: 72, top: 252, width: 200, height: 120 },
      { left: 540, top: 20, width: 30, height: 30 },
      { left: 72, top: 700, width: 468, height: 2 },
      { left: 0, top: 0, width: 612, height: 792 },
    ], PAGE);
    expect(figures).toEqual([{ left: 72, top: 252, width: 200, height: 120 }]);
    expect(pageIsImage).toBe(true);
  });

  it("joins a figure drawn in tiles into one, and clips one drawn past the page edge", () => {
    const { figures } = figureBoxes([
      { left: 72, top: 200, width: 100, height: 100 },
      { left: 172, top: 200, width: 100, height: 100 },
      { left: 500, top: 500, width: 300, height: 100 },
    ], PAGE);
    expect(figures).toEqual([
      { left: 72, top: 200, width: 200, height: 100 },
      { left: 500, top: 500, width: 112, height: 100 },
    ]);
  });
});

describe("which question a figure belongs to", () => {
  const figure = (page: number, top: number, name = `p${page}-fig1.png`) => ({ name, page, top });

  it("gives a figure to the only question on its page", () => {
    expect(placeFigures([figure(2, 300)], [{ stem: "First?", sourcePage: 1 }, { stem: "Second?", sourcePage: 2 }])).toEqual([
      { name: "p2-fig1.png", page: 2, draftIndex: 1, basis: "only-question-on-page" },
    ]);
  });

  it("on a shared page, gives it to the question whose first line is nearest above it", () => {
    const drafts = [
      { stem: "A 40-year-old man has chest pain. What is the diagnosis?", sourcePage: 3 },
      { stem: "The radiograph shows which abnormality?", sourcePage: 3 },
    ];
    const lines = new Map([[3, [
      { top: 80, text: "7. A 40-year-old man has chest pain. What is the diagnosis?" },
      { top: 380, text: "8. The radiograph shows which abnormality?" },
    ]]]);
    expect(placeFigures([figure(3, 420), figure(3, 150, "p3-fig2.png")], drafts, lines).map((item) => [item.draftIndex, item.basis])).toEqual([
      [1, "below-question-start"], [0, "below-question-start"],
    ]);
  });

  it("leaves a figure unplaced, with the reason, when a shared page cannot be read", () => {
    const drafts = [{ stem: "First question on the page?", sourcePage: 3 }, { stem: "Second question on the page?", sourcePage: 3 }];
    // Only one of the two questions can be found in the page's text.
    const lines = new Map([[3, [{ top: 80, text: "First question on the page?" }]]]);
    expect(placeFigures([figure(3, 200)], drafts, lines)).toEqual([{
      name: "p3-fig1.png", page: 3,
      reason: "Page 3 holds 2 questions and AXOM could not tell which one this image is under.",
    }]);
  });

  it("follows a question onto the next page, and no further", () => {
    const drafts = [{ stem: "A long case?", sourcePage: 4 }];
    expect(placeFigures([figure(5, 100)], drafts)[0]).toMatchObject({ draftIndex: 0, basis: "question-runs-onto-page" });
    expect(placeFigures([figure(9, 100)], drafts)[0]).toEqual({
      name: "p9-fig1.png", page: 9, reason: "No question was found on page 9 or the page before it.",
    });
  });
});

describe("decks that repeat a logo, and a question on its answer page", () => {
  it("drops an image drawn in the same place on most pages and keeps the figures", () => {
    const logo = { left: 500, top: 20, width: 80, height: 60 };
    const figure = { left: 72, top: 252, width: 200, height: 120 };
    const pages = [1, 2, 3, 4, 5, 6].map((page) => ({ page, boxes: page === 3 ? [logo, figure] : [logo] }));
    expect(withoutDecorations(pages)).toEqual(new Map([[3, [figure]]]));
    // Two pages sharing an image is not a template: both are kept.
    expect(withoutDecorations([{ page: 1, boxes: [figure] }, { page: 2, boxes: [figure] }]).size).toBe(2);
  });

  it("finds a question on the first page its opening words appear, in document order", () => {
    const first = "A 40-year-old man has crushing chest pain for one hour. What is the diagnosis?";
    const second = "A 22-year-old woman has a rash after sun exposure. What is the next step?";
    const pages = [
      `Question 1 ${first} A. One B. Two`,
      `Question 1 ${first} Answer: B, with the reason.`,
      `Question 2 ${second} A. One B. Two`,
      `Question 2 ${second} Answer: A, with the reason.`,
    ];
    expect(locateQuestionPages([{ stem: first }, { stem: second }], pages)).toEqual([
      { page: 1, byFirstAppearance: true, repeatsOn: [2] },
      { page: 3, byFirstAppearance: true, repeatsOn: [4] },
    ]);
    // A page the importer already attributed is kept as it is.
    expect(locateQuestionPages([{ stem: first, sourcePage: 2 }], pages)[0]).toMatchObject({ page: 2, byFirstAppearance: false, repeatsOn: [1] });
    // Too little text to recognise: no page is claimed.
    expect(locateQuestionPages([{ stem: "Which one?" }], pages)[0]).toEqual({ page: undefined, byFirstAppearance: false, repeatsOn: [] });
  });

  it("attaches the question slide's figure and keeps the answer slide's out of the question", () => {
    const drafts = [{ stem: "First?", sourcePage: 1, repeatsOn: [2] }, { stem: "Second?", sourcePage: 3, repeatsOn: [4] }];
    const placed = placeFigures([
      { name: "p1.png", page: 1, top: 300 }, { name: "p2.png", page: 2, top: 300 }, { name: "p3.png", page: 3, top: 300 },
    ], drafts);
    expect(placed.map((item) => item.draftIndex)).toEqual([0, undefined, 1]);
    expect(placed[1].reason).toBe("Page 2 repeats a question, which is usually its answer page, so this image was kept out of the question to avoid giving the answer away.");
  });
});
