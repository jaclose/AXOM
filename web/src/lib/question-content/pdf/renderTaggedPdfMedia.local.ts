// @vitest-environment node
// Offline source-verified asset rendering for private academic PDF preparation.
// Uses AXOM's existing tagged PDF render plans; Poppler rasterization only.
// This file is imported by LOCAL tests, never by the browser UI or server.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRenders } from "./renderPlan";
import type { RenderRequest } from "./taggedPdfToQuestions";

export interface OfflineRenderOptions {
  onProgress?: (done: number, total: number, page: number) => void;
  maxPages?: number;
  maxRequests?: number;
}
export interface RenderedPdfMedia {
  assets: Map<string, Uint8Array>;
  renderedPages: number;
  issues: string[];
}
const MAX_PAGE_PNG_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_RENDER_BYTES = 200 * 1024 * 1024;

/** All-or-nothing render. Caller can retain the untouched original on failure. */
export function renderTaggedPdfMediaLocally(
  sourcePath: string,
  requests: ReadonlyMap<string, RenderRequest>,
  pageSizes: ReadonlyMap<number, { width: number; height: number }>,
  options: OfflineRenderOptions = {},
): RenderedPdfMedia {
  const plans = planRenders(requests, pageSizes);
  const maxPages = options.maxPages ?? 100, maxRequests = options.maxRequests ?? 250;
  if (plans.length > maxPages || requests.size > maxRequests) {
    throw new Error(`This PDF has ${plans.length} rendered pages / ${requests.size} figures; exceeds offline limit ${maxPages}/${maxRequests}. Split for import without losing figures.`);
  }
  if (!plans.length) return { assets: new Map(), renderedPages: 0, issues: [] };
  const scratch = mkdtempSync(join(tmpdir(), "axom-offline-figures-"));
  const images = new Map<string, Uint8Array>();
  let renderedPages = 0, totalBytes = 0;
  try {
    for (const [index, plan] of plans.entries()) {
      const prefix = join(scratch, `source-${String(index).padStart(3, "0")}`);
      const pagePng = prefix + ".png";
      // Poppler renders one requested page, not all pages in the academic PDF.
      execFileSync("pdftocairo", [
        "-png", "-singlefile", "-f", String(plan.page), "-l", String(plan.page),
        "-r", String(Math.round(72 * plan.scale)), sourcePath, prefix,
      ], { timeout: 45_000, maxBuffer: 256 * 1024 });
      if (statSync(pagePng).size > MAX_PAGE_PNG_BYTES) {
        throw new Error(`Page ${plan.page} exceeds the 32 MB rendering budget. Split this bank; nothing was installed.`);
      }
      const dimensions = execFileSync("magick", ["identify", "-format", "%w %h", pagePng], {
        timeout: 10_000, encoding: "utf8", maxBuffer: 128,
      }).trim().split(/\s+/).map(Number);
      const [imageWidth, imageHeight] = dimensions;
      if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth < 1 || imageHeight < 1) {
        throw new Error(`Page ${plan.page} produced invalid pixel dimensions.`);
      }
      for (const [cutIndex, cut] of plan.cuts.entries()) {
        const left = Math.max(0, Math.min(imageWidth - 1, cut.left));
        const top = Math.max(0, Math.min(imageHeight - 1, cut.top));
        const width = Math.max(1, Math.min(imageWidth - left, cut.width));
        const height = Math.max(1, Math.min(imageHeight - top, cut.height));
        const cropPath = join(scratch, `figure-${String(index).padStart(3, "0")}-${cutIndex}.png`);
        execFileSync("magick", [
          pagePng, "-crop", `${width}x${height}+${left}+${top}`, "+repage",
          "-strip", cropPath,
        ], { timeout: 20_000, maxBuffer: 256 * 1024 });
        if (statSync(cropPath).size > MAX_ASSET_BYTES) {
          throw new Error(`An original figure on page ${plan.page} exceeds the supported 8 MB attachment limit.`);
        }
        const bytes = readFileSync(cropPath);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_TOTAL_RENDER_BYTES) throw new Error("This bank exceeds 200 MB of processed figures. Split it for safe import.");
        if (images.has(cut.assetId)) throw new Error("Duplicate figure identity encountered; package cannot be trusted.");
        images.set(cut.assetId, bytes);
      }
      renderedPages += 1;
      options.onProgress?.(renderedPages, plans.length, plan.page);
    }
    if (images.size !== requests.size) {
      throw new Error(`Asset coverage incomplete (${images.size} of ${requests.size} figures). Original file was retained for review.`);
    }
    return { assets: images, renderedPages, issues: [] };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
