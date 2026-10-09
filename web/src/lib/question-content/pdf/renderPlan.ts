// ===========================================================================
// What to draw, worked out before anything is drawn: for each page that has a
// picture to cut, the scale to draw the page at and the rectangle of each
// picture in the pixels of that drawing. Pure, so it is tested without a
// browser.
// ===========================================================================
import type { RenderRequest } from "./taggedPdfToQuestions";

/** Longest edge of a saved picture, in pixels. Enough to read labels, small enough to store. */
export const MAX_PICTURE_EDGE = 1600;
/** A little of the page around a region, in points, so a line on its edge is not cut in half. */
export const REGION_MARGIN = 4;

export interface PixelCut {
  assetId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageRenderPlan {
  page: number;
  scale: number;
  cuts: PixelCut[];
}

export function planRenders(renders: ReadonlyMap<string, RenderRequest>, sizes: ReadonlyMap<number, { width: number; height: number }>): PageRenderPlan[] {
  const byPage = new Map<number, { assetId: string; left: number; top: number; width: number; height: number }[]>();
  for (const [assetId, request] of renders) {
    const size = sizes.get(request.page);
    if (!size) continue;
    // A region with its margin, kept on the page. No box means the whole page.
    const left = request.box ? Math.max(0, request.box.left - REGION_MARGIN) : 0;
    const top = request.box ? Math.max(0, request.box.top - REGION_MARGIN) : 0;
    const right = request.box ? Math.min(size.width, request.box.left + request.box.width + REGION_MARGIN) : size.width;
    const bottom = request.box ? Math.min(size.height, request.box.top + request.box.height + REGION_MARGIN) : size.height;
    if (right <= left || bottom <= top) continue;
    byPage.set(request.page, [...(byPage.get(request.page) ?? []), { assetId, left, top, width: right - left, height: bottom - top }]);
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, areas]) => {
    // One drawing of the page serves every picture on it, so the largest sets the scale.
    const largest = Math.max(...areas.map((area) => Math.max(area.width, area.height)));
    const scale = Math.min(3, Math.max(1, MAX_PICTURE_EDGE / largest));
    return {
      page,
      scale,
      cuts: areas.map((area) => ({
        assetId: area.assetId,
        left: Math.round(area.left * scale),
        top: Math.round(area.top * scale),
        width: Math.max(1, Math.round(area.width * scale)),
        height: Math.max(1, Math.round(area.height * scale)),
      })),
    };
  });
}
