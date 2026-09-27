// Deterministic cleanup for imported question explanations. This is deliberately
// source-preserving: it removes structural duplication and metadata, but never
// rewrites medical content or invents an answer.

export interface ExplanationQuestionContext {
  stem: string;
  options: Array<{ key: string; text: string }>;
  correctKey?: string;
}

export type ExplanationCleanupOperation =
  | "normalize-source"
  | "start-at-explanation-marker"
  | "remove-explanation-label"
  | "remove-question-stem"
  | "remove-option-duplication"
  | "remove-answer-line"
  | "extract-answer-rationale"
  | "remove-objective-metadata"
  | "remove-source-metadata"
  | "stop-at-answer-key"
  | "stop-at-next-question"
  | "ambiguous-question-boundary"
  | "remove-duplicate-line";

export interface ExplanationCleanupResult {
  /** Exact candidate handed to the deterministic cleaner. */
  rawCandidate: string;
  /** Source-authored teaching prose after structural cleanup. */
  cleanedText: string;
  /** Stable audit trail; operations describe removals without hiding the raw candidate. */
  cleanupOperations: ExplanationCleanupOperation[];
  /** Confidence that the remaining text is explanation prose, not confidence in its claims. */
  confidence: number;
}

// "Reasoning" is intentionally line-leading only. Treating it as a generic
// mid-line marker truncates legitimate prose such as "Clinical reasoning: …".
// A supported heading may also appear alone on a line without punctuation.
const EXPLANATION_MARKER_RE = /(?:(?:^|\n)[ \t]*(?:correct\s+feedback|feedback|answer\s+explanation|explanation|rationale|reasoning|discussion|teaching\s+point|key\s+concept|why)[ \t]*[:\-–][ \t]*|(?:^|\n)[ \t]*(?:correct\s+feedback|feedback|answer\s+explanation|explanation|rationale|reasoning|discussion|teaching\s+point|key\s+concept|why)[ \t]*(?=\n|$)|(?:^|[ \t])(?:correct\s+feedback|feedback|answer\s+explanation|explanation|rationale|discussion|teaching\s+point|key\s+concept|why)[ \t]*[:\-–][ \t]*)/i;
const OBJECTIVE_LINE_RE = /^\s*(?:objectives?|learning\s+objectives?|this\s+question\s+addresses\s+objectives?)\s*[:\-–]/i;
const SOURCE_LINE_RE = /^\s*(?:source|references?|citation)\s*[:\-–]/i;
const OPTION_LINE_RE = /^\s*\(?([A-H])\)?[).:\-–]\s*(.*)$/i;
const ANSWER_LINE_RE = /^\s*(?:(?:the\s+)?(?:correct|right)\s+(?:answer|option|choice)|(?:correct\s+)?ans(?:wer)?|correct|key|solution)\s*(?:is)?\s*[:\-–]?\s*(.*)$/i;
const ANSWER_KEY_HEADER_RE = /^\s*(?:answer\s*key|answers?|solutions?)\s*[:\-–]?\s*$/i;
const NUMBERED_LINE_RE = /^\s*(?:q(?:uestion)?\s*)?\d{1,4}\s*[).:\-–]\s*\S/i;
const STRICT_KEY_LINE_RE = /^\s*(?:q(?:uestion)?\s*)?\d{1,4}\s*[).:\-–]?\s*\(?[A-H]\)?\s*[.,;:]?\s*$/i;

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/g, "")
    .trim();
}

function answerRationale(line: string): string | undefined {
  const match = line.match(ANSWER_LINE_RE);
  if (!match) return undefined;
  const rationale = match[1].match(/\b(because|since|as a result|due to)\b[\s\S]*$/i)?.[0]?.trim();
  if (!rationale) return undefined;
  return rationale.charAt(0).toUpperCase() + rationale.slice(1);
}

function addOperation(operations: ExplanationCleanupOperation[], operation: ExplanationCleanupOperation): void {
  if (!operations.includes(operation)) operations.push(operation);
}

/** A numbered line is a new question only when nearby sequential options support it. */
function startsQuestion(lines: string[], index: number): { ambiguous: boolean } | undefined {
  if (!NUMBERED_LINE_RE.test(lines[index] ?? "")) return undefined;
  const strongLabel = /^\s*(?:q(?:uestion)?)\s*\d{1,4}\b/i.test(lines[index] ?? "");
  const separated = index > 0 && !(lines[index - 1] ?? "").trim();
  const optionKeys: string[] = [];
  for (let cursor = index + 1; cursor < lines.length && cursor <= index + 12; cursor += 1) {
    if (NUMBERED_LINE_RE.test(lines[cursor] ?? "")) break;
    const option = lines[cursor]?.match(OPTION_LINE_RE);
    if (option) optionKeys.push(option[1].toUpperCase());
    if (optionKeys.includes("A") && optionKeys.includes("B")) {
      return { ambiguous: !strongLabel && !separated };
    }
  }
  return undefined;
}

/**
 * Sanitize a raw explanation candidate and retain an inspectable cleanup ledger.
 * Structural boundaries are conservative: a numbered teaching list remains
 * prose unless nearby A/B options prove that a new question began.
 */
export function sanitizeExplanationCandidate(
  rawExplanation: string | null | undefined,
  question: ExplanationQuestionContext,
): ExplanationCleanupResult {
  const rawCandidate = rawExplanation ?? "";
  const operations: ExplanationCleanupOperation[] = [];
  if (!rawCandidate.trim()) return { rawCandidate, cleanedText: "", cleanupOperations: operations, confidence: 0 };

  let source = rawCandidate
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .trim();
  if (source !== rawCandidate) addOperation(operations, "normalize-source");

  // When a full extracted question was accidentally stored as its explanation,
  // the first real explanation marker is the safest boundary. The marker may be
  // glued to an option ("E. foo Correct Feedback: ...").
  const marker = source.match(EXPLANATION_MARKER_RE);
  const explicitMarker = Boolean(marker);
  if (marker?.index !== undefined && marker.index > 0) {
    source = source.slice(marker.index).trimStart();
    addOperation(operations, "start-at-explanation-marker");
  }

  const stem = comparable(question.stem);
  const options = new Map(question.options.map((option) => [option.key.toUpperCase(), comparable(option.text)]));
  const kept: string[] = [];
  const lines = source.split("\n");
  let metadataFlow: "objective" | "source" | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    if (!line) {
      metadataFlow = undefined;
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }

    if (ANSWER_KEY_HEADER_RE.test(line) || STRICT_KEY_LINE_RE.test(line) && kept.length > 0) {
      addOperation(operations, "stop-at-answer-key");
      break;
    }
    const questionBoundary = startsQuestion(lines, index);
    if (questionBoundary) {
      addOperation(operations, "stop-at-next-question");
      if (questionBoundary.ambiguous) addOperation(operations, "ambiguous-question-boundary");
      break;
    }

    const inlineMarker = line.match(EXPLANATION_MARKER_RE);
    if (inlineMarker?.index !== undefined) {
      line = line.slice(inlineMarker.index + inlineMarker[0].length).trim();
      metadataFlow = undefined;
      addOperation(operations, "remove-explanation-label");
      if (!line) continue;
    }

    if (OBJECTIVE_LINE_RE.test(line)) {
      metadataFlow = "objective";
      addOperation(operations, "remove-objective-metadata");
      continue;
    }
    if (SOURCE_LINE_RE.test(line)) {
      metadataFlow = "source";
      addOperation(operations, "remove-source-metadata");
      continue;
    }
    if (metadataFlow) {
      addOperation(operations, metadataFlow === "objective" ? "remove-objective-metadata" : "remove-source-metadata");
      continue;
    }

    const numberedStem = line.replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,4}\s*[).:\-–]?\s*/i, "");
    if (stem && comparable(numberedStem) === stem) {
      addOperation(operations, "remove-question-stem");
      continue;
    }

    const option = line.match(OPTION_LINE_RE);
    if (option) {
      const expected = options.get(option[1].toUpperCase());
      if (expected && comparable(option[2]) === expected) {
        addOperation(operations, "remove-option-duplication");
        continue;
      }
    }

    const answerLine = line.match(ANSWER_LINE_RE);
    if (answerLine) {
      const explicitKeyPayload = /^\(?[A-H]\)?(?:\s*$|\s*[).:\-–—]\s*)/i.test(answerLine[1].trim());
      // Inside an explicitly labelled explanation, an Answer:-prefixed prose
      // sentence is part of the authored rationale. Only a key-shaped payload
      // is structural answer metadata that should be removed.
      if (explicitMarker && !explicitKeyPayload) {
        kept.push(line);
        continue;
      }
      const rationale = answerRationale(line);
      if (rationale) {
        kept.push(rationale);
        addOperation(operations, "extract-answer-rationale");
      } else {
        addOperation(operations, "remove-answer-line");
      }
      continue;
    }

    // Remove exact duplicate consecutive prose introduced by extraction/page
    // joins without collapsing meaningful repeated words inside a paragraph.
    if (kept.length && comparable(kept[kept.length - 1]) === comparable(line)) {
      addOperation(operations, "remove-duplicate-line");
      continue;
    }
    kept.push(line);
  }

  while (kept[0] === "") kept.shift();
  while (kept[kept.length - 1] === "") kept.pop();
  const cleanedText = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleanedText) return { rawCandidate, cleanedText, cleanupOperations: operations, confidence: 0 };

  let confidence = explicitMarker ? 0.95 : 0.78;
  if (operations.includes("extract-answer-rationale") && !explicitMarker) confidence = Math.max(confidence, 0.84);
  if (operations.includes("stop-at-next-question") || operations.includes("stop-at-answer-key")) {
    confidence = Math.min(confidence, explicitMarker ? 0.92 : 0.74);
  }
  if (operations.includes("ambiguous-question-boundary")) confidence = Math.min(confidence, 0.6);
  return { rawCandidate, cleanedText, cleanupOperations: operations, confidence };
}

/** Backwards-compatible text-only projection used by structured imports and UI edits. */
export function cleanExplanationText(
  rawExplanation: string | null | undefined,
  question: ExplanationQuestionContext,
): string {
  return sanitizeExplanationCandidate(rawExplanation, question).cleanedText;
}
