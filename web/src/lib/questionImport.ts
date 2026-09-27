// ===========================================================================
// File-based question import (pre-beta directive §5A). TXT/Markdown reuse the
// multi-question paste parser; CSV maps common column names; JSON accepts an
// array of question-shaped objects. PDF/images remain provenance-only — no
// fake OCR. Every path produces drafts for the review screen; nothing saves
// without user approval.
// ===========================================================================
import { parseQuestionBlocks, type ParsedQuestionDraft } from "./questionParse";
import type { QuestionOption } from "./questions";
import { sanitizeExplanationCandidate } from "./questionExplanation";

export type ImportFormat = "text" | "csv" | "json" | "pdf" | "docx" | "image" | "unsupported";

export interface ImportResult {
  drafts: ParsedQuestionDraft[];
  warnings: string[];
  format: ImportFormat;
}

export type AnswerResolution =
  | {
      status: "resolved";
      candidateKey: string;
      confidence: "high";
      needsReview: false;
      ruleId: string;
      evidence: string;
    }
  | {
      status: "candidate";
      candidateKey: string;
      confidence: "medium" | "low";
      needsReview: true;
      ruleId: string;
      evidence: string;
      warning: string;
    }
  | {
      status: "conflict";
      candidateKey?: undefined;
      confidence: "low";
      needsReview: true;
      ruleId: string;
      evidence: string;
      conflictingKey?: string;
      warning: string;
    }
  | {
      status: "unresolved";
      candidateKey?: undefined;
      confidence: "low";
      needsReview: true;
      ruleId: string;
      evidence?: string;
      warning?: string;
    };

export function detectImportFormat(fileName: string, mimeType: string): ImportFormat {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown") || mimeType.startsWith("text/")) return "text";
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType.startsWith("image/")) return "image";
  return "unsupported";
}

export function importFromText(text: string): ImportResult {
  const drafts = parseQuestionBlocks(text);
  const warnings: string[] = [];
  if (drafts.length === 0) warnings.push("No questions detected in this file. Check the format (numbered stems, A./B./C. options).");
  return { drafts, warnings, format: "text" };
}

// --- CSV -------------------------------------------------------------------

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n") {
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const CSV_STEM_KEYS = ["stem", "question", "question text", "prompt"];
const CSV_ANSWER_KEYS = ["answer", "correct", "correct answer", "key"];
const CSV_EXPLANATION_KEYS = ["explanation", "rationale", "why"];

export function importFromCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  if (rows.length < 2) {
    return { drafts: [], warnings: ["CSV needs a header row plus at least one question row."], format: "csv" };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (keys: string[]) => header.findIndex((h) => keys.includes(h));
  const stemCol = col(CSV_STEM_KEYS);
  if (stemCol === -1) {
    return {
      drafts: [],
      warnings: [`No stem column found. Use a header like "question" or "stem". Found: ${header.join(", ")}.`],
      format: "csv",
    };
  }
  const answerCol = col(CSV_ANSWER_KEYS);
  const explanationCol = col(CSV_EXPLANATION_KEYS);
  const topicCol = col(["topic"]);
  const systemCol = col(["system"]);
  const categoryCol = col(["category", "subject"]);
  const sourceCol = col(["source"]);
  // Option columns: single letters (a,b,c…) or "option a"/"choice a"/"option1".
  const optionCols: Array<{ index: number; key: string }> = [];
  header.forEach((h, i) => {
    const single = h.match(/^([a-h])$/);
    const worded = h.match(/^(?:option|choice)\s*_?([a-h1-8])$/);
    const letter = single?.[1] ?? worded?.[1];
    if (!letter) return;
    const key = /\d/.test(letter) ? String.fromCharCode(64 + Number(letter)) : letter.toUpperCase();
    optionCols.push({ index: i, key });
  });
  if (optionCols.length === 0) warnings.push("No option columns detected (a, b, c… or option A…). Questions import stem-only.");

  const drafts: ParsedQuestionDraft[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const stem = (cells[stemCol] ?? "").trim();
    if (!stem) { warnings.push(`Row ${r + 1}: empty stem — skipped.`); continue; }
    const options: QuestionOption[] = optionCols
      .map(({ index, key }) => ({ key, text: (cells[index] ?? "").trim() }))
      .filter((o) => o.text);
    const answerValue = answerCol >= 0 ? (cells[answerCol] ?? "").trim() : undefined;
    const answerResolution = resolveStructuredAnswer(answerValue, options);
    const rowWarnings: string[] = "warning" in answerResolution && answerResolution.warning ? [answerResolution.warning] : [];
    drafts.push(withStructuredDiagnostics({
      questionNumber: r,
      stem,
      options,
      correctKey: answerResolution.candidateKey,
      answerEvidence: answerValue,
      answerEvidenceSnippet: answerValue,
      explanation: explanationCol >= 0 ? (cells[explanationCol] ?? "").trim() || undefined : undefined,
      topic: topicCol >= 0 ? (cells[topicCol] ?? "").trim() || undefined : undefined,
      system: systemCol >= 0 ? (cells[systemCol] ?? "").trim() || undefined : undefined,
      category: categoryCol >= 0 ? (cells[categoryCol] ?? "").trim() || undefined : undefined,
      sourceLabel: sourceCol >= 0 ? (cells[sourceCol] ?? "").trim() || undefined : undefined,
      confidence: "medium",
      warnings: rowWarnings,
    }, answerResolution));
  }
  return { drafts, warnings, format: "csv" };
}

// --- JSON ------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function importFromJson(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { drafts: [], warnings: ["Not valid JSON."], format: "json" };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : null;
  if (!list) {
    return { drafts: [], warnings: ["Expected a JSON array of questions or { questions: [...] }."], format: "json" };
  }
  const drafts: ParsedQuestionDraft[] = [];
  const warnings: string[] = [];
  list.forEach((item, i) => {
    if (!isRecord(item)) { warnings.push(`Item ${i + 1} is not an object — skipped.`); return; }
    const stem = str(item.stem) ?? str(item.question);
    if (!stem) { warnings.push(`Item ${i + 1} has no stem/question — skipped.`); return; }
    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options: QuestionOption[] = rawOptions
      .map((o, j) => {
        if (typeof o === "string") return { key: String.fromCharCode(65 + j), text: o.trim() };
        if (isRecord(o) && str(o.text)) return { key: (str(o.key) ?? String.fromCharCode(65 + j)).toUpperCase(), text: str(o.text)! };
        return null;
      })
      .filter((o): o is QuestionOption => o !== null && !!o.text);
    const answerValue = str(item.correctKey) ?? str(item.answer);
    const answerResolution = resolveStructuredAnswer(answerValue, options);
    const rowWarnings: string[] = "warning" in answerResolution && answerResolution.warning ? [answerResolution.warning] : [];
    drafts.push(withStructuredDiagnostics({
      questionNumber: i + 1,
      stem,
      options,
      correctKey: answerResolution.candidateKey,
      answerEvidence: answerValue,
      answerEvidenceSnippet: answerValue,
      explanation: str(item.explanation),
      topic: str(item.topic),
      system: str(item.system),
      category: str(item.category) ?? str(item.subject),
      sourceLabel: str(item.source),
      tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : undefined,
      confidence: "medium",
      warnings: rowWarnings,
    }, answerResolution));
  });
  return { drafts, warnings, format: "json" };
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\(?[a-h]\)?[).:\-–]\s*/i, "")
    .replace(/\s*([+/%])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/g, "")
    .trim();
}

/** Deterministic answer evidence resolution shared by structured CSV + JSON. */
export function resolveStructuredAnswer(value: string | undefined, options: QuestionOption[]): AnswerResolution {
  const evidence = value?.trim();
  if (!evidence) return {
    status: "unresolved", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "answer.structured-missing",
  };
  const raw = evidence.replace(/^(?:the\s+)?(?:correct\s+)?answer\s*(?:is)?\s*[:\-–]?\s*/i, "").trim();
  const keyOnly = raw.match(/^\(\s*([A-Ha-h])\s*\)$|^([A-Ha-h])$/);
  if (keyOnly) return resolveExplicitStructuredAnswer(keyOnly[1] ?? keyOnly[2], "", evidence, options);

  // Punctuation is explicit letter evidence and must be adjudicated before
  // considering full-text remapping.
  const labeled = raw.match(/^\(?\s*([A-Ha-h])\s*\)?\s*[).:\-–—]\s*(.*)$/);
  if (labeled) return resolveExplicitStructuredAnswer(labeled[1], labeled[2], evidence, options);

  // Full-text equality precedes unpunctuated letter parsing so option text such
  // as "B lymphocytes" is not mistaken for key B plus a tail.
  const fullTextMatches = options.filter((option) => comparable(option.text) === comparable(raw));
  if (fullTextMatches.length === 1
    && options.filter((option) => option.key === fullTextMatches[0].key).length === 1) {
    return {
      status: "resolved", candidateKey: fullTextMatches[0].key, confidence: "high",
      needsReview: false, ruleId: "answer.structured-unique-text", evidence,
    };
  }
  if (fullTextMatches.length > 1) return {
    status: "unresolved", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "answer.structured-ambiguous-text", evidence,
    warning: `Answer text matches multiple options (${fullTextMatches.map((option) => option.key).join(", ")}) — left unset for review.`,
  };

  const letterWithTail = raw.match(/^\(?([A-Ha-h])\)?\s+(.+)$/);
  if (letterWithTail) return resolveExplicitStructuredAnswer(letterWithTail[1], letterWithTail[2], evidence, options);
  if (/^[A-Za-z]$/.test(raw)) return {
    status: "unresolved", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "answer.structured-invalid-key", evidence,
    warning: `Explicit answer key "${raw.toUpperCase()}" doesn't match an option exactly once — left unset for review.`,
  };
  return {
    status: "unresolved", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "answer.structured-unresolved", evidence,
    warning: `Answer "${evidence}" has no unique matching option — left unset for review.`,
  };
}

function resolveExplicitStructuredAnswer(
  rawKey: string,
  rawTail: string,
  evidence: string,
  options: QuestionOption[],
): AnswerResolution {
  const key = rawKey.toUpperCase();
  const matchingOptions = options.filter((option) => option.key === key);
  if (matchingOptions.length !== 1) return {
    status: "unresolved", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "answer.structured-invalid-key", evidence,
    warning: `Explicit answer key "${key}" doesn't match an option exactly once — left unset for review.`,
  };
  const tail = rawTail.trim();
  if (!tail) return {
    status: "resolved", candidateKey: key, confidence: "high", needsReview: false,
    ruleId: "answer.structured-explicit-letter", evidence,
  };
  if (/^(?:because|since|as\b|due\s+to\b)/i.test(tail)) return {
    status: "resolved", candidateKey: key, confidence: "high", needsReview: false,
    ruleId: "answer.structured-explicit-letter-rationale", evidence,
  };
  const ownText = comparable(matchingOptions[0].text);
  const tailText = comparable(tail);
  if (tailText === ownText) return {
    status: "resolved", candidateKey: key, confidence: "high", needsReview: false,
    ruleId: "answer.structured-explicit-letter-exact", evidence,
  };
  const conflicting = options.filter((option) => option.key !== key && comparable(option.text) === tailText);
  if (conflicting.length === 1) return {
    status: "conflict", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "conflict.answer-letter-vs-text", evidence, conflictingKey: conflicting[0].key,
    warning: `Conflicting answer letter/text detected (letter ${key} vs text of option ${conflicting[0].key}) — left unset for review.`,
  };
  if (conflicting.length > 1) return {
    status: "conflict", candidateKey: undefined, confidence: "low", needsReview: true,
    ruleId: "conflict.answer-letter-vs-text", evidence,
    warning: `Conflicting answer letter/text detected (letter ${key} vs text shared by options ${conflicting.map((option) => option.key).join(", ")}) — left unset for review.`,
  };
  return {
    status: "candidate", candidateKey: key, confidence: "medium", needsReview: true,
    ruleId: "answer.explicit-letter-text-drift", evidence,
    warning: `Explicit answer letter ${key} was preserved, but its trailing text does not exactly match an option — confirm before practice.`,
  };
}

/** Compatibility helper for callers that need only the preserved candidate. */
export function resolveAnswerValue(value: string | undefined, options: QuestionOption[]): string | undefined {
  return resolveStructuredAnswer(value, options).candidateKey;
}

function withStructuredDiagnostics(draft: ParsedQuestionDraft, resolution: AnswerResolution): ParsedQuestionDraft {
  const optionKeys = draft.options.map((option) => option.key);
  const duplicateKeys = new Set(optionKeys).size !== optionKeys.length;
  const expectedKeys = optionKeys.map((_, index) => String.fromCharCode(65 + index));
  const nonSequentialKeys = !duplicateKeys && optionKeys.some((key, index) => key !== expectedKeys[index]);
  const structuralWarnings = [
    ...draft.warnings,
    ...(duplicateKeys ? ["Duplicate option letters detected — the answer was left unset for review."] : []),
    ...(nonSequentialKeys ? ["Option letters are missing or out of sequence — review the extracted choices."] : []),
  ];
  const correctKey = duplicateKeys ? undefined : draft.correctKey;
  const diagnosticDraft = { ...draft, correctKey, warnings: structuralWarnings };
  const explanationCleanup = sanitizeExplanationCandidate(draft.explanation, diagnosticDraft);
  const explanation = explanationCleanup.cleanedText || undefined;
  const explanationBoundaryAmbiguous = explanationCleanup.cleanupOperations.includes("stop-at-next-question");
  if (explanationBoundaryAmbiguous) {
    structuralWarnings.push("Question-like numbered content touched this explanation without a clear separator — verify the boundary against the source.");
  }
  const questionDetectionConfidence = draft.stem && draft.options.length >= 3 ? 0.96 : draft.stem ? 0.6 : 0.1;
  const answerDetectionConfidence = duplicateKeys ? 0.05
    : resolution.status === "resolved" ? 0.98
      : resolution.status === "candidate" ? 0.65
        : resolution.status === "conflict" ? 0.05 : 0;
  const explanationDetectionConfidence = explanation
    ? explanationBoundaryAmbiguous ? Math.min(explanationCleanup.confidence, 0.6) : 0.94
    : 0;
  const overallImportConfidence = Math.max(0, Math.min(1,
    questionDetectionConfidence * 0.4 + answerDetectionConfidence * 0.4 + explanationDetectionConfidence * 0.2));
  const needsReview = resolution.needsReview || !correctKey || questionDetectionConfidence < 0.75
    || structuralWarnings.length > 0 || explanationBoundaryAmbiguous;
  return {
    ...draft,
    correctKey,
    warnings: structuralWarnings,
    explanation,
    correctAnswerText: correctKey ? draft.options.find((option) => option.key === correctKey)?.text : undefined,
    needsReview: needsReview || undefined,
    questionDetectionConfidence,
    answerDetectionConfidence,
    explanationDetectionConfidence,
    overallImportConfidence,
    confidence: overallImportConfidence >= 0.85 && !needsReview ? "high" : overallImportConfidence >= 0.6 ? "medium" : "low",
    parserRuleIds: [
      "import.structured-record",
      ...(correctKey ? ["answer.structured-value"] : []),
      ...(duplicateKeys ? ["conflict.duplicate-option-key"] : []),
      ...(nonSequentialKeys ? ["options.nonsequential"] : []),
      ...(explanation ? ["explanation.structured-field"] : []),
      ...(explanationBoundaryAmbiguous ? ["explanation.ambiguous-boundary"] : []),
      resolution.ruleId,
    ],
    sourceSnippet: [draft.stem, ...draft.options.map((option) => `${option.key}. ${option.text}`)].join("\n").slice(0, 800),
    questionSourceSnippet: draft.questionSourceSnippet
      ?? [draft.stem, ...draft.options.map((option) => `${option.key}. ${option.text}`)].join("\n").slice(0, 800),
    answerEvidenceSnippet: draft.answerEvidenceSnippet ?? draft.answerEvidence,
    explanationSourceSnippet: draft.explanationSourceSnippet ?? explanation,
    explanationSource: explanation ? (draft.explanationSource ?? "inline") : undefined,
    explanationRawCandidate: draft.explanationRawCandidate ?? (draft.explanation || undefined),
    explanationCleanupOperations: draft.explanationCleanupOperations
      ?? (explanationCleanup.cleanupOperations.length ? explanationCleanup.cleanupOperations : undefined),
  };
}
