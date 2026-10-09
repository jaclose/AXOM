import { describe, expect, it } from "vitest";
import { planRenders } from "./renderPlan";

const sizes = new Map([[1, { width: 612, height: 792 }], [2, { width: 720, height: 540 }]]);

describe("what to draw for the pictures of a PDF", () => {
  it("draws a page once for all its pictures, at up to three times its size", () => {
    const plan = planRenders(new Map([
      ["a", { page: 1, box: { left: 100, top: 232, width: 300, height: 180 } }],
      ["b", { page: 1, box: { left: 100, top: 500, width: 100, height: 100 } }],
    ]), sizes);
    expect(plan).toEqual([{ page: 1, scale: 3, cuts: [
      { assetId: "a", left: 288, top: 684, width: 924, height: 564 },
      { assetId: "b", left: 288, top: 1488, width: 324, height: 324 },
    ] }]);
  });

  it("takes the whole page when there is no box, and keeps its longest edge within the limit", () => {
    const [plan] = planRenders(new Map([["answer", { page: 2 }]]), sizes);
    expect(plan.scale).toBeCloseTo(1600 / 720);
    expect(plan.cuts).toEqual([{ assetId: "answer", left: 0, top: 0, width: 1600, height: 1200 }]);
  });

  it("keeps a region and its margin on the page", () => {
    const [plan] = planRenders(new Map([["edge", { page: 2, box: { left: 0, top: 500, width: 720, height: 60 } }]]), sizes);
    expect(plan.cuts[0]).toEqual({ assetId: "edge", left: 0, top: Math.round(496 * plan.scale), width: 1600, height: Math.round(44 * plan.scale) });
  });

  it("goes page by page in order, and leaves out a page it was not told the size of", () => {
    const plan = planRenders(new Map([["late", { page: 2 }], ["early", { page: 1 }], ["lost", { page: 9 }]]), sizes);
    expect(plan.map((entry) => [entry.page, entry.cuts.map((cut) => cut.assetId)])).toEqual([[1, ["early"]], [2, ["late"]]]);
  });
});
