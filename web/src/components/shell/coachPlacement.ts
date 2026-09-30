// Where a coach bubble sits relative to its target: below when it fits,
// otherwise above, always inside a 16 px gutter, with the arrow still aimed
// at the middle of the target even when the bubble is pushed sideways.
// Sidebar targets can ask for "right", so the bubble never covers the nav.
export interface Rect { top: number; left: number; width: number; height: number }
export type BubbleSide = "below" | "above" | "right";
export interface BubblePlacement { top: number; left: number; side: BubbleSide; arrowX: number; arrowY: number }

const GAP = 14;
const GUTTER = 16;
const ARROW_INSET = 18;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function placeBubble(
  target: Rect,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: "vertical" | "right" = "vertical",
  /** Horizontal limits, e.g. the main surface, so a page hint never spills over the sidebar. */
  bounds: { left: number; right: number } = { left: 0, right: viewport.width },
): BubblePlacement {
  const minLeft = Math.max(GUTTER, bounds.left + GUTTER / 2);
  const maxLeft = Math.min(viewport.width, bounds.right) - GUTTER - bubble.width;
  const centreX = target.left + target.width / 2;
  const centreY = target.top + target.height / 2;
  if (prefer === "right" && target.left + target.width + GAP + bubble.width <= viewport.width - GUTTER) {
    const top = clamp(centreY - bubble.height / 2, GUTTER, viewport.height - GUTTER - bubble.height);
    return { top, left: target.left + target.width + GAP, side: "right", arrowX: 0, arrowY: clamp(centreY - top, ARROW_INSET, bubble.height - ARROW_INSET) };
  }
  const below = target.top + target.height + GAP + bubble.height <= viewport.height - GUTTER
    || target.top - GAP - bubble.height < GUTTER;
  const top = below ? target.top + target.height + GAP : target.top - GAP - bubble.height;
  const left = clamp(centreX - bubble.width / 2, minLeft, maxLeft);
  const arrowX = clamp(centreX - left, ARROW_INSET, bubble.width - ARROW_INSET);
  return { top, left, side: below ? "below" : "above", arrowX, arrowY: 0 };
}
