import type { FigureBox } from "../../pdfFigures";
import type { ImportPackage, PackageQuestion, QuestionAsset } from "../package";
import { answerBesideCheck, isVectorCheck, multiply, type ChoiceLabel, type MarkBox, type Matrix } from "./pdfAnswerMarkGeometry";
import { marksOnAnswerPage, readTaggedPage, type TaggedPageInput } from "./taggedPdf";

type PdfJs = typeof import("pdfjs-dist");

/** A resumable bank may be stale even when its catalog row still matches the inventory. */
export function assertPackageSourceIdentity(pkg: ImportPackage, source: { sha256: string; fileName: string }): void {
  if (!/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error("Inventory source checksum is invalid.");
  if (!pkg.questions.length) throw new Error("Prepared bank has no questions for answer-mark review.");
  const expectedChecksum = `sha256:${source.sha256}`;
  if (pkg.manifest.source.filename !== source.fileName) throw new Error("Prepared bank source filename does not match the inventory.");
  for (const question of pkg.questions) {
    if (question.source.filename !== source.fileName || question.provenance.sourceChecksum !== expectedChecksum) {
      throw new Error("Prepared question source identity does not match the inventory.");
    }
    if (question.assets.some(asset => asset.role === "answer_reveal"
      && (asset.sourceFile !== source.fileName || asset.questionId !== question.id))) {
      throw new Error("Prepared answer-reveal asset source identity does not match the inventory.");
    }
  }
}

export interface MarkEvidence {
  kind: "extra-tagged-figure" | "native-vector-check";
  /** Page units from the top left. No source text is copied into a receipt. */
  box: FigureBox;
  adjacentChoice?: string;
}

export interface AnswerMarkProposal {
  questionId: string;
  questionPage: number;
  answerPage: number;
  answerRevealAssetId: string;
  answerRevealAssetChecksum?: string;
  /** A visual suggestion only. It is never a scoring key. */
  suggestedChoice?: string;
  reviewRequired: true;
  reviewReason: "visual-mark" | "conflicts-with-key" | "conflicting-reveal-pages" | "multiple-marks" | "unmatched-mark";
  storedAnswerLabels: string[];
  conflict: boolean;
  evidence: MarkEvidence[];
}

export interface AnswerMarkPage {
  page: number;
  height: number;
  figures: readonly FigureBox[];
  labels: readonly ChoiceLabel[];
  vectorChecks: readonly MarkBox[];
}

interface Pair { question: PackageQuestion; questionPage: number; answerPage: number; asset: QuestionAsset }

/** Only the canonical answer-reveal asset proves that a slide belongs to one question. */
function pairedAnswerPages(questions: readonly PackageQuestion[]): Pair[] {
  const pairs = questions.flatMap((question): Pair[] => {
    const questionPage = question.source.page;
    if (!questionPage) return [];
    const assets = question.assets.filter(asset => asset.role === "answer_reveal"
      && asset.questionId === question.id && asset.sourceFile === question.source.filename
      && Number.isSafeInteger(asset.sourcePage) && Number(asset.sourcePage) > 0 && asset.sourcePage !== questionPage);
    const owners = new Map<number, number>();
    for (const asset of assets) owners.set(asset.sourcePage!, (owners.get(asset.sourcePage!) ?? 0) + 1);
    return assets.filter(asset => owners.get(asset.sourcePage!) === 1)
      .map(asset => ({ question, questionPage, answerPage: asset.sourcePage!, asset }));
  });
  const owners = new Map<number, number>();
  for (const pair of pairs) owners.set(pair.answerPage, (owners.get(pair.answerPage) ?? 0) + 1);
  return pairs.filter(pair => owners.get(pair.answerPage) === 1);
}

function topLeft(box: MarkBox, height: number): FigureBox {
  return { left: box.left, top: height - box.top, width: box.right - box.left, height: box.top - box.bottom };
}

function bottomLeft(box: FigureBox, height: number): MarkBox {
  return { left: box.left, bottom: height - box.top - box.height, right: box.left + box.width, top: height - box.top };
}

function samePhysicalMark(a: FigureBox, b: FigureBox): boolean {
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2, by = b.top + b.height / 2;
  const overlap = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return Math.abs(ax - bx) < 8 && Math.abs(ay - by) < 8
    && overlap >= Math.min(a.width * a.height, b.width * b.height) * .5;
}

/** Pure review projection. Extra graphics or contradictory marks stay ambiguous. */
export function buildAnswerMarkProposals(questions: readonly PackageQuestion[], pages: readonly AnswerMarkPage[]): AnswerMarkProposal[] {
  const byPage = new Map(pages.map(page => [page.page, page]));
  const proposals: AnswerMarkProposal[] = [];
  for (const pair of pairedAnswerPages(questions)) {
    const questionPage = byPage.get(pair.questionPage), answerPage = byPage.get(pair.answerPage);
    if (!questionPage || !answerPage) continue;
    const allowed = new Set(pair.question.choices.map(choice => choice.label.toUpperCase()));
    const labels = answerPage.labels.filter(label => allowed.has(label.key));
    const evidence: MarkEvidence[] = [];
    for (const box of marksOnAnswerPage(questionPage.figures, answerPage.figures)) {
      const adjacentChoice = answerBesideCheck(bottomLeft(box, answerPage.height), labels);
      if (box.width < 4 || box.width > 45 || box.height < 4 || box.height > 45) continue;
      evidence.push({ kind: "extra-tagged-figure", box, ...(adjacentChoice ? { adjacentChoice } : {}) });
    }
    for (const check of answerPage.vectorChecks) {
      const box = topLeft(check, answerPage.height);
      if (questionPage.vectorChecks.some(original => samePhysicalMark(box, topLeft(original, questionPage.height)))) continue;
      const adjacentChoice = answerBesideCheck(check, labels);
      evidence.push({ kind: "native-vector-check", box, ...(adjacentChoice ? { adjacentChoice } : {}) });
    }
    if (!evidence.length) continue;
    const groups: MarkEvidence[][] = [];
    for (const mark of evidence) {
      const group = groups.find(group => samePhysicalMark(group[0].box, mark.box));
      if (group) group.push(mark); else groups.push([mark]);
    }
    const choices = groups.length === 1 ? [...new Set(groups[0].map(mark => mark.adjacentChoice).filter((label): label is string => Boolean(label)))] : [];
    const suggestedChoice = choices.length === 1 ? choices[0] : undefined;
    const storedAnswerLabels = pair.question.correctAnswer?.labels ?? [];
    const conflict = Boolean(suggestedChoice && storedAnswerLabels.length && (storedAnswerLabels.length !== 1 || storedAnswerLabels[0] !== suggestedChoice));
    proposals.push({ questionId: pair.question.id, questionPage: pair.questionPage, answerPage: pair.answerPage,
      answerRevealAssetId: pair.asset.id,
      ...(pair.asset.checksum ? { answerRevealAssetChecksum: pair.asset.checksum } : {}),
      ...(suggestedChoice ? { suggestedChoice } : {}), reviewRequired: true,
      reviewReason: conflict ? "conflicts-with-key" : groups.length > 1 ? "multiple-marks" : suggestedChoice ? "visual-mark" : "unmatched-mark",
      storedAnswerLabels, conflict,
      evidence });
  }
  const byQuestion = new Map<string, AnswerMarkProposal[]>();
  for (const proposal of proposals) {
    const group = byQuestion.get(proposal.questionId) ?? [];
    group.push(proposal);
    byQuestion.set(proposal.questionId, group);
  }
  for (const group of byQuestion.values()) {
    const suggested = new Set(group.map(proposal => proposal.suggestedChoice).filter((choice): choice is string => Boolean(choice)));
    if (suggested.size < 2) continue;
    for (const proposal of group) {
      delete proposal.suggestedChoice;
      proposal.conflict = true;
      proposal.reviewReason = "conflicting-reveal-pages";
    }
  }
  return proposals;
}

type OperatorCodes = Pick<PdfJs["OPS"], "save" | "restore" | "transform" | "setFillRGBColor" | "constructPath" | "fill" | "eoFill">;
type OperatorList = { fnArray: readonly number[]; argsArray: readonly unknown[] };

/** Mirrors the browser's strict native tick check without changing a question. */
export function vectorCheckBoxes(operators: OperatorList, ops: OperatorCodes): MarkBox[] {
  const stack: Array<{ matrix: Matrix; color: string }> = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0], color = "";
  const checks: MarkBox[] = [];
  for (let i = 0; i < operators.fnArray.length; i += 1) {
    const op = operators.fnArray[i], args = operators.argsArray[i];
    if (op === ops.save) stack.push({ matrix, color });
    else if (op === ops.restore) { const saved = stack.pop(); if (saved) { matrix = saved.matrix; color = saved.color; } }
    else if (op === ops.transform && Array.isArray(args) && args.length === 6 && args.every(value => typeof value === "number")) matrix = multiply(matrix, args as Matrix);
    else if (op === ops.setFillRGBColor && Array.isArray(args)) color = String(args[0]);
    else if (op === ops.constructPath && /^#[0-9a-f]{6}$/i.test(color) && Array.isArray(args)) {
      const red = parseInt(color.slice(1, 3), 16), green = parseInt(color.slice(3, 5), 16), blue = parseInt(color.slice(5, 7), 16);
      if (green < 120 || green < red + 50 || green < blue + 50 || ![ops.fill, ops.eoFill].includes(args[0] as number)) continue;
      const paths = args[1] as ArrayLike<ArrayLike<number>> | undefined;
      const path = paths?.[0];
      if (paths?.length !== 1 || !path || !isVectorCheck(path)) continue;
      const points = Array.from({ length: 6 }, (_, n) => {
        const x = path[n * 3 + 1], y = path[n * 3 + 2];
        return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
      });
      checks.push({ left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])),
        bottom: Math.min(...points.map(point => point[1])), top: Math.max(...points.map(point => point[1])) });
    }
  }
  return checks;
}

function pageLabels(page: TaggedPageInput): ChoiceLabel[] {
  return page.items.flatMap((item): ChoiceLabel[] => {
    const key = item.str?.match(/^\s*([A-J])[.)](?:\s|$)/i)?.[1]?.toUpperCase();
    const transform = item.transform;
    return key && transform && Number.isFinite(transform[4]) && Number.isFinite(transform[5])
      ? [{ key, x: transform[4], y: transform[5], height: item.height ?? 0 }] : [];
  });
}

/** Reopens paired pages for native draw paths; originals remain unchanged. */
export async function scanPdfAnswerMarkProposals(pdfjs: PdfJs, bytes: Uint8Array, rawPages: readonly TaggedPageInput[], questions: readonly PackageQuestion[]): Promise<AnswerMarkProposal[]> {
  const pairs = pairedAnswerPages(questions);
  if (!pairs.length) return [];
  const neededPages = new Set(pairs.flatMap(pair => [pair.questionPage, pair.answerPage]));
  const pages: AnswerMarkPage[] = rawPages.filter(page => neededPages.has(page.page)).map(page => ({ page: page.page, height: page.height,
    figures: readTaggedPage(page).figures, labels: pageLabels(page), vectorChecks: [] }));
  const byPage = new Map(pages.map(page => [page.page, page]));
  const pairedPages = [...new Set(pairs.flatMap(pair => [pair.questionPage, pair.answerPage]))].filter(page => byPage.has(page));
  if (pairedPages.length) {
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 });
    try {
      const doc = await task.promise;
      for (const number of pairedPages) {
        const page = await doc.getPage(number);
        const operators = await page.getOperatorList();
        byPage.get(number)!.vectorChecks = vectorCheckBoxes(operators, pdfjs.OPS);
      }
      await doc.cleanup();
    } finally { await task.destroy(); }
  }
  return buildAnswerMarkProposals(questions, pages);
}
