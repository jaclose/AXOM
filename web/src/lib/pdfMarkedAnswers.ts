import type { ParsedQuestionDraft } from "./questionParse";
import type { DeckPage } from "./deckPages";
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Matrix = [number, number, number, number, number, number];
interface Box { left: number; bottom: number; right: number; top: number }
interface Label { key: string; x: number; y: number; height: number }

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

/** Strict silhouette check for the six-vertex tick used by these source decks.
 * A green box, arrow or highlight is not answer evidence. PDF.js v6 represents
 * a path as move/line/close commands with a separate paint operation. */
export function isVectorCheck(path: ArrayLike<number>): boolean {
  if (path.length !== 19 || path[0] !== 0 || path[18] !== 4) return false;
  const points: number[][] = [];
  for (let i = 0; i < 18; i += 3) {
    if (i > 0 && path[i] !== 1) return false;
    points.push([path[i + 1], path[i + 2]]);
  }
  const xs = points.map(([x]) => x), ys = points.map(([,y]) => y);
  const left = Math.min(...xs), bottom = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - bottom;
  if (width <= 0 || height <= 0 || width / height < .65 || width / height > 1.4) return false;
  const template = [[.15,.61],[0,.305],[.4,0],[1,.826],[1,1],[.35,.305]];
  return points.every(([x,y], i) => Math.abs((x-left)/width-template[i][0]) < .13 && Math.abs((y-bottom)/height-template[i][1]) < .13);
}

export function answerBesideCheck(box: Box, labels: readonly Label[]): string | undefined {
  const height = box.top - box.bottom, width = box.right - box.left;
  if (height < 4 || height > 45 || width < 4 || width > 45) return undefined;
  const candidates = labels.filter((label) => {
    const gap = label.x - box.right;
    const middle = (box.top + box.bottom) / 2;
    return gap >= -2 && gap < 30 && Math.abs(middle - (label.y + label.height * .25)) < Math.max(7, label.height * .65);
  });
  return candidates.length === 1 ? candidates[0].key : undefined;
}

/** Propose from a native drawn check on a repeated answer slide. Never reads
 * medical meaning, color alone or a marker on the question's original slide.
 * Every proposal is review-gated and retains its exact answer page. */
export async function proposePdfMarkedAnswers(buffer: ArrayBuffer, drafts: ParsedQuestionDraft[], pages: readonly DeckPage[] = []): Promise<string[]> {
  const answers = pages.filter((page) => page.kind === "answer" && page.questionPage);
  if (!answers.length) return [];
  const notes: string[] = [];
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = browserPdfWorkerUrl;
  const task = pdfjs.getDocument({ data: buffer });
  try {
    const doc = await task.promise;
    for (const answer of answers) {
      const candidates = drafts.filter((draft) => draft.sourcePage === answer.questionPage);
      if (candidates.length !== 1) continue;
      const draft = candidates[0];
      if (draft.parserRuleIds?.includes("conflict.pdf-vector-answer")) continue;
      const page = await doc.getPage(answer.page);
      const text = await page.getTextContent();
      const labels = text.items.flatMap((item): Label[] => {
        if (!("str" in item)) return [];
        const key = item.str.match(/^\s*([A-H])[.)](?:\s|$)/)?.[1];
        return key ? [{ key, x: item.transform[4], y: item.transform[5], height: item.height }] : [];
      });
      const ops = await page.getOperatorList();
      const stack: Array<{ matrix: Matrix; color: string }> = [];
      let matrix: Matrix = [1,0,0,1,0,0], color = "";
      const found: string[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i], args = ops.argsArray[i];
        if (op === pdfjs.OPS.save) stack.push({ matrix, color });
        else if (op === pdfjs.OPS.restore) { const saved = stack.pop(); if (saved) { matrix = saved.matrix; color = saved.color; } }
        else if (op === pdfjs.OPS.transform) matrix = multiply(matrix, args as Matrix);
        else if (op === pdfjs.OPS.setFillRGBColor) color = String(args[0]);
        else if (op === pdfjs.OPS.constructPath && /^#[0-9a-f]{6}$/i.test(color)) {
          const red = parseInt(color.slice(1,3),16), green = parseInt(color.slice(3,5),16), blue = parseInt(color.slice(5,7),16);
          if (green < 120 || green < red + 50 || green < blue + 50 || ![pdfjs.OPS.fill, pdfjs.OPS.eoFill].includes(args[0])) continue;
          const paths = args[1] as ArrayLike<ArrayLike<number>>;
          if (paths?.length !== 1 || !isVectorCheck(paths[0])) continue;
          const coords = paths[0];
          const points = Array.from({ length: 6 }, (_, n) => {
            const x = coords[n*3+1], y = coords[n*3+2];
            return [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]];
          });
          const key = answerBesideCheck({ left: Math.min(...points.map(([x])=>x)), right: Math.max(...points.map(([x])=>x)),
            bottom: Math.min(...points.map(([,y])=>y)), top: Math.max(...points.map(([,y])=>y)) }, labels);
          if (key && draft.options.some((option) => option.key === key)) found.push(key);
        }
      }
      if (found.length !== 1) continue;
      const key = found[0];
      if (draft.correctKey && draft.correctKey !== key) {
        draft.correctKey = undefined;
        draft.correctAnswerText = undefined;
        draft.answerDetectionConfidence = 0;
        draft.warnings.push(`Page ${answer.page}: drawn answer check conflicts with the text answer. Check the source.`);
        draft.parserRuleIds = [...(draft.parserRuleIds ?? []), "conflict.pdf-vector-answer"];
      } else {
        draft.correctKey = key;
        draft.correctAnswerText = draft.options.find((option) => option.key === key)?.text;
        draft.answerDetectionConfidence = .88;
        draft.answerEvidencePage = answer.page;
        draft.answerEvidenceSnippet = `Native vector check beside option ${key} on repeated answer slide ${answer.page}.`;
        draft.warnings = draft.warnings.filter((warning) => !warning.startsWith("No correct answer was reliably detected"));
        draft.warnings.push(`Page ${answer.page}: a drawn check marks option ${key}. Confirm it against the source before saving.`);
        draft.parserRuleIds = [...(draft.parserRuleIds ?? []), "answer.pdf-vector-check"];
      }
      draft.needsReview = true;
      draft.confidence = "medium";
      draft.overallImportConfidence = Math.min(draft.overallImportConfidence ?? .75, .75);
      notes.push(`Question ${draft.questionNumber ?? drafts.indexOf(draft)+1}: check the drawn answer mark on page ${answer.page}.`);
    }
  } catch {
    notes.push("Drawn answer marks could not be read. Check unresolved answers against the source.");
  } finally { await task.destroy(); }
  return notes;
}
