// Bounded local OCR fallback ONLY when a PDF has no digital text layer.
// This is an opt-in recovery for image-only originals. OCR is uncertain and
// never evidence for a verified medical answer or scored-practice readiness.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_PAGES = 20;
const MAX_PNG = 24 * 1024 * 1024;
const MAX_TEXT = 3_000_000;
export function ocrImageOnlyPdf(path, pages) {
  if (!Number.isSafeInteger(pages) || pages < 1) {
    return { attempted: false, pages: [], notes: ["PDF had no usable page count; preserve the original for manual review."] };
  }
  if (pages > MAX_PAGES) {
    return { attempted: false, pages: [],
      notes: [`Image-only PDF has ${pages} pages, exceeding the ${MAX_PAGES}-page opt-in OCR cap. Split the original into smaller parts before recognition.`] };
  }
  const directory = mkdtempSync(join(tmpdir(), "axom-review-ocr-"));
  const text = [];
  let length = 0;
  try {
    for (let page = 1; page <= pages; page++) {
      const output = join(directory, "page-" + String(page).padStart(3,"0"));
      execFileSync("pdftoppm", [
        "-f", String(page), "-l", String(page), "-singlefile",
        "-r", "160", "-png", path, output,
      ], { timeout: 35_000, maxBuffer: 64 * 1024 });
      const png = output + ".png";
      if (statSync(png).size > MAX_PNG) throw new Error("A scanned PDF page exceeds the 24 MB bounded OCR image limit.");
      // Tesseract stdout is read but NEVER uploaded or treated as a source key.
      const out = execFileSync("tesseract", [
        png, "stdout", "-l", "eng", "--psm", "3",
      ], { timeout: 35_000, maxBuffer: 2 * 1024 * 1024 }).toString("utf8");
      text.push(out.trim());
      length += out.length;
      if (length > MAX_TEXT) throw new Error("OCR output exceeds the 3 MB text limit; split this source.");
    }
    return { attempted: true, pages: text,
      notes: [`Tesseract extracted provisional text from all ${pages} image-only source pages. Text, figures and answer choices require side-by-side original-page review; no correct answers are verified.`] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
