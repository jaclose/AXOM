import { describe, expect, it } from "vitest";
import { placeBubble } from "./coachPlacement";

const viewport = { width: 1440, height: 900 };
const bubble = { width: 300, height: 140 };

describe("placeBubble", () => {
  it("sits below a top-left target, pinned to the gutter, arrow aimed at the target", () => {
    const placed = placeBubble({ top: 83, left: 31, width: 229, height: 50 }, bubble, viewport);
    expect(placed).toEqual({ top: 147, left: 16, side: "below", arrowX: 31 + 229 / 2 - 16, arrowY: 0 });
  });

  it("flips above when there is no room below", () => {
    const placed = placeBubble({ top: 820, left: 700, width: 100, height: 40 }, bubble, viewport);
    expect(placed.side).toBe("above");
    expect(placed.top).toBe(820 - 14 - 140);
    expect(placed.left).toBe(600);
    expect(placed.arrowX).toBe(150);
  });

  it("keeps the arrow off the rounded corner at a phone's right edge", () => {
    const placed = placeBubble({ top: 100, left: 360, width: 20, height: 20 }, bubble, { width: 390, height: 844 });
    expect(placed.left).toBe(390 - 16 - 300);
    expect(placed.arrowX).toBe(300 - 18);
  });

  it("sits to the right of a sidebar target when asked, arrow at its middle", () => {
    const placed = placeBubble({ top: 83, left: 31, width: 229, height: 50 }, bubble, viewport, "right");
    expect(placed).toEqual({ top: 108 - 70, left: 31 + 229 + 14, side: "right", arrowX: 0, arrowY: 70 });
  });

  it("stays inside the main surface so a page hint never covers the sidebar", () => {
    const placed = placeBubble({ top: 490, left: 393, width: 34, height: 34 }, bubble, viewport, "vertical", { left: 271, right: 1420 });
    expect(placed.left).toBe(271 + 8);
    expect(placed.arrowX).toBe(393 + 17 - 279);
  });

  it("falls back to below when a phone has no room on the right", () => {
    const placed = placeBubble({ top: 16, left: 16, width: 44, height: 44 }, bubble, { width: 360, height: 780 }, "right");
    expect(placed.side).toBe("below");
  });
});
