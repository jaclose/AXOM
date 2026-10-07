import type { QuestionAnalysis, SourceTrace } from "./decodeTypes";
import { parseQuestionBlocks, parseQuestionText, type ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";

export interface ReviewPacketInput {
  pages: string[];
  documentId: string;
  checksum: string;
  fileName: string;
  title: string;
  module?: string;
  now?: string | Date;
}

export interface ReviewPacketResult {
  questions: QuestionRecord[];
  analyses: QuestionAnalysis[];
  warnings: string[];
  /** One-based pages with fewer than 100 characters of extracted text. This is not an OCR verdict. */
  sparsePages: number[];
  sourceOnlyPages: number[];
  pageCount: number;
  extractedPageCount: number;
  format: "review-slides" | "labelled-questions" | "source-only";
}

type Page = { number: number; raw: string; text: string; label?: number; role?: "answer" | "teaching" | "slide" };
type Group = { draft: ParsedQuestionDraft; question: Page; pages: Page[] };
type Teaching = { concept: string; explanation: string; rule: string; distractors: QuestionAnalysis["distractors"]; lecture?: string };
const SPARSE_CHARACTERS = 100;
const compact = (value: string) => value.toUpperCase().replace(/\s/g, "");
const flatten = (value: string) => value.replace(/\s+/g, " ").trim();
const signature = (draft: ParsedQuestionDraft) => flatten(`${draft.stem} ${draft.options.map((option) => `${option.key} ${option.text}`).join(" ")}`).toLowerCase();

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function cleanPage(raw: string, number: number): Page {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").filter((line) => {
    const header = compact(line);
    return !/^JAFARDABBAGH\d*$/.test(header)
      && !/^MSA[·•]TERM1[·•]FTM2REVIEW\d*$/.test(header)
      && line.trim() !== String(number);
  });
  const first = lines.findIndex((line) => line.trim());
  const match = first >= 0 ? lines[first].match(/^\s*Q\s*((?:\d\s*){1,4})(.*)$/i) : null;
  let role: Page["role"];
  if (match) {
    const rest = compact(match[2]);
    if (rest.startsWith("ANSWER") || rest.startsWith("·ANSWER")) role = "answer";
    else if (rest.startsWith("WHY")) role = "teaching";
    else if (rest.startsWith("LECTURE") || rest.startsWith("·LECTURE")) role = "slide";
  }
  const teaching = lines.some((line) => /^(WHYIT['’]SRIGHT|WHYNOTTHEOTHERS|WHY[A-H]$|WHYTHEOTHERS)/.test(compact(line)));
  if (teaching) role = "teaching";
  return { number, raw, text: lines.join("\n").trim(), label: match ? Number(match[1].replace(/\s/g, "")) : undefined, role };
}

function contentLines(page: Page): string[] {
  const lines = page.text.split("\n");
  if (page.label !== undefined) lines.shift();
  return lines;
}

function questionDraft(page: Page): ParsedQuestionDraft | undefined {
  if (page.role === "teaching" || page.role === "slide") return undefined;
  const lines = contentLines(page);
  const normalized: string[] = [];
  let stopped = false;
  for (const line of lines) {
    if (/^(HOOK|HIGH-YIELD|CARRYTHIS)/.test(compact(line))) stopped = true;
    if (stopped || /^\s*(?:QUESTION|Lecture\s*\d+\s*:|DLA\s*\d+\s*:)/i.test(line)) continue;
    // Editorial slides separate a lowercase option letter from its copy, often onto a new baseline.
    const loose = line.match(/^\s*([a-h])(?:\s{2,}|\s*$)(.*)$/);
    normalized.push(loose ? `${loose[1].toUpperCase()}. ${loose[2]}` : line);
  }
  // The canonical parser requires option copy on the label line.
  const joined = normalized.join("\n").replace(/^([A-H])\.\s*\n\s*/gm, "$1. ");
  const draft = parseQuestionText(joined);
  const keys = draft.options.map((option) => option.key);
  if (!draft.stem || draft.options.length < 2 || draft.options.length > 8 || new Set(keys).size !== keys.length) return undefined;
  if (keys.some((key, index) => key !== String.fromCharCode(65 + index))) return undefined;
  return { ...draft, questionNumber: page.label ?? draft.questionNumber };
}

function headerPattern(label: string): RegExp {
  return new RegExp(`^\\s*[✓✔]?\\s*${[...label].filter((c) => c !== " ").map((c) => c.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("[ \\t]*")}(?:[ \\t]+|$)(.*)$`, "i");
}

const SECTION_HEADERS = [
  ["WHY NOT THE OTHERS", "others"], ["WHY IT'S RIGHT", "why"], ["THE OTHERS", "others"],
  ["IF THE STEM CHANGES", "variant"], ["CONCEPTUAL FRAMEWORK", "framework"],
  ["HIGH-YIELD", "rule"], ["CARRY THIS", "rule"], ["HOOK", "rule"], ["ANSWER", "answer"], ["WHY", "why"],
].map(([label, section]) => ({ section, pattern: headerPattern(label) }));

function teachingFrom(pages: Page[]): Teaching {
  let concept = "";
  let lecture: string | undefined;
  const why: string[] = [];
  const rule: string[] = [];
  const distractors = new Map<string, string[]>();
  for (const page of pages) {
    const lectureLine = page.text.split("\n").find((line) => /L\s*E\s*C\s*T\s*U\s*R\s*E\b/i.test(line));
    if (!lecture && lectureLine) {
      const match = lectureLine.match(/(L\s*E\s*C\s*T\s*U\s*R\s*E[\s\S]*)/i);
      if (match) lecture = flatten(match[1]);
    }
    if (page.role !== "teaching" && !/\bHOOK\b/.test(page.text)) continue;
    let section = "intro";
    let currentKey: string | undefined;
    let sharedColumns = false;
    for (const raw of contentLines(page)) {
      const line = raw.trim();
      if (!line) continue;
      const squashed = compact(line);
      if (/^WHY(?:IT['’]SRIGHT)?(?:WHYNOT)?THEOTHERS$/.test(squashed)) {
        section = "why";
        sharedColumns = true;
        continue;
      }
      const matched = SECTION_HEADERS.map((heading) => ({ ...heading, match: line.match(heading.pattern) })).find((heading) => heading.match);
      if (matched) {
        section = matched.section;
        currentKey = undefined;
        const tail = matched.match?.[1]?.trim();
        if (section === "rule" && tail) rule.push(tail);
        if (section === "why" && tail && !/^[A-H]$/.test(tail)) why.push(tail);
        continue;
      }
      if (section === "intro") {
        const title = line.split(/\s+ANSWER\s+/i)[0];
        if (!concept && !/^\d+$/.test(title)) concept = title;
        if (/\s+ANSWER\s+/i.test(line)) section = "answer";
        continue;
      }
      const choice = line.match(/^([A-Ha-h])(?:[.)]|\s)\s*(.+)$/);
      if ((section === "others" || (section === "why" && sharedColumns)) && choice) {
        section = "others";
        currentKey = choice[1].toUpperCase();
        if (!distractors.has(currentKey)) distractors.set(currentKey, []);
        distractors.get(currentKey)?.push(choice[2]);
      } else if (section === "others" && currentKey) distractors.get(currentKey)?.push(line);
      else if (section === "why") why.push(line.replace(/^[■▪•]\s*/, ""));
      else if (section === "rule") rule.push(line);
    }
  }
  return {
    concept,
    explanation: why.join("\n"),
    rule: [...new Set(rule)].join("\n"),
    distractors: [...distractors].map(([key, lines]) => ({ key, whyWrong: flatten(lines.join(" ")) })),
    lecture,
  };
}

function answerSignals(pages: Page[], options: QuestionRecord["options"]): Array<{ key: string; evidence: string; page: number }> {
  const signals: Array<{ key: string; evidence: string; page: number }> = [];
  for (const page of pages) {
    const lines = contentLines(page);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      const direct = line.match(/\b(?:correct\s+)?answer\s*[:\-]?\s+([A-H])(?:[.)·:]|\s*$)/i);
      const heading = headerPattern("ANSWER").test(line);
      const next = heading ? lines.slice(index + 1).find((value) => value.trim())?.trim().match(/^([A-Ha-h])\s*[·.)]\s+(.+)$/) : undefined;
      const key = (direct?.[1] ?? next?.[1])?.toUpperCase();
      if (key && options.some((option) => option.key === key)) signals.push({ key, evidence: next ? `${line}\n${lines[index + 1]}` : line, page: page.number });
    }
  }
  return signals;
}

export function parseReviewPacket(input: ReviewPacketInput): ReviewPacketResult {
  const now = input.now instanceof Date ? input.now.toISOString() : input.now ?? new Date().toISOString();
  const pages = input.pages.map((raw, index) => cleanPage(raw, index + 1));
  const sparsePages = pages.filter((page) => page.raw.trim().length < SPARSE_CHARACTERS).map((page) => page.number);
  const knownSlides = /(?:JD_DM_MSA|MSA_Term1_FTM2|FTM1_Presenter|ER_Presenter|MADCOW)/i.test(input.fileName);
  const groups: Group[] = [];
  let current: Group | undefined;
  for (const page of pages) {
    const labelled = page.label !== undefined || /^\s*(?:QUESTION(?:\s+\d+)?|\d+[.)]\s+\S)/im.test(page.text);
    const draft = knownSlides || labelled ? questionDraft(page) : undefined;
    if (draft && page.role !== "answer") {
      if (current && signature(current.draft) === signature(draft)) current.pages.push(page);
      else {
        current = { draft, question: page, pages: [page] };
        groups.push(current);
      }
    } else if (current && (page.label === undefined || page.label === current.question.label)) {
      current.pages.push(page);
    } else if (!draft && page.label !== undefined && current?.question.label !== page.label) current = undefined;
  }
  // Text-only, explicitly labelled records retain the battle-tested generic importer.
  if (!groups.length) {
    for (const page of pages) {
      if (!/^\s*(?:Question\s*[:#-]?\s*\d+|\d+[.)]\s+\S)/im.test(page.text)) continue;
      for (const draft of parseQuestionBlocks(page.text)) {
        if (draft.stem && draft.options.length >= 2) groups.push({ draft, question: page, pages: [page] });
      }
    }
  }
  const questions: QuestionRecord[] = [];
  const analyses: QuestionAnalysis[] = [];
  const used = new Set<number>();
  for (const [index, group] of groups.entries()) {
    const teaching = teachingFrom(group.pages);
    const signals = answerSignals(group.pages, group.draft.options);
    if (group.draft.correctKey) signals.push({ key: group.draft.correctKey, evidence: group.draft.answerEvidence ?? "", page: group.question.number });
    const keys = new Set(signals.map((signal) => signal.key));
    const correctKey = keys.size === 1 ? [...keys][0] : undefined;
    const evidence = correctKey ? signals.find((signal) => signal.key === correctKey) : undefined;
    const explanation = teaching.explanation || group.draft.explanation;
    const id = `review-${stableHash(`${input.checksum}:${input.documentId}:${group.question.number}:${index}:${signature(group.draft)}`)}`;
    const teachingPage = group.pages.find((page) => page.role === "teaching");
    const warnings = [...group.draft.warnings.filter((warning) => !correctKey || !/answer|key/i.test(warning))];
    if (!correctKey) warnings.push(keys.size > 1 ? "Conflicting source answer keys. Review the original pages." : "No explicit text answer key. A highlighted choice or image has not been interpreted.");
    const question: QuestionRecord = {
      id, source: "pdf", stem: group.draft.stem, options: group.draft.options,
      correctKey, correctAnswerText: group.draft.options.find((option) => option.key === correctKey)?.text,
      explanation,
      choiceRationales: teaching.distractors.length ? Object.fromEntries(teaching.distractors.map((item) => [item.key, item.whyWrong])) : group.draft.choiceRationales,
      needsReview: !correctKey, status: "unseen", module: input.module, bank: input.title,
      sourceDocumentId: input.documentId, questionNumber: group.draft.questionNumber,
      sourcePage: group.question.number, tags: [], attempts: [], createdAt: now, updatedAt: now,
      citation: `${input.title}, page ${group.question.number}`,
      extraction: {
        confidence: correctKey ? "medium" : "low", reviewed: false,
        questionDetectionConfidence: 0.9, answerDetectionConfidence: correctKey ? 0.9 : 0,
        explanationDetectionConfidence: explanation ? 0.75 : 0,
        overallImportConfidence: correctKey ? 0.8 : 0.4,
        warnings, parserRuleIds: ["review.page-boundary", "review.explicit-answer-only", ...(group.draft.parserRuleIds ?? [])],
        questionSourceSnippet: group.question.raw, questionSourcePage: group.question.number,
        answerEvidence: evidence?.evidence, answerEvidenceSnippet: evidence?.evidence, answerEvidencePage: evidence?.page,
        explanationSourceSnippet: teachingPage?.raw ?? group.draft.explanationSourceSnippet,
        explanationSourcePage: teachingPage?.number, explanationSource: explanation ? "inline" : undefined,
      },
    };
    questions.push(question);
    // Preserve slide references even when a page has no usable text; no invented visual description.
    const references: SourceTrace[] = group.pages.map((page) => ({
      documentId: input.documentId, page: page.number, quote: page.raw,
      role: page === group.question ? "question" : page.role ?? "slide",
    }));
    group.pages.forEach((page) => used.add(page.number));
    if (explanation || teaching.rule || teaching.distractors.length) analyses.push({
      id: `analysis-${id}`, questionId: id, sourceFingerprint: input.checksum, version: 1, origin: "source",
      concept: teaching.concept || group.draft.topic || `Question ${group.draft.questionNumber ?? index + 1}`,
      task: "", rule: teaching.rule, explanation: explanation ?? "", decisiveClues: [], mechanism: [],
      distractors: teaching.distractors, lecture: teaching.lecture,
      sourcePages: group.pages.map((page) => page.number), references, status: "proposed", generatedAt: now,
    });
  }
  const warnings = ["Imported text and answer mappings need confirmation against the source. Images, highlighted answers and multi-column layouts may require review."];
  if (sparsePages.length) warnings.push(`${sparsePages.length} of ${pages.length} pages have fewer than ${SPARSE_CHARACTERS} extracted characters. Visual questions and diagrams may remain source-only; OCR has not run.`);
  if (!questions.length) warnings.push("No reliable labelled question blocks found. This document remains a source pack.");
  const unresolved = questions.filter((question) => !question.correctKey).length;
  if (unresolved) warnings.push(`${unresolved} questions have no unambiguous text answer key.`);
  return {
    questions, analyses, warnings, sparsePages,
    sourceOnlyPages: pages.filter((page) => !used.has(page.number) || page.raw.trim().length < SPARSE_CHARACTERS).map((page) => page.number),
    pageCount: pages.length, extractedPageCount: pages.length - sparsePages.length,
    format: questions.length ? knownSlides || pages.some((page) => page.label !== undefined) ? "review-slides" : "labelled-questions" : "source-only",
  };
}
