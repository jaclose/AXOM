import type { ParsedQuestionDraft } from "./questionParse";
import type { DeckPage } from "./deckPages";
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { answerBesideCheck, isVectorCheck, multiply, type ChoiceLabel, type Matrix } from "./question-content/pdf/pdfAnswerMarkGeometry";

export { answerBesideCheck, isVectorCheck } from "./question-content/pdf/pdfAnswerMarkGeometry";

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
      const labels = text.items.flatMap((item): ChoiceLabel[] => {
        if (!("str" in item)) return [];
        const key = item.str.match(/^\s*([A-I])[.)](?:\s|$)/)?.[1];
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
