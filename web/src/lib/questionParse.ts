// ===========================================================================
// Question parser — layered extraction (rehaul phase 3):
//   L1 question detection (numbered stems + options)
//   L2 answer-key detection (trailing keys, inline keys, compressed keys)
//   L3 explanation detection (inline blocks + "Answers and Explanations"
//      sections mapped back by question number)
//   L4 choice-rationale detection ("A is incorrect because…")
//   L5 conflict detection (key says C, explanation prose says B → flag,
//      unset, require review)
//   L6 confidence scoring (high only when number/options/answer/explanation
//      align)
// The parser never invents answers or explanations. Anything uncertain is
// left blank with a visible warning and a needs-review flag.
// ===========================================================================
import type { ExtractionConfidence, QuestionOption } from "./questions";
import {
  sanitizeExplanationCandidate,
  type ExplanationCleanupOperation,
} from "./questionExplanation";

export interface ParsedQuestionDraft {
  stem: string;
  options: QuestionOption[];
  correctKey?: string;
  /** Canonical display text derived from correctKey + options (never invented). */
  correctAnswerText?: string;
  /** Verbatim source line(s) that supported the answer mapping. */
  answerEvidence?: string;
  explanation?: string;
  /** Per-choice rationales ("A is incorrect because…"), keyed by letter. */
  choiceRationales?: Record<string, string>;
  /** Where the explanation came from — inline block or a trailing section. */
  explanationSource?: "inline" | "answer-section";
  /** Metadata lines detected in the block ("Topic:", "Source:", …). */
  topic?: string;
  system?: string;
  sourceLabel?: string;
  /** Kept separate from explanation so quiz feedback stays focused. */
  objective?: string;
  reference?: string;
  category?: string;
  tags?: string[];
  /** The document's own question number, when present ("12." → 12). */
  questionNumber?: number;
  /** Page in the source document this question came from (PDF imports). */
  sourcePage?: number;
  /** Bounded evidence excerpt from the exact source block used by the parser. */
  sourceSnippet?: string;
  /** Question-only provenance. Kept separate from answer/explanation evidence. */
  questionSourceSnippet?: string;
  questionSourcePage?: number;
  /** Exact source evidence used to select (or reject) an answer mapping. */
  answerEvidenceSnippet?: string;
  answerEvidencePage?: number;
  /** Source-authored explanation excerpt, separate from the question block. */
  explanationSourceSnippet?: string;
  explanationSourcePage?: number;
  /** Raw candidate retained so deterministic cleanup remains auditable. */
  explanationRawCandidate?: string;
  /** Stable operations applied to the raw candidate before display. */
  explanationCleanupOperations?: ExplanationCleanupOperation[];
  /** Stable, inspectable rules that contributed to this mapping. */
  parserRuleIds?: string[];
  /** Numeric 0..1 confidence for each parser stage. */
  questionDetectionConfidence?: number;
  answerDetectionConfidence?: number;
  explanationDetectionConfidence?: number;
  overallImportConfidence?: number;
  /** Set when a conflict or serious ambiguity demands human review. */
  needsReview?: boolean;
  confidence: ExtractionConfidence;
  warnings: string[];
}

/** One entry from an "Answers / Answers & Explanations" section. */
export interface AnswerSectionEntry {
  /** "?" = conflicting entries for this number. */
  letter?: string;
  /** Answer text that must be matched against this question's options. */
  answerText?: string;
  explanation?: string;
  /** Exact numbered explanation entry, distinct from answer-key evidence. */
  explanationEvidence?: string;
  /** Exact numbered entry from the source answer section. */
  evidence?: string;
}

/** Development/test ledger for inspecting each mapping without UI coupling. */
export interface ImportMappingDiagnostic {
  questionNumber?: number;
  extractedOptions: QuestionOption[];
  answerEvidence?: string;
  selectedMapping?: string;
  confidence: number;
  conflictReason?: string;
  sourceSpans: Array<{
    kind: "question" | "answer" | "explanation";
    snippet: string;
    page?: number;
  }>;
}

/** Lines like "A. text", "B) text", "(C) text", "d - text". */
const OPTION_RE = /^\s*\(?\s*([A-Ha-h])\s*(?:\)\s*[.:\-–]?|[.:\-–])\s+(.*\S)\s*$/;
/** Feedback/explanation/objective markers that begin a NON-option content block.
 * Capturing group 1 is the marker keyword so callers can classify it. */
const EXPLANATION_RE = /^\s*(correct\s+feedback|incorrect\s+feedback|feedback|answer\s+explanation|explanation|rationale|reasoning|discussion|teaching\s+point|key\s+concept|why)\s*(?:(?:[:\-–]\s*)|$)/i;
/**
 * The SAME markers, matched mid-line so we can split feedback that got glued to
 * an answer choice ("E. Co-payment Correct Feedback: …"). Requires whitespace
 * before the marker so words like "objective assessment" inside an option don't
 * trip it. Group 1 = marker, group 2 = the feedback text after the colon. */
const INLINE_FEEDBACK_RE = /\s+((?:correct|incorrect)\s+feedback|feedback|explanation|rationale|this\s+question\s+addresses\s+objectives?|learning\s+objectives?|objectives?|teaching\s+point|key\s+concept)\s*[:\-–]\s*(.*)$/i;
/** "A is incorrect because…" / "C is correct — …" (choice rationales). */
const RATIONALE_RE = /^\s*\(?([A-Ha-h])\)?[).:\-–]?\s+is\s+(in)?correct\b[.,:;\s]*(.*)$/i;
/** Prose-embedded answer inside explanation text. */
const PROSE_ANSWER_RE = /\b(?:the\s+answer\s+is|correct\s+answer\s+is|correct\s+choice\s+is)\s*\(?([A-Ha-h])\)?(?![a-z])/i;
/** Metadata lines: "Topic: Complement", "System: Immuno", "Source: SGU NB3", "Tags: a, b". */
const META_RE = /^\s*(topic|system|source|category|subject|tags)\s*[:\-–]\s*(.+\S)\s*$/i;
const OBJECTIVE_RE = /^\s*(learning\s+objectives?|objectives?|this\s+question\s+addresses\s+objectives?)\s*[:\-–]\s*(.*)$/i;
const REFERENCE_RE = /^\s*(references?|citation)\s*[:\-–]\s*(.*)$/i;

interface AnswerSignal {
  key?: string;
  answerText?: string;
  rationale?: string;
  ruleId: string;
  evidence: string;
  payload: string;
  /** "Answer: B lymphocytes" may be text, not letter B + tail. */
  ambiguousLeadingLetter?: boolean;
}

const ANSWER_PREFIX_RE = /^\s*(?:(?:the\s+)?(?:correct\s+|right\s+)?answer|(?:correct|right)\s+(?:option|choice)|(?:correct\s+)?ans|correct|key|solution)\s*(?:is)?\s*[:\-–]?\s*(.+?)\s*$/i;

function isRationaleTail(value: string): boolean {
  return /^(?:because|since|as\b|due\s+to\b|the\s+(?:mechanism|reason|finding|clue|pathway)\b|this\b|these\b|it\b)/i.test(value.trim());
}

/** Parse explicit answer lines without confusing answer text with explanation. */
export function parseAnswerSignal(line: string): AnswerSignal | undefined {
  const match = line.match(ANSWER_PREFIX_RE);
  if (!match) return undefined;
  const payload = match[1].trim();
  const normalizedPayload = payload.replace(/^\(\s*([A-Ha-h])\s*\)/, "($1)");
  const punctuated = normalizedPayload.match(/^\(?([A-Ha-h])\)?\s*[.):\-–—]\s*(.*)$/);
  const bare = normalizedPayload.match(/^\(?([A-Ha-h])\)?\s*$/);
  const spaced = normalizedPayload.match(/^([A-Ha-h])\s+(.+)$/);
  const letter = punctuated ?? bare;
  if (!letter && spaced) {
    const key = spaced[1].toUpperCase();
    const tail = spaced[2].trim();
    // "Answer: B because ..." is an unambiguous letter plus rationale.
    if (isRationaleTail(tail)) {
      return { key, rationale: tail, ruleId: "answer.explicit-letter-rationale", evidence: line.trim(), payload };
    }
    // Otherwise the leading letter belongs to answer text until an exact,
    // unique option-text match proves otherwise. Never retain it as a key.
    return {
      answerText: payload,
      ruleId: "answer.explicit-text",
      evidence: line.trim(),
      payload,
      ambiguousLeadingLetter: true,
    };
  }
  if (!letter) return { answerText: payload, ruleId: "answer.explicit-text", evidence: line.trim(), payload };

  const key = letter[1].toUpperCase();
  const tail = (letter[2] ?? "").trim();
  if (!tail) return { key, ruleId: "answer.explicit-letter", evidence: line.trim(), payload };
  if (isRationaleTail(tail)) {
    return { key, rationale: tail, ruleId: "answer.explicit-letter-rationale", evidence: line.trim(), payload };
  }
  return {
    key,
    answerText: tail,
    ruleId: "answer.explicit-letter-text",
    evidence: line.trim(),
    payload,
    ambiguousLeadingLetter: false,
  };
}

function comparableAnswerText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^\(?[a-h]\)?[).:\-–]\s*/i, "")
    .replace(/\s*([+/%])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/g, "")
    .trim();
}

function matchAnswerText(text: string, options: QuestionOption[]): { key?: string; ambiguous: boolean } {
  const normalized = comparableAnswerText(text);
  if (!normalized) return { ambiguous: false };
  const matches = options.filter((option) => comparableAnswerText(option.text) === normalized);
  return { key: matches.length === 1 ? matches[0].key : undefined, ambiguous: matches.length > 1 };
}

function boundedConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function categoricalConfidence(value: number): ExtractionConfidence {
  return value >= 0.85 ? "high" : value >= 0.6 ? "medium" : "low";
}

function sourceSnippet(raw: string): string | undefined {
  const value = normalizeSourceText(raw).trim().replace(/\n{3,}/g, "\n\n");
  return value ? value.slice(0, 1600) : undefined;
}

/** True when a feedback marker is a "correct" signal (marks its option/choice). */
function isCorrectFeedback(marker: string): boolean {
  return /^correct\s+feedback$/i.test(marker.trim());
}
function isIncorrectFeedback(marker: string): boolean {
  return /^incorrect\s+feedback$/i.test(marker.trim());
}

/**
 * Split feedback/explanation text that was glued onto an answer choice.
 * "Co-payment Correct Feedback: Co-insurance is the term…" →
 *   { optionText: "Co-payment", marker: "Correct Feedback", feedback: "Co-insurance…" }
 * Returns just the text when no marker is present.
 */
export function splitOptionFeedback(text: string): { optionText: string; marker?: string; feedback?: string } {
  const m = text.match(INLINE_FEEDBACK_RE);
  if (!m || m.index === undefined) return { optionText: text.trim() };
  return {
    optionText: text.slice(0, m.index).trim(),
    marker: m[1].replace(/\s+/g, " ").trim(),
    feedback: m[2].trim(),
  };
}

/**
 * Normalization pre-pass — makes every downstream detector stronger for free.
 * Strips markdown bold/italic pairs, leading list bullets, smart quotes,
 * non-breaking spaces, and stray form-feed/tab noise from copied PDFs.
 */
export function normalizeSourceText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ") // nbsp variants -> space
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[ \t]*a[ \t]+n[ \t]+s[ \t]+w[ \t]+e[ \t]+r[ \t]+k[ \t]+e[ \t]+y[ \t]*[:\-–]?[ \t]*$/gim, "Answer Key:")
    .replace(/^[ \t]*e[ \t]+x[ \t]+p[ \t]+l[ \t]+a[ \t]+n[ \t]+a[ \t]+t[ \t]+i[ \t]+o[ \t]+n[ \t]*[:\-–]?[ \t]*/gim, "Explanation: ")
    .replace(/^[ \t]*q[ \t]+u[ \t]+e[ \t]+s[ \t]+t[ \t]+i[ \t]+o[ \t]+n(?=[ \t]*(?:#|:|\d))/gim, "Question")
    .replace(/^[ \t]*a[ \t]+n[ \t]+s[ \t]+w[ \t]+e[ \t]+r(?=[ \t]*[:\-–—])/gim, "Answer")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")            // **bold** → bold
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")              // Markdown headings
    .replace(/^\s*[-+]\s+(?=\(?[A-Ha-h][).:\-–]\s+)/gm, "") // Markdown option bullets
    .replace(/^[\s]*[•●▪‣◦·]\s*/gm, "")            // list bullets at line start
    .replace(/[\t\f\v]+/g, " ");
}

/** Correct-answer markers that can decorate a single option line. */
const CHECK_MARK_RE = /[✓✔☑]/;
const CORRECT_SUFFIX_RE = /\s*\(\s*(?:correct(?:\s+answer)?|right)\s*\)\s*$/i;

/**
 * Options crammed onto one line — "A. Alpha B. Beta C. Gamma D. Delta" —
 * are expanded onto separate lines so the option loop can read them.
 * Requires a run of ≥3 sequential letters starting at A to avoid mangling
 * prose that merely mentions "B. cereus".
 */
export function expandInlineOptions(line: string): string[] {
  const starts: Array<{ index: number; letter: string }> = [];
  const re = /(?:^|\s)\(?([A-Ha-h])[).:]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    starts.push({ index: m.index === 0 ? 0 : m.index + 1, letter: m[1].toUpperCase() });
  }
  if (starts.length < 3) return [line];
  const letters = starts.map((s) => s.letter).join("");
  if (!"ABCDEFGH".startsWith(letters)) return [line];
  const pieces: string[] = [];
  if (starts[0].index > 0) pieces.push(line.slice(0, starts[0].index).trim());
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : line.length;
    pieces.push(line.slice(from, to).trim());
  }
  return pieces.filter(Boolean);
}

export function parseQuestionText(raw: string): ParsedQuestionDraft {
  const warnings: string[] = [];
  const parserRuleIds = new Set<string>();
  const normalized = normalizeSourceText(raw);
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    const expanded = expandInlineOptions(line);
    if (expanded.length > 1) parserRuleIds.add("options.inline-expanded");
    lines.push(...expanded);
  }

  const stemLines: string[] = [];
  const options: QuestionOption[] = [];
  const explanationLines: string[] = [];
  const explanationCandidateLines: string[] = [];
  const objectiveLines: string[] = [];
  const referenceLines: string[] = [];
  const rationales: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const answerSignals: AnswerSignal[] = [];
  let rationaleCorrectLetter: string | undefined;
  // Layer 2: the option letter whose choice carried a "Correct Feedback" block.
  let feedbackCorrectLetter: string | undefined;
  // While collecting the tail of an inline-feedback block, continuation lines
  // append to the explanation, not to the previous option's text.
  let feedbackFlow = false;
  // Options decorated with a correct-marker (✓, leading/trailing *, "(correct)").
  const markedLetters: string[] = [];
  let phase: "stem" | "options" | "explanation" = "stem";
  let metadataFlow: "objective" | "reference" | undefined;
  let explanationMarkerDetected = false;
  let malformedNextQuestionDetected = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    // Strip a correct-marker decorating this line so the option regex can see
    // through it; remember the flag for the marker heuristic below.
    let line = rawLine;
    let lineMarked = false;
    const lead = line.match(/^\s*[*✓✔☑]\s*(\(?[A-Ha-h][).:\-–]\s.*)$/);
    if (lead) { line = lead[1]; lineMarked = true; }
    const trail = line.match(/^(\s*\(?[A-Ha-h][).:\-–]\s.*\S)\s*[*✓✔☑]\s*$/);
    if (trail) { line = trail[1]; lineMarked = true; }

    const optionMatch = line.match(OPTION_RE);
    const answerSignal = parseAnswerSignal(line);
    const explanationMatch = line.match(EXPLANATION_RE);
    const metaMatch = line.match(META_RE);
    const objectiveMatch = line.match(OBJECTIVE_RE);
    const referenceMatch = line.match(REFERENCE_RE);
    const rationaleMatch = line.match(RATIONALE_RE);

    if (metaMatch && phase !== "stem") {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      parserRuleIds.add(`metadata.${metaMatch[1].toLowerCase()}`);
      feedbackFlow = false;
      metadataFlow = undefined;
      continue;
    }
    if (objectiveMatch && phase !== "stem") {
      if (objectiveMatch[2].trim()) objectiveLines.push(objectiveMatch[2].trim());
      parserRuleIds.add("metadata.objective");
      feedbackFlow = false;
      metadataFlow = "objective";
      continue;
    }
    if (referenceMatch && phase !== "stem") {
      if (referenceMatch[2].trim()) referenceLines.push(referenceMatch[2].trim());
      parserRuleIds.add("metadata.reference");
      feedbackFlow = false;
      metadataFlow = "reference";
      continue;
    }
    // L4: choice rationales. A rationale line can look like an option line
    // ("A. is incorrect because…"), so it wins when the letter is already a
    // parsed option or we're past the options.
    if (rationaleMatch && phase !== "stem") {
      const letter = rationaleMatch[1].toUpperCase();
      const isKnownOption = options.some((o) => o.key === letter);
      if (isKnownOption || phase === "explanation") {
        rationales[letter] = rationaleMatch[3].trim() || (rationaleMatch[2] ? "Incorrect." : "Correct.");
        if (!rationaleMatch[2]) rationaleCorrectLetter = rationaleCorrectLetter ?? letter;
        parserRuleIds.add(rationaleMatch[2] ? "rationale.incorrect-choice" : "answer.choice-rationale");
        feedbackFlow = false;
        metadataFlow = undefined;
        continue;
      }
    }
    // A standalone feedback/explanation marker line → explanation. Objectives
    // and references were handled above and never contaminate this field.
    if (explanationMatch) {
      phase = "explanation";
      feedbackFlow = true;
      metadataFlow = undefined;
      explanationMarkerDetected = true;
      parserRuleIds.add(`explanation.${explanationMatch[1].toLowerCase().replace(/\s+/g, "-")}`);
      const rest = line.replace(EXPLANATION_RE, "").trim();
      explanationCandidateLines.push(line.trim());
      if (rest) explanationLines.push(rest);
      continue;
    }
    // Once an explicit explanation/rationale block has begun, prose such as
    // "Answer: the receptor is blocked" is teaching text, not a second answer
    // key. A genuinely explicit letter ("Answer: B") remains usable so sources
    // that place their key after the rationale continue to work.
    if (answerSignal && phase === "explanation" && explanationMarkerDetected && !answerSignal.key) {
      explanationLines.push(line);
      explanationCandidateLines.push(rawLine);
      feedbackFlow = true;
      metadataFlow = undefined;
      parserRuleIds.add("explanation.answer-prefixed-prose");
      continue;
    }
    if (answerSignal && phase !== "stem") {
      answerSignals.push(answerSignal);
      parserRuleIds.add(answerSignal.ruleId);
      if (answerSignal.rationale) {
        explanationLines.push(answerSignal.rationale);
        explanationCandidateLines.push(line.trim());
      }
      phase = "explanation";
      feedbackFlow = Boolean(answerSignal.rationale);
      metadataFlow = undefined;
      continue;
    }
    // A malformed bare-number stem ("2 Next stem" without punctuation) is
    // not promoted to a confident second question, but an A/B-backed boundary
    // still stops it contaminating the current explanation.
    if (phase === "explanation" && !metadataFlow
      && looksLikeMalformedNumberedQuestion(lines, lineIndex)) {
      malformedNextQuestionDetected = true;
      parserRuleIds.add("question.malformed-boundary");
      break;
    }
    // Once an explanation has begun, A.–E.-leading sentences are rationale
    // prose, not a second option list. New questions are split by the outer
    // numbered-boundary pass before this single-block parser runs.
    if (optionMatch && phase !== "explanation"
      && (phase === "options" || isLikelyFirstOption(optionMatch[1], options))) {
      phase = "options";
      const letter = optionMatch[1].toUpperCase();
      // CRITICAL FIX: strip any feedback/explanation glued to the choice so it
      // never becomes part of the option text.
      const split = splitOptionFeedback(optionMatch[2]);
      // "(correct)" suffix decorating the choice text is an answer marker.
      let optionText = split.optionText;
      if (CORRECT_SUFFIX_RE.test(optionText)) {
        optionText = optionText.replace(CORRECT_SUFFIX_RE, "").trim();
        lineMarked = true;
      }
      if (lineMarked || CHECK_MARK_RE.test(rawLine)) markedLetters.push(letter);
      options.push({ key: letter, text: optionText });
      parserRuleIds.add("options.labeled");
      if (split.feedback) {
        if (isCorrectFeedback(split.marker!)) {
          feedbackCorrectLetter = feedbackCorrectLetter ?? letter;
          explanationLines.push(split.feedback);
          explanationCandidateLines.push(rawLine.trim());
          parserRuleIds.add("answer.correct-feedback");
        } else if (isIncorrectFeedback(split.marker!)) {
          rationales[letter] = split.feedback;
          parserRuleIds.add("rationale.incorrect-feedback");
        } else {
          explanationLines.push(split.feedback);
          explanationCandidateLines.push(rawLine.trim());
        }
        explanationMarkerDetected = true;
        feedbackFlow = true; // wrapped feedback continues on following lines
      } else {
        feedbackFlow = false;
      }
      metadataFlow = undefined;
      continue;
    }
    if (phase === "stem") stemLines.push(line);
    else if (phase === "options" && line.trim()) {
      if (metadataFlow === "objective") {
        objectiveLines.push(line.trim());
        continue;
      }
      if (metadataFlow === "reference") {
        referenceLines.push(line.trim());
        continue;
      }
      // Feedback started on a prior option line — keep collecting it.
      if (feedbackFlow) {
        explanationLines.push(line.trim());
        explanationCandidateLines.push(rawLine.trim());
      } else if (PROSE_ANSWER_RE.test(line)) {
        // "The answer is C because…" directly after options starts the explanation.
        phase = "explanation";
        explanationLines.push(line.trim());
        explanationCandidateLines.push(rawLine.trim());
      } else {
        // Layer 2 by option TEXT: "Co-insurance Correct Feedback: …" (no letter).
        const textFeedback = line.match(/^(.*?\S)\s+((?:correct|incorrect)\s+feedback)\s*[:\-–]\s*(.*)$/i);
        const matchedByText = textFeedback
          ? options.find((o) => o.text.toLowerCase() === textFeedback[1].trim().toLowerCase())
          : undefined;
        if (textFeedback && matchedByText) {
          if (isCorrectFeedback(textFeedback[2])) feedbackCorrectLetter = feedbackCorrectLetter ?? matchedByText.key;
          else rationales[matchedByText.key] = textFeedback[3].trim();
          explanationLines.push(textFeedback[3].trim());
          explanationCandidateLines.push(rawLine.trim());
          parserRuleIds.add(isCorrectFeedback(textFeedback[2]) ? "answer.correct-feedback-text-match" : "rationale.incorrect-feedback");
          explanationMarkerDetected = true;
          phase = "explanation";
          feedbackFlow = true;
        } else {
          // Continuation of the previous option's wrapped text.
          const last = options[options.length - 1];
          if (last) last.text = `${last.text} ${line.trim()}`;
        }
      }
    } else if (phase === "explanation") {
      if (metadataFlow === "objective") objectiveLines.push(line.trim());
      else if (metadataFlow === "reference") referenceLines.push(line.trim());
      else {
        explanationLines.push(line);
        explanationCandidateLines.push(rawLine);
      }
    }
  }

  const stem = stemLines.join("\n").trim();
  const rawExplanation = explanationLines.join("\n").trim() || undefined;
  const explanationCandidate = explanationCandidateLines.join("\n").trim() || rawExplanation;

  let needsReview = false;
  if (malformedNextQuestionDetected) {
    warnings.push("A possible next question lacked a standard numbered delimiter — its content was not attached to this explanation.");
    needsReview = true;
  }
  if (!stem) {
    warnings.push("No question stem detected — paste the full question including the stem.");
  } else {
    parserRuleIds.add("question.stem");
  }
  if (options.length === 0) {
    warnings.push("No answer options detected. Add them manually or check the paste format (A. / B. / C.).");
  } else if (options.length < 3) {
    warnings.push(`Only ${options.length} option${options.length === 1 ? "" : "s"} detected — most exam questions have 4–5.`);
  }
  const keys = options.map((o) => o.key);
  let duplicateOptions = false;
  if (new Set(keys).size !== keys.length) {
    warnings.push("Duplicate option letters detected — review the split.");
    duplicateOptions = true;
    needsReview = true;
  }
  const expectedKeys = keys.map((_, index) => String.fromCharCode(65 + index));
  if (!duplicateOptions && keys.some((key, index) => key !== expectedKeys[index])) {
    warnings.push("Option letters are missing or out of sequence — review the extracted choices.");
    parserRuleIds.add("options.nonsequential");
    needsReview = true;
  }

  // Correct-marker heuristic: exactly ONE option decorated (✓ / * / "(correct)")
  // is an explicit signal; every option decorated means list bullets — ignore.
  const uniqueMarked = [...new Set(markedLetters)];
  const markerCorrectLetter =
    uniqueMarked.length === 1 && options.length > 1 && markedLetters.length < options.length
      ? uniqueMarked[0]
      : undefined;
  if (markerCorrectLetter) parserRuleIds.add("answer.option-marker");

  // Reconcile every explicit letter/text signal before considering weaker prose.
  const structuredKeys: string[] = [];
  let answerDetectionConfidence = 0;
  let structuredConflict = false;
  for (const signal of answerSignals) {
    let signalKey = signal.key;
    let signalAnswerText = signal.answerText;
    if (signal.ambiguousLeadingLetter) {
      const fullTextMatch = matchAnswerText(signal.payload, options);
      if (fullTextMatch.ambiguous) {
        warnings.push(`Answer text "${signal.payload}" matches more than one option — left unset, needs review.`);
        structuredConflict = true;
        needsReview = true;
      } else if (fullTextMatch.key) {
        signalKey = fullTextMatch.key;
        signalAnswerText = undefined;
        parserRuleIds.add("answer.text-option-match");
        answerDetectionConfidence = Math.max(answerDetectionConfidence, 0.96);
      }
    }
    if (signalAnswerText) {
      const textMatch = matchAnswerText(signalAnswerText, options);
      if (textMatch.ambiguous) {
        warnings.push(`Answer text "${signalAnswerText}" matches more than one option — left unset, needs review.`);
        parserRuleIds.add("ambiguous.answer-text");
        structuredConflict = true;
        needsReview = true;
      } else if (textMatch.key) {
        parserRuleIds.add("answer.text-option-match");
        answerDetectionConfidence = Math.max(answerDetectionConfidence, 0.96);
        if (signalKey && signalKey !== textMatch.key) {
          // Case 4 (true contradiction): the explicit letter and an *exact*
          // option-text match name different options. Preserve BOTH signals in
          // the evidence (letter + matched option are in the warning + answer
          // evidence) and never silently pick either — leave it unresolved.
          warnings.push(`Conflicting answer letter/text detected (letter ${signalKey} vs text of option ${textMatch.key}) — left unset, needs review.`);
          parserRuleIds.add("conflict.answer-letter-vs-text");
          structuredConflict = true;
          needsReview = true;
        } else {
          // Case 2: explicit letter with an exact matching tail (adds a granular
          // diagnostic on top of the text-match rule).
          if (signalKey) parserRuleIds.add("answer.explicit-letter-exact");
          signalKey = textMatch.key;
        }
      } else if (signalKey) {
        // Case 3 (harmless drift): an explicit answer letter whose trailing
        // text matches NO option is a paraphrase / singular / parenthetical,
        // not a contradiction. PRESERVE the explicit letter as the
        // source-selected candidate and route to inspection — never silently
        // discard it. (A true contradiction is handled just above.)
        warnings.push(`Answer letter "${signalKey}" was kept as the candidate, but its trailing text "${signalAnswerText}" did not exactly match option ${signalKey} — confirm the mapping.`);
        parserRuleIds.add("answer.explicit-letter-text-drift");
        needsReview = true;
      } else {
        warnings.push(`Answer text "${signalAnswerText}" did not exactly match an option — review the mapping.`);
        parserRuleIds.add("answer.text-no-option-match");
        needsReview = true;
      }
    }
    if (signalKey) {
      if (!keys.includes(signalKey)) {
        warnings.push(`Detected answer "${signalKey}" doesn't match any option — left unset.`);
        needsReview = true;
      } else {
        structuredKeys.push(signalKey);
        answerDetectionConfidence = Math.max(answerDetectionConfidence, signalAnswerText ? 0.98 : 0.96);
      }
    }
  }

  const proseLetter = rawExplanation?.match(PROSE_ANSWER_RE)?.[1]?.toUpperCase();
  if (proseLetter) parserRuleIds.add("answer.explanation-prose");
  const explicit = [...structuredKeys, feedbackCorrectLetter, markerCorrectLetter].filter((l): l is string => !!l);
  if (feedbackCorrectLetter) answerDetectionConfidence = Math.max(answerDetectionConfidence, 0.92);
  if (markerCorrectLetter) answerDetectionConfidence = Math.max(answerDetectionConfidence, 0.9);
  const claimed = [...explicit, proseLetter, rationaleCorrectLetter].filter((l): l is string => !!l);
  const distinct = [...new Set(claimed)];
  const distinctExplicit = [...new Set(explicit)];
  let correctKey: string | undefined;
  if (structuredConflict || distinctExplicit.length > 1) {
    // Two explicit sources disagree → real conflict, never guess.
    if (distinctExplicit.length > 1) warnings.push(`Conflicting answers detected (${distinctExplicit.join(" vs ")}) between explicit answer signals — left unset, needs review.`);
    correctKey = undefined;
    answerDetectionConfidence = 0.05;
    needsReview = true;
    parserRuleIds.add("conflict.explicit-answer");
  } else if (distinctExplicit.length === 1) {
    correctKey = distinctExplicit[0];
    // L5: an explicit answer that a prose "the answer is X" contradicts is a
    // real conflict — never guess, require review (matches the directive).
    if (proseLetter && proseLetter !== correctKey) {
      warnings.push(`Conflicting answers detected (${correctKey} vs ${proseLetter}) between the answer signal and explanation prose — left unset, needs review.`);
      correctKey = undefined;
      answerDetectionConfidence = 0.05;
      needsReview = true;
      parserRuleIds.add("conflict.answer-vs-explanation");
    } else if (rationaleCorrectLetter && rationaleCorrectLetter !== correctKey) {
      warnings.push(`Conflicting answers detected (${correctKey} vs ${rationaleCorrectLetter}) between the answer signal and a choice rationale — left unset, needs review.`);
      correctKey = undefined;
      answerDetectionConfidence = 0.05;
      needsReview = true;
      parserRuleIds.add("conflict.answer-vs-rationale");
    }
  } else if (distinct.length > 1) {
    warnings.push(`Conflicting answers detected (${distinct.join(" vs ")}) between the explanation prose and choice rationales — left unset, needs review.`);
    correctKey = undefined;
    answerDetectionConfidence = 0.05;
    needsReview = true;
    parserRuleIds.add("conflict.inferred-answer");
  } else if (distinct.length === 1) {
    correctKey = distinct[0];
    warnings.push(`Answer "${correctKey}" was inferred from explanation prose — confirm it against the source.`);
    answerDetectionConfidence = rationaleCorrectLetter ? 0.76 : 0.72;
  }

  if (correctKey && keys.length > 0 && !keys.includes(correctKey)) {
    warnings.push(`Detected answer "${correctKey}" doesn't match any option — left unset.`);
    correctKey = undefined;
    answerDetectionConfidence = 0.1;
    needsReview = true;
  }
  // L3: semantic mapping — the explanation opens by naming an option's text
  // ("Co-insurance is the term…"). Conservative: only an exact option-text
  // match at the very start, and only when nothing explicit was found.
  if (!correctKey && !needsReview && rawExplanation && options.length) {
    const semantic = matchExplanationToOption(rawExplanation, options);
    if (semantic) {
      correctKey = semantic;
      warnings.push(`Answer "${correctKey}" was inferred from the explanation naming that option — confirm it against the source.`);
      answerDetectionConfidence = 0.66;
      parserRuleIds.add("answer.explanation-text-match");
    }
  }
  if (!correctKey && !needsReview) {
    warnings.push("No correct answer was reliably detected — set it after checking the source.");
    needsReview = true;
  }

  const explanationCleanup = sanitizeExplanationCandidate(explanationCandidate, { stem, options, correctKey });
  const explanation = explanationCleanup.cleanedText || undefined;
  const explanationBoundaryAmbiguous = explanationCleanup.cleanupOperations.includes("stop-at-next-question");
  if (explanationBoundaryAmbiguous) {
    warnings.push("Question-like numbered content touched this explanation without a clear separator — verify the boundary against the source.");
    needsReview = true;
    parserRuleIds.add("explanation.ambiguous-boundary");
  }
  if (rawExplanation && !explanation) {
    warnings.push("Explanation content contained only duplicated question structure or metadata and was removed.");
  }

  const questionDetectionConfidence = boundedConfidence(malformedNextQuestionDetected ? 0.55 :
    !stem ? (options.length ? 0.25 : 0.05)
      : options.length >= 3 && !duplicateOptions ? 0.96
        : options.length === 2 && !duplicateOptions ? 0.76
          : options.length === 1 && !duplicateOptions ? 0.52
            : 0.42,
  );
  const explanationDetectionConfidence = boundedConfidence(
    explanation ? (explanationBoundaryAmbiguous
      ? Math.min(explanationCleanup.confidence, 0.6)
      : explanationMarkerDetected
      ? Math.max(0.95, explanationCleanup.confidence)
      : explanationCleanup.confidence) : 0,
  );
  let overallImportConfidence = boundedConfidence(
    questionDetectionConfidence * 0.4
      + answerDetectionConfidence * 0.4
      + explanationDetectionConfidence * 0.2,
  );
  if (needsReview && answerDetectionConfidence <= 0.1) overallImportConfidence = Math.min(overallImportConfidence, 0.49);
  else if (needsReview) overallImportConfidence = Math.min(overallImportConfidence, 0.84);
  if (correctKey && answerDetectionConfidence < 0.8) overallImportConfidence = Math.min(overallImportConfidence, 0.84);
  const confidence = categoricalConfidence(overallImportConfidence);
  const correctAnswerText = correctKey ? options.find((option) => option.key === correctKey)?.text : undefined;
  const answerEvidence = answerSignals.map((signal) => signal.evidence).filter(Boolean).join("\n")
    || (feedbackCorrectLetter ? `Correct Feedback attached to option ${feedbackCorrectLetter}` : undefined)
    || (markerCorrectLetter ? `Correct marker attached to option ${markerCorrectLetter}` : undefined);
  const questionEvidence = sourceSnippet([
    stem,
    ...options.map((option) => `${option.key}. ${option.text}`),
  ].filter(Boolean).join("\n"));

  return {
    stem,
    options,
    correctKey,
    correctAnswerText,
    answerEvidence,
    explanation,
    choiceRationales: Object.keys(rationales).length ? rationales : undefined,
    explanationSource: explanation ? "inline" : undefined,
    topic: meta.topic,
    system: meta.system,
    sourceLabel: meta.source,
    objective: objectiveLines.join("\n").trim() || undefined,
    reference: referenceLines.join("\n").trim() || undefined,
    category: meta.category ?? meta.subject,
    tags: meta.tags ? meta.tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : undefined,
    needsReview: needsReview || undefined,
    confidence,
    warnings,
    parserRuleIds: [...parserRuleIds],
    questionDetectionConfidence,
    answerDetectionConfidence: boundedConfidence(answerDetectionConfidence),
    explanationDetectionConfidence,
    overallImportConfidence,
    sourceSnippet: sourceSnippet(raw),
    questionSourceSnippet: questionEvidence,
    answerEvidenceSnippet: answerEvidence,
    explanationSourceSnippet: sourceSnippet(explanationCandidate ?? ""),
    explanationRawCandidate: explanationCandidate,
    explanationCleanupOperations: explanationCleanup.cleanupOperations.length
      ? explanationCleanup.cleanupOperations
      : undefined,
  };
}

/** Options should start at A (or the next expected letter) — otherwise a line
 * like "B) both kidneys" inside a stem shouldn't flip us into option mode. */
function isLikelyFirstOption(letter: string, existing: QuestionOption[]): boolean {
  if (existing.length > 0) return true;
  return letter.toUpperCase() === "A";
}

/**
 * L3 semantic mapping: does the explanation open by naming one option's text?
 * "Co-insurance is the term…" → the option whose text is "Co-insurance".
 * Requires the named phrase to appear at the very start followed by "is/are",
 * and to be an EXACT (case-insensitive) option-text match, so it never guesses.
 * Returns the option letter, or undefined when no single clear match exists.
 */
function matchExplanationToOption(explanation: string, options: QuestionOption[]): string | undefined {
  const opening = explanation.trim().slice(0, 120).toLowerCase();
  const matches = options.filter((o) => {
    const t = o.text.trim().toLowerCase();
    if (t.length < 3) return false;
    return opening.startsWith(`${t} is `) || opening.startsWith(`${t} are `) || opening.startsWith(`${t}, `);
  });
  // Exactly one option named at the opening → confident enough to suggest.
  return matches.length === 1 ? matches[0].key : undefined;
}

/**
 * Split a pasted block that may contain SEVERAL numbered questions
 * ("1. …", "Q2) …") into per-question drafts, then map any trailing answer /
 * explanation section back onto the questions by number. Ambiguous keys are
 * flagged, never invented.
 */
export function parseQuestionBlocks(raw: string): ParsedQuestionDraft[] {
  const { body, entries } = parseAnswerSections(normalizeSourceText(raw));
  const lines = body.split("\n");
  const protectedUnnumberedStemThrough = unnumberedNestedStemFirstOptionIndex(lines);
  const starts: QuestionBlockStart[] = [];
  const ambiguousAcceptedStarts = new Set<number>();
  let activeStartIndex: number | undefined;
  let protectedStemStartIndex: number | undefined;
  lines.forEach((line, i) => {
    if (protectedStemStartIndex !== undefined && OPTION_RE.test(line)) {
      protectedStemStartIndex = undefined;
    }
    const standard = matchQuestionStart(line);
    if (standard) {
      // A structurally valid unnumbered question can also contain a reset 1/2
      // findings list. Protect only the strongly evidenced pre-option region;
      // later numbered questions remain ordinary boundaries.
      if (protectedUnnumberedStemThrough !== undefined && i < protectedUnnumberedStemThrough) return;
      // A numbered list embedded in an already accepted pre-option stem is
      // prose, even when the list's final item can see the outer A/B choices.
      if (protectedStemStartIndex !== undefined && i > protectedStemStartIndex) return;
      const hasDirectOptions = looksLikeNumberedQuestion(lines, i);
      const ownsNestedStemList = !hasDirectOptions
        && looksLikeQuestionWithNestedNumberedStem(lines, i);
      const isIncompleteQuestion = !hasDirectOptions
        && !ownsNestedStemList
        && looksLikeIncompleteNumberedQuestion(lines, i, standard.rest);
      if (hasDirectOptions || ownsNestedStemList) {
        const ambiguous = insideActiveExplanation(lines, activeStartIndex, i)
          && !hasReliableExplanationExit(lines, i);
        starts.push({
          index: i,
          number: standard.number,
          rest: standard.rest,
          malformed: false,
          nestedStemList: ownsNestedStemList,
        });
        if (ambiguous) ambiguousAcceptedStarts.add(i);
        activeStartIndex = i;
        protectedStemStartIndex = ownsNestedStemList ? i : undefined;
      } else if (isIncompleteQuestion) {
        if (
          insideActiveMetadata(lines, activeStartIndex, i)
          && !hasReliableExplanationExit(lines, i)
          && !/\?/.test(standard.rest)
          && !/^(?:which|what|who|when|where|why|how)\b/i.test(standard.rest)
        ) return;
        const ambiguous = insideActiveExplanation(lines, activeStartIndex, i)
          && !hasReliableExplanationExit(lines, i);
        starts.push({ index: i, number: standard.number, rest: standard.rest, malformed: false });
        if (ambiguous) ambiguousAcceptedStarts.add(i);
        activeStartIndex = i;
      }
      return;
    }
    const malformed = matchMalformedQuestionStart(line);
    if (malformed && hasMalformedQuestionBoundaryContext(lines, i)
      && looksLikeMalformedNumberedQuestion(lines, i)) {
      const ambiguous = insideActiveExplanation(lines, activeStartIndex, i)
        && !hasReliableExplanationExit(lines, i);
      starts.push({ index: i, number: malformed.number, rest: malformed.rest, malformed: true });
      if (ambiguous) ambiguousAcceptedStarts.add(i);
      activeStartIndex = i;
    }
  });

  let drafts: ParsedQuestionDraft[];
  if (starts.length === 0) {
    const draft = parseQuestionText(body);
    if (protectedUnnumberedStemThrough !== undefined) {
      draft.needsReview = true;
      draft.warnings.push("An unnumbered question contains numbered stem content that could also be neighboring questions — confirm the boundary against the source.");
      draft.parserRuleIds = [...new Set([
        ...(draft.parserRuleIds ?? []),
        "question.numbered-stem-list",
        "question.ambiguous-numbered-stem-list",
      ])];
    }
    drafts = draft.stem || draft.options.length ? [draft] : [];
  } else {
    drafts = [];
    const preamble = lines.slice(0, starts[0].index).join("\n").trim();
    if (preamble) {
      const preambleDraft = parseQuestionText(preamble);
      if (preambleDraft.options.length >= 2 || /\?/.test(preambleDraft.stem)) {
        markUnnumberedPreambleDraft(preambleDraft, preamble);
        drafts.push(preambleDraft);
      }
    }
    for (let b = 0; b < starts.length; b++) {
      const start = starts[b];
      const from = start.index;
      const to = b + 1 < starts.length ? starts[b + 1].index : lines.length;
      const block = lines.slice(from, to).join("\n");
      const draft = parseQuestionText(stripQuestionStart(block, start));
      draft.questionNumber = start.number;
      if (start.malformed) markMalformedNumberedDraft(draft, block);
      else markNumberedDraft(draft, block);
      if (start.nestedStemList) {
        draft.needsReview = true;
        draft.warnings.push("This numbered stem contains a reset numbered list that could also be neighboring questions — confirm the boundary against the source.");
        draft.parserRuleIds = [...new Set([
          ...(draft.parserRuleIds ?? []),
          "question.numbered-stem-list",
          "question.ambiguous-numbered-stem-list",
        ])];
      }
      if (ambiguousAcceptedStarts.has(start.index)) markAmbiguousQuestionBoundary(draft);
      if (b + 1 < starts.length && ambiguousAcceptedStarts.has(starts[b + 1].index)) {
        markAmbiguousExplanationBoundary(draft);
      }
      if (draft.stem || draft.options.length) drafts.push(draft);
    }
  }

  const numbers = drafts.map((d) => d.questionNumber).filter((n): n is number => n !== undefined);
  if (new Set(numbers).size !== numbers.length) {
    for (const d of drafts) {
      d.warnings.push("Duplicate question numbers in this document — check the split.");
      d.needsReview = true;
      d.confidence = "low";
      d.overallImportConfidence = Math.min(d.overallImportConfidence ?? 0.45, 0.45);
      d.parserRuleIds = [...new Set([...(d.parserRuleIds ?? []), "conflict.duplicate-question-number"])];
    }
  }

  return entries.size ? applyAnswerEntries(drafts, entries) : drafts;
}

interface QuestionBlockStart {
  index: number;
  number: number;
  rest: string;
  malformed: boolean;
  nestedStemList?: boolean;
}

function matchQuestionStart(line: string): { number: number; rest: string } | undefined {
  // Strong labels allow no punctuation and may occupy their own line: "Q1",
  // "Question 2", "Q3 What is...".
  const labeled = line.match(/^\s*q(?:uestion)?\s*(?:#\s*:?\s*)?(\d{1,4})\s*(?:[).:\-–]\s*)?(.*?)\s*$/i);
  if (labeled) return { number: Number(labeled[1]), rest: labeled[2].trim() };
  // Bare numbers remain punctuation-gated to avoid splitting doses/lab values.
  const numbered = line.match(/^\s*(\d{1,4})\s*[).:\-–]\s*(.*?)\s*$/);
  return numbered ? { number: Number(numbered[1]), rest: numbered[2].trim() } : undefined;
}

function matchMalformedQuestionStart(line: string): { number: number; rest: string } | undefined {
  // A bare numeric prefix without punctuation is intentionally a weak signal.
  // It is accepted only when looksLikeMalformedNumberedQuestion confirms a
  // nearby A/B option list, and every resulting draft is forced through review.
  const match = line.match(/^\s*(\d{1,4})\s+(\S.*?)\s*$/);
  return match ? { number: Number(match[1]), rest: match[2].trim() } : undefined;
}

/**
 * Retain a clearly question-shaped numbered block even when its choices are
 * missing. Review can repair or remove it; silently attaching it to a neighbor
 * would corrupt both questions. Ordinary numbered objectives remain prose.
 */
function looksLikeIncompleteNumberedQuestion(lines: string[], index: number, firstLine: string): boolean {
  if (/^\s*(?:question|q)\s*#?\s*\d{1,4}\b/i.test(lines[index] ?? "")) return true;
  const stemLines = [firstLine];
  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 5); cursor += 1) {
    const line = lines[cursor] ?? "";
    if (matchQuestionStart(line) || OPTION_RE.test(line) || EXPLANATION_RE.test(line) || parseAnswerSignal(line)) break;
    if (!line.trim() && stemLines.some((part) => part.trim())) break;
    stemLines.push(line);
  }
  const stem = stemLines.join(" ").replace(/\s+/g, " ").trim();
  return /\?/.test(stem)
    || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(stem);
}

/** A numbered teaching point inside an explanation is not a question boundary
 * merely because lettered prose follows it. Require an observable transition:
 * a strong Q/Question label or a blank separator. Question-shaped content
 * without either cue is still retained, but is marked structurally ambiguous. */
function hasReliableExplanationExit(lines: string[], index: number): boolean {
  return /^\s*(?:question|q)\s*#?\s*\d{1,4}\b/i.test(lines[index] ?? "")
    || (index > 0 && !(lines[index - 1] ?? "").trim());
}

function insideActiveExplanation(
  lines: string[],
  activeStartIndex: number | undefined,
  candidateIndex: number,
): boolean {
  if (activeStartIndex === undefined) return false;
  return lines.slice(activeStartIndex + 1, candidateIndex).some((line) => EXPLANATION_RE.test(line));
}

function insideActiveMetadata(
  lines: string[],
  activeStartIndex: number | undefined,
  candidateIndex: number,
): boolean {
  if (activeStartIndex === undefined) return false;
  return lines.slice(activeStartIndex + 1, candidateIndex).some((line) => (
    OBJECTIVE_RE.test(line) || REFERENCE_RE.test(line)
  ));
}

function stripQuestionStart(block: string, start: QuestionBlockStart): string {
  const lines = block.split("\n");
  return [start.rest, ...lines.slice(1)].filter((line, index) => index > 0 || Boolean(line)).join("\n");
}

function markNumberedDraft(draft: ParsedQuestionDraft, originalBlock: string) {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), "question.numbered-boundary"])];
  const priorQuestionConfidence = draft.questionDetectionConfidence ?? 0;
  draft.questionDetectionConfidence = Math.max(priorQuestionConfidence, draft.stem && draft.options.length >= 3 ? 0.99 : priorQuestionConfidence);
  draft.sourceSnippet = sourceSnippet(originalBlock);
  draft.questionSourceSnippet = sourceSnippet([
    draft.questionNumber !== undefined ? `${draft.questionNumber}. ${draft.stem}` : draft.stem,
    ...draft.options.map((option) => `${option.key}. ${option.text}`),
  ].join("\n"));
  draft.overallImportConfidence = boundedConfidence(
    draft.questionDetectionConfidence * 0.4
      + (draft.answerDetectionConfidence ?? 0) * 0.4
      + (draft.explanationDetectionConfidence ?? 0) * 0.2,
  );
  if (draft.needsReview && (draft.answerDetectionConfidence ?? 0) <= 0.1) draft.overallImportConfidence = Math.min(draft.overallImportConfidence, 0.49);
  if (draft.correctKey && (draft.answerDetectionConfidence ?? 0) < 0.8) draft.overallImportConfidence = Math.min(draft.overallImportConfidence, 0.84);
  draft.confidence = categoricalConfidence(draft.overallImportConfidence);
}

function markMalformedNumberedDraft(draft: ParsedQuestionDraft, originalBlock: string) {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), "question.malformed-boundary"])];
  draft.warnings.push("Question number lacked a standard delimiter — retained as a separate question for review.");
  draft.needsReview = true;
  draft.questionDetectionConfidence = Math.min(draft.questionDetectionConfidence ?? 0.55, 0.55);
  draft.sourceSnippet = sourceSnippet(originalBlock);
  draft.questionSourceSnippet = sourceSnippet([
    draft.questionNumber !== undefined ? `${draft.questionNumber} ${draft.stem}` : draft.stem,
    ...draft.options.map((option) => `${option.key}. ${option.text}`),
  ].join("\n"));
  draft.overallImportConfidence = boundedConfidence(
    draft.questionDetectionConfidence * 0.4
      + (draft.answerDetectionConfidence ?? 0) * 0.4
      + (draft.explanationDetectionConfidence ?? 0) * 0.2,
  );
  draft.overallImportConfidence = Math.min(draft.overallImportConfidence, 0.84);
  draft.confidence = categoricalConfidence(draft.overallImportConfidence);
}

function markAmbiguousExplanationBoundary(draft: ParsedQuestionDraft) {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), "explanation.ambiguous-boundary"])];
  draft.warnings.push("Numbered question-like content touched an explanation without a clear separator — verify this boundary against the source.");
  draft.needsReview = true;
  draft.explanationDetectionConfidence = Math.min(draft.explanationDetectionConfidence ?? 0.6, 0.6);
  draft.overallImportConfidence = Math.min(draft.overallImportConfidence ?? 0.74, 0.74);
  draft.confidence = categoricalConfidence(draft.overallImportConfidence);
}

function markAmbiguousQuestionBoundary(draft: ParsedQuestionDraft) {
  draft.parserRuleIds = [...new Set([
    ...(draft.parserRuleIds ?? []),
    "question.ambiguous-explanation-boundary",
    "explanation.ambiguous-boundary",
  ])];
  draft.warnings.push("This question began inside an explanation without a clear separator — confirm whether it is a separate question.");
  draft.needsReview = true;
  draft.questionDetectionConfidence = Math.min(draft.questionDetectionConfidence ?? 0.55, 0.55);
  draft.explanationDetectionConfidence = Math.min(draft.explanationDetectionConfidence ?? 0.6, 0.6);
  draft.overallImportConfidence = Math.min(draft.overallImportConfidence ?? 0.6, 0.6);
  draft.confidence = categoricalConfidence(draft.overallImportConfidence);
}

function markUnnumberedPreambleDraft(draft: ParsedQuestionDraft, originalBlock: string) {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), "question.malformed-boundary"])];
  draft.warnings.push("Question-like content appeared before the numbered sequence — retained for review instead of being discarded.");
  draft.needsReview = true;
  draft.questionDetectionConfidence = Math.min(draft.questionDetectionConfidence ?? 0.55, 0.55);
  draft.sourceSnippet = sourceSnippet(originalBlock);
  draft.overallImportConfidence = Math.min(draft.overallImportConfidence ?? 0.74, 0.74);
  draft.confidence = categoricalConfidence(draft.overallImportConfidence);
}

// --- answer / explanation sections (L2 + L3) -------------------------------------

const KEY_HEADER_RE = /^\s*(answer\s*key|answers?(?:\s*(?:and|&)\s*(?:explanations?|rationales?))?|explanations?|solutions?)\s*[:\-–]?\s*$/im;
/** Compressed pairs like "1. C", "2-B", "3) D", "Question 4: A", "5C". */
const KEY_PAIR_RE = /(?:q(?:uestion)?\s*)?(\d{1,4})\s*[).:\-–—]?\s*\(?[ \t]*([A-Ha-h])[ \t]*\)?(?![a-z0-9])/gi;
/** A numbered entry start inside an answer section: "1. …", "Question 3: …". */
const ENTRY_START_RE = /^\s*(?:q(?:uestion)?\s*)?(\d{1,4})\s*(?:[).:\-–]\s*|\s+)(?=\S)/i;
function parseAnswerSectionContent(
  content: string,
  evidence: string,
  sectionIncludesExplanations = false,
): AnswerSectionEntry {
  const [head = "", ...tailLines] = content.split("\n");
  const explicit = parseAnswerSignal(head) ?? parseAnswerSignal(`Answer: ${head}`);
  if (explicit) {
    const continuation = tailLines.join("\n").trim();
    const continuationIsExplanation = continuation
      ? Boolean(continuation.match(EXPLANATION_RE) || isRationaleTail(continuation))
      : false;
    // Keep textual answers even in an "Answers and Explanations" section;
    // applyAnswerEntries resolves them against the question's actual options.
    // Treating the text as explanation here loses valid answers such as
    // "1. CD4 T lymphocyte".
    const answerText = explicit.key && sectionIncludesExplanations
      ? undefined
      : explicit.answerText && continuation && !continuationIsExplanation
      ? `${explicit.answerText} ${continuation}`
      : explicit.answerText;
    const explanation = [
      explicit.rationale,
      sectionIncludesExplanations && explicit.key ? explicit.answerText : undefined,
      (sectionIncludesExplanations || continuationIsExplanation) ? continuation : undefined,
    ]
      .filter(Boolean).join("\n").trim() || undefined;
    return {
      letter: explicit.key,
      answerText,
      explanation,
      explanationEvidence: explanation ? content : undefined,
      evidence,
    };
  }

  // A bare or punctuated letter is a key. A spaced phrase such as
  // "A rapid response" is answer text and is resolved only after the
  // corresponding question's options are available.
  const punctuated = head.match(/^\(?\s*([A-Ha-h])\s*\)?\s*(?:[.,:;]|[—–-])\s*(.*)$/);
  const bare = head.match(/^\(?\s*([A-Ha-h])\s*\)?\s*$/);
  const match = punctuated ?? bare;
  if (match) {
    const explanation = [(match[2] ?? "").trim(), ...tailLines].filter(Boolean).join("\n").trim() || undefined;
    return {
      letter: match[1].toUpperCase(),
      explanation,
      explanationEvidence: explanation ? content : undefined,
      evidence,
    };
  }
  return { answerText: content.trim() || undefined, evidence };
}

/**
 * Detect a trailing answer/explanation section and parse per-number entries
 * (letter + explanation text). Returns the body without the section.
 */
export function parseAnswerSections(text: string): { body: string; entries: Map<number, AnswerSectionEntry> } {
  const entries = new Map<number, AnswerSectionEntry>();
  const headerMatches = [...text.matchAll(new RegExp(KEY_HEADER_RE.source, "gim"))];
  let body = text;
  let sectionText = "";
  let supplementalExplanationText = "";
  let sectionIncludesExplanations = false;

  for (const headerMatch of headerMatches) {
    if (headerMatch.index === undefined) continue;
    const headerLabel = headerMatch[1].toLowerCase().replace(/\s+/g, " ");
    // Singular markers belong to the current question. Treating them as a
    // document section can discard every later question or key.
    if (/^(?:answer|explanation|solution)$/.test(headerLabel)) continue;
    const candidate = text.slice(headerMatch.index + headerMatch[0].length);
    const candidateLines = candidate.split("\n");
    // A per-question "Explanation:\n..." remains question content even when
    // a later numbered stem starts with A-H. Only a strict answer token counts
    // here; "2. A patient presents..." is a question boundary, not answer A.
    const hasNumberedAnswer = candidateLines.some((line, index) => {
      const start = line.match(ENTRY_START_RE);
      if (!start || looksLikeNumberedQuestion(candidateLines, index)) return false;
      const content = line.slice(start[0].length).trim();
      return Boolean(
        parseAnswerSignal(content)?.key
        || content.match(/^\(?[ \t]*[A-Ha-h][ \t]*\)?(?:\s*$|\s*[.,:;—–-]\s*)/),
      );
    });
    const hasCompressedKey = candidateLines.some((line) => [...line.matchAll(KEY_PAIR_RE)].length > 1);
    // Plural/explicit answer headers may legitimately contain answer text
    // rather than a letter. Singular Answer/Explanation markers inside a
    // question are deliberately excluded from this broad rule.
    const explicitAnswerSection = /answer\s*key|^answers\b|^solutions\b/.test(headerLabel)
      && candidateLines.some((line) => ENTRY_START_RE.test(line));
    if (hasNumberedAnswer || hasCompressedKey || explicitAnswerSection) {
      const laterExplanation = headerMatches.find((match) => (
        match.index !== undefined
        && match.index > headerMatch.index!
        && /^explanations$/.test(match[1].toLowerCase().replace(/\s+/g, " "))
      ));
      sectionText = laterExplanation?.index !== undefined
        ? text.slice(headerMatch.index + headerMatch[0].length, laterExplanation.index)
        : candidate;
      if (laterExplanation?.index !== undefined) {
        supplementalExplanationText = text.slice(laterExplanation.index + laterExplanation[0].length);
      }
      sectionIncludesExplanations = /explanations?|rationales?/.test(headerLabel);
      body = text.slice(0, headerMatch.index);
      break;
    }
  }

  if (!sectionText) {
    // Inline form: "Answers: 1C, 2B, 3D" on a single line. Must contain real
    // number→letter pairs — a per-question "Answer: B" line is NOT a key
    // section and stays in the body for the single-question parser.
    const inline = text.match(/^\s*answers?\s*[:\-–]\s*(.+\S)\s*$/im);
    if (inline && inline.index !== undefined && /(?:q(?:uestion)?\s*)?\d{1,4}\s*[).:\-–]?\s*\(?[A-Ha-h]\)?(?![a-z0-9])/i.test(inline[1])) {
      sectionText = inline[1];
      body = text.slice(0, inline.index) + text.slice(inline.index + inline[0].length);
    }
  }
  if (!sectionText) return { body: text, entries };

  const finish = () => {
    attachNumberedExplanations(entries, supplementalExplanationText);
    return { body, entries };
  };

  const alignedTable = parseAlignedAnswerTable(sectionText);
  if (alignedTable.size > 0) {
    for (const [number, entry] of alignedTable) entries.set(number, entry);
    return finish();
  }

  // A compressed key on one physical line must be parsed pair-by-pair before
  // the numbered-entry parser can mistake it for one entry plus explanation.
  const compressedPairs = [...sectionText.matchAll(KEY_PAIR_RE)];
  const pairsByLine = sectionText.split("\n").some((line) => [...line.matchAll(KEY_PAIR_RE)].length > 1);
  if (pairsByLine) {
    for (const match of compressedPairs) {
      const num = Number(match[1]);
      const letter = match[2].toUpperCase();
      const existing = entries.get(num);
      if (existing?.letter && existing.letter !== letter) {
        entries.set(num, { letter: "?", evidence: `${existing.evidence ?? ""}\n${match[0]}`.trim() });
      } else if (!existing) {
        entries.set(num, { letter, evidence: match[0].trim() });
      }
    }
    return finish();
  }

  // Split the section into numbered entries so explanations attach to numbers.
  const sectionLines = sectionText.split("\n");
  const entryStarts: number[] = [];
  sectionLines.forEach((line, i) => {
    if (ENTRY_START_RE.test(line)) entryStarts.push(i);
  });

  if (entryStarts.length > 0) {
    for (let e = 0; e < entryStarts.length; e++) {
      const from = entryStarts[e];
      const to = e + 1 < entryStarts.length ? entryStarts[e + 1] : sectionLines.length;
      const entryLines = sectionLines.slice(from, to);
      const numMatch = entryLines[0].match(ENTRY_START_RE)!;
      const num = Number(numMatch[1]);
      const content = [entryLines[0].slice(numMatch[0].length), ...entryLines.slice(1)].join("\n").trim();

      const parsed = parseAnswerSectionContent(
        content,
        entryLines.join("\n").trim(),
        sectionIncludesExplanations,
      );
      const proseMatch = content.match(PROSE_ANSWER_RE);
      // Cross-check: an explicit head letter vs prose letter in the same entry.
      const claims = [...new Set([parsed.letter, proseMatch?.[1]]
        .filter((letter): letter is string => Boolean(letter))
        .map((letter) => letter.toUpperCase()))];
      const finalEntry: AnswerSectionEntry = claims.length > 1
        ? { letter: "?", evidence: parsed.evidence }
        : { ...parsed, letter: parsed.letter?.toUpperCase() };

      const existing = entries.get(num);
      if (existing && existing.letter && finalEntry.letter && existing.letter !== finalEntry.letter) {
        entries.set(num, {
          letter: "?",
          explanation: existing.explanation ?? finalEntry.explanation,
          explanationEvidence: existing.explanationEvidence ?? finalEntry.explanationEvidence,
          evidence: `${existing.evidence ?? ""}\n${finalEntry.evidence ?? ""}`.trim(),
        });
      } else if (!existing) {
        entries.set(num, finalEntry);
      }
    }
    // A section that split into entries but yielded no letters at all is more
    // likely a compressed key ("1C 2B…") — fall through to pair parsing.
    if ([...entries.values()].some((entry) => entry.letter || entry.answerText)) return finish();
    entries.clear();
  }

  // Compressed / one-line keys: "1C, 2B, 3D" or "1. C 2. B 3. D".
  for (const match of sectionText.matchAll(KEY_PAIR_RE)) {
    const num = Number(match[1]);
    const letter = match[2].toUpperCase();
    const existing = entries.get(num);
    if (existing?.letter && existing.letter !== letter) {
      entries.set(num, { letter: "?", evidence: `${existing.evidence ?? ""}\n${match[0]}`.trim() });
    } else if (!existing) entries.set(num, { letter, evidence: match[0].trim() });
  }
  return finish();
}

/** PDF table extraction often emits one row of question numbers followed by
 * one aligned row of answer letters. Only accept strict, equal-width rows;
 * anything malformed stays unresolved instead of being guessed. */
function parseAlignedAnswerTable(sectionText: string): Map<number, AnswerSectionEntry> {
  const entries = new Map<number, AnswerSectionEntry>();
  const lines = sectionText.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const numberTokens = lines[index].split(/[\s|,;]+/).filter(Boolean);
    const numbers = numberTokens.map((token) => {
      const match = token.match(/^(\d{1,4})[).:]?$/);
      return match ? Number(match[1]) : undefined;
    });
    if (numbers.length < 2 || numbers.some((number) => number === undefined)) continue;

    const letterTokens = lines[index + 1].split(/[\s|,;]+/).filter(Boolean);
    const letters = letterTokens.map((token) => token.replace(/^\(\s*|\s*\)$/g, "").replace(/[).:]$/g, "").toUpperCase());
    if (letters.length !== numbers.length || letters.some((letter) => !/^[A-H]$/.test(letter))) continue;

    numbers.forEach((number, position) => {
      const value = number!;
      const letter = letters[position];
      const evidence = `${numberTokens[position]} ${letterTokens[position]}`;
      const existing = entries.get(value);
      if (existing?.letter && existing.letter !== letter) {
        entries.set(value, { letter: "?", evidence: `${existing.evidence ?? ""}\n${evidence}`.trim() });
      } else if (!existing) {
        entries.set(value, { letter, evidence });
      }
    });
    index += 1;
  }
  return entries.size >= 2 ? entries : new Map();
}

function looksLikeNumberedQuestion(lines: string[], index: number): boolean {
  const start = matchQuestionStart(lines[index] ?? "");
  if (!start) return false;
  let optionCount = 0;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (matchQuestionStart(lines[cursor])) break;
    if (OPTION_RE.test(lines[cursor])) optionCount += 1;
    if (optionCount >= 2) return true;
  }
  return false;
}

/**
 * Recognize an unnumbered, question-shaped stem that owns a reset 1/2 list
 * before its A/B choices. Requiring sequential items plus an explicit
 * question-shaped continuation keeps ordinary numbered question sequences
 * eligible for the normal boundary pass.
 */
function unnumberedNestedStemFirstOptionIndex(lines: string[]): number | undefined {
  const firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex < 0) return undefined;
  const first = lines[firstIndex].trim();
  if (matchQuestionStart(first) || OPTION_RE.test(first)) return undefined;
  let questionShaped = /\?/.test(first)
    || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(first);
  let questionShapedBeforeList = questionShaped;
  let expectedNumber = 1;
  let listItems = 0;
  let continuationAfterList = false;
  let firstOptionIndex: number | undefined;
  const optionKeys = new Set<string>();

  for (let cursor = firstIndex + 1; cursor < lines.length && cursor <= firstIndex + 30; cursor += 1) {
    const line = lines[cursor] ?? "";
    const option = line.match(OPTION_RE);
    if (option) {
      if (listItems < 2 || !questionShaped || (!questionShapedBeforeList && !continuationAfterList)) return undefined;
      firstOptionIndex ??= cursor;
      optionKeys.add(option[1].toUpperCase());
      if (optionKeys.has("A") && optionKeys.has("B")) return firstOptionIndex;
      continue;
    }
    if (firstOptionIndex !== undefined || parseAnswerSignal(line) || EXPLANATION_RE.test(line)) return undefined;

    const nested = matchQuestionStart(line);
    if (nested) {
      if (/^\s*(?:question|q)\s*#?\s*\d{1,4}\b/i.test(line)
        || nested.number !== expectedNumber
        || /\?/.test(nested.rest)
        || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(nested.rest)) {
        return undefined;
      }
      listItems += 1;
      expectedNumber += 1;
      continue;
    }

    const prose = line.trim();
    if (!prose) continue;
    const proseQuestionShaped = /\?/.test(prose)
      || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(prose);
    questionShaped ||= proseQuestionShaped;
    if (listItems === 0 && proseQuestionShaped) questionShapedBeforeList = true;
    if (listItems > 0 && proseQuestionShaped) continuationAfterList = true;
  }
  return undefined;
}

/**
 * A real question stem can contain its own numbered findings before the A/B
 * choices. The ordinary boundary probe intentionally stops at every numbered
 * line, so this conservative fallback accepts the earliest outer boundary only
 * when later non-option stem prose is unmistakably question-shaped and A/B
 * choices follow nearby. The caller protects that pre-option region so the
 * nested list items cannot become competing starts.
 */
function looksLikeQuestionWithNestedNumberedStem(lines: string[], index: number): boolean {
  const start = matchQuestionStart(lines[index] ?? "");
  if (!start) return false;
  let questionShaped = /\?/.test(start.rest)
    || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(start.rest);
  let nestedListItems = 0;
  let priorNestedNumber: number | undefined;
  const optionKeys = new Set<string>();
  for (let cursor = index + 1; cursor < lines.length && cursor <= index + 30; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (parseAnswerSignal(line) || EXPLANATION_RE.test(line)) return false;
    const option = line.match(OPTION_RE);
    if (option) {
      optionKeys.add(option[1].toUpperCase());
      if (nestedListItems >= 2 && questionShaped && optionKeys.has("A") && optionKeys.has("B")) return true;
      continue;
    }
    const nested = matchQuestionStart(line);
    if (nested) {
      // A real neighboring question is not a list item. Require at least two
      // plain, sequential numbered findings before allowing the outer stem to
      // own A/B. The first item must reset/equal the outer number; a forward
      // 1 → 2 transition is far more likely to be the next question.
      if (/^\s*(?:question|q)\s*#?\s*\d{1,4}\b/i.test(line)
        || /\?/.test(nested.rest)
        || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(nested.rest)) return false;
      if (priorNestedNumber === undefined) {
        if (nested.number > start.number) return false;
      } else if (nested.number !== priorNestedNumber + 1) {
        return false;
      }
      nestedListItems += 1;
      priorNestedNumber = nested.number;
      continue;
    }
    const prose = line.trim();
    if (/\?/.test(prose)
      || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(prose)) {
      questionShaped = true;
    }
  }
  return false;
}

function looksLikeMalformedNumberedQuestion(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (matchQuestionStart(line) || !/^\s*\d{1,4}\s+\S/.test(line)) return false;
  let optionCount = 0;
  const stemLines = [line.replace(/^\s*\d{1,4}\s+/, "")];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (matchQuestionStart(lines[cursor]) || /^\s*\d{1,4}\s+\S/.test(lines[cursor])) break;
    if (OPTION_RE.test(lines[cursor])) optionCount += 1;
    else if (optionCount === 0) stemLines.push(lines[cursor]);
    if (optionCount >= 2) {
      const stem = stemLines.join(" ").replace(/\s+/g, " ").trim();
      return /\?/.test(stem)
        || /^(?:which|what|who|when|where|why|how|select|choose|identify|determine|calculate|name)\b/i.test(stem);
    }
  }
  return false;
}

function hasMalformedQuestionBoundaryContext(lines: string[], index: number): boolean {
  if (index === 0 || !(lines[index - 1] ?? "").trim()) return true;
  const prior = lines.slice(Math.max(0, index - 12), index);
  return prior.some((line) => OPTION_RE.test(line))
    && prior.some((line) => Boolean(parseAnswerSignal(line) || EXPLANATION_RE.test(line)));
}

function attachNumberedExplanations(entries: Map<number, AnswerSectionEntry>, sectionText: string): void {
  if (!sectionText.trim()) return;
  const lines = sectionText.split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => { if (ENTRY_START_RE.test(line)) starts.push(index); });
  for (let entryIndex = 0; entryIndex < starts.length; entryIndex += 1) {
    const from = starts[entryIndex];
    const to = entryIndex + 1 < starts.length ? starts[entryIndex + 1] : lines.length;
    const entryLines = lines.slice(from, to);
    const numberMatch = entryLines[0].match(ENTRY_START_RE);
    if (!numberMatch) continue;
    const number = Number(numberMatch[1]);
    const contentLines = [entryLines[0].slice(numberMatch[0].length), ...entryLines.slice(1)];
    const noiseIndex = contentLines.findIndex((line) => /^(?:footer\b|page\s+\d+\s+of\s+\d+\b|commercial-style footer\b)/i.test(line.trim()));
    const explanation = contentLines.slice(0, noiseIndex < 0 ? contentLines.length : noiseIndex).join("\n").trim();
    if (!explanation) continue;
    const existing = entries.get(number);
    entries.set(number, {
      ...(existing ?? {}),
      explanation: existing?.explanation ?? explanation,
      explanationEvidence: existing?.explanationEvidence ?? entryLines.join("\n").trim(),
      evidence: existing?.evidence ?? entryLines.join("\n").trim(),
    });
  }
}

/** Back-compat wrapper: number → letter map only. */
export function splitAnswerKeySection(text: string): { body: string; answerKey: Map<number, string> } {
  const { body, entries } = parseAnswerSections(text);
  const answerKey = new Map<number, string>();
  for (const [num, entry] of entries) {
    if (entry.letter) answerKey.set(num, entry.letter);
  }
  return { body, answerKey };
}

function applyAnswerEntries(drafts: ParsedQuestionDraft[], entries: Map<number, AnswerSectionEntry>): ParsedQuestionDraft[] {
  return drafts.map((draft) => {
    if (draft.questionNumber === undefined) return draft;
    const entry = entries.get(draft.questionNumber);
    if (!entry) return draft;
    let next = { ...draft };
    let entryLetter = entry.letter;

    if (entry.answerText) {
      const textMatch = matchAnswerText(entry.answerText, next.options);
      if (textMatch.ambiguous || !textMatch.key) {
        const warning = textMatch.ambiguous
          ? `Answer text "${entry.answerText}" matches more than one option — left unset, needs review.`
          : `Answer text "${entry.answerText}" did not exactly match an option — left unset, needs review.`;
        return {
          ...next,
          correctKey: undefined,
          correctAnswerText: undefined,
          answerEvidence: entry.evidence,
          answerEvidenceSnippet: entry.evidence,
          needsReview: true,
          answerDetectionConfidence: textMatch.ambiguous ? 0.05 : 0.1,
          overallImportConfidence: Math.min(next.overallImportConfidence ?? 1, 0.49),
          confidence: "low",
          parserRuleIds: [...new Set([...(next.parserRuleIds ?? []), textMatch.ambiguous
            ? "conflict.answer-section-text"
            : "answer.section-text-unmatched"])],
          warnings: [...next.warnings.filter((item) => !/no correct answer/i.test(item)), warning],
        };
      }
      if (entryLetter && entryLetter !== "?" && entryLetter !== textMatch.key) {
        return {
          ...next,
          correctKey: undefined,
          correctAnswerText: undefined,
          answerEvidence: entry.evidence,
          answerEvidenceSnippet: entry.evidence,
          needsReview: true,
          answerDetectionConfidence: 0.05,
          overallImportConfidence: Math.min(next.overallImportConfidence ?? 1, 0.49),
          confidence: "low",
          parserRuleIds: [...new Set([...(next.parserRuleIds ?? []), "conflict.answer-section-letter-text"])],
          warnings: [
            ...next.warnings.filter((item) => !/no correct answer/i.test(item)),
            `Conflict: answer letter "${entryLetter}" and attached answer text support different options — left unset, needs review.`,
          ],
        };
      }
      entryLetter = textMatch.key;
      next.parserRuleIds = [...new Set([...(next.parserRuleIds ?? []), "answer.trailing-text-match"])];
    }

    // L3: attach the section explanation when the question has none.
    if (entry.explanation && !next.explanation) {
      const optionText = entryLetter && entryLetter !== "?"
        ? next.options.find((option) => option.key === entryLetter)?.text
        : undefined;
      // "1. B. CD4+ T lymphocytes" is an answer-text key, not an
      // explanation. Only attach the tail when it is teaching prose.
      const tailIsAnswerText = optionText
        ? comparableAnswerText(optionText) === comparableAnswerText(entry.explanation)
        : false;
      if (!tailIsAnswerText) {
        const cleanup = sanitizeExplanationCandidate(entry.explanation, next);
        next.explanation = cleanup.cleanedText || undefined;
        next.explanationRawCandidate = cleanup.rawCandidate;
        next.explanationCleanupOperations = cleanup.cleanupOperations.length
          ? cleanup.cleanupOperations
          : undefined;
        next.explanationSource = next.explanation ? "answer-section" : undefined;
        next.explanationSourceSnippet = sourceSnippet(entry.explanationEvidence ?? entry.explanation);
        if (next.explanation) next.explanationDetectionConfidence = Math.max(0.9, cleanup.confidence);
      }
    }

    if (entryLetter === "?") {
      next.warnings = [...next.warnings, "The answer section lists conflicting answers for this number — left unset, needs review."];
      next.needsReview = true;
      next.correctKey = undefined;
      next.correctAnswerText = undefined;
      next.answerEvidence = entry.evidence;
      next.answerEvidenceSnippet = entry.evidence;
      next.answerDetectionConfidence = 0.05;
      next.overallImportConfidence = Math.min(next.overallImportConfidence ?? 1, 0.49);
      next.confidence = "low";
      next.parserRuleIds = [...new Set([...(next.parserRuleIds ?? []), "conflict.answer-section"] )];
      return next;
    }
    if (!entryLetter) return next;

    // L5: the key vs an answer already found inside the question block.
    if (next.correctKey && next.correctKey !== entryLetter) {
      const blockKey = next.correctKey;
      next = {
        ...next,
        correctKey: undefined,
        correctAnswerText: undefined,
        needsReview: true,
        answerDetectionConfidence: 0.05,
        overallImportConfidence: Math.min(next.overallImportConfidence ?? 1, 0.49),
        confidence: "low",
        parserRuleIds: [...new Set([...(next.parserRuleIds ?? []), "conflict.block-vs-answer-section"])],
        answerEvidence: entry.evidence,
        answerEvidenceSnippet: entry.evidence,
        warnings: [...next.warnings, `Conflict: the question block says "${blockKey}" but the answer section says "${entryLetter}" — left unset, needs review.`],
      };
      return next;
    }
    if (next.correctKey) return refreshAnswerEntryDiagnostics({
      ...next,
      answerEvidence: entry.evidence ?? next.answerEvidence,
      answerEvidenceSnippet: entry.evidence ?? next.answerEvidenceSnippet,
    }); // already agrees

    if (!next.options.some((o) => o.key === entryLetter)) {
      next.warnings = [...next.warnings, `Answer key says "${entryLetter}" but no such option exists — left unset.`];
      next.needsReview = true;
      next.answerEvidence = entry.evidence;
      next.answerEvidenceSnippet = entry.evidence;
      next.answerDetectionConfidence = 0.1;
      next.overallImportConfidence = Math.min(next.overallImportConfidence ?? 1, 0.49);
      next.confidence = "low";
      next.parserRuleIds = [...new Set([...(next.parserRuleIds ?? []), "answer.section-invalid-option"])];
      return next;
    }
    return refreshAnswerEntryDiagnostics({
      ...next,
      correctKey: entryLetter,
      correctAnswerText: next.options.find((option) => option.key === entryLetter)?.text,
      answerEvidence: entry.evidence,
      answerEvidenceSnippet: entry.evidence,
    });
  });
}

/** Deterministically associate a separately supplied numbered answer or
 * explanation source. Numbered matches are applied; unmatched or conflicting
 * entries remain visible through the returned diagnostics. */
export function associateAnswerSource(
  drafts: readonly ParsedQuestionDraft[],
  answerSourceText: string,
): { drafts: ParsedQuestionDraft[]; matched: number; unmatchedNumbers: number[] } {
  const { entries } = parseAnswerSections(answerSourceText);
  const before = new Map(drafts.map((draft) => [draft.questionNumber, draft.correctKey]));
  const associated = applyAnswerEntries([...drafts], entries);
  const matched = associated.filter((draft) => draft.questionNumber !== undefined
    && entries.has(draft.questionNumber)
    && (draft.correctKey !== before.get(draft.questionNumber) || Boolean(draft.answerEvidence))).length;
  const known = new Set(drafts.map((draft) => draft.questionNumber).filter((number): number is number => number !== undefined));
  return { drafts: associated, matched, unmatchedNumbers: [...entries.keys()].filter((number) => !known.has(number)) };
}

function refreshAnswerEntryDiagnostics(draft: ParsedQuestionDraft): ParsedQuestionDraft {
  const warnings = draft.warnings.filter((warning) => !/no correct answer/i.test(warning));
  const parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), "answer.trailing-section"])];
  const answerDetectionConfidence = 0.99;
  let overallImportConfidence = boundedConfidence(
    (draft.questionDetectionConfidence ?? 0) * 0.4
      + answerDetectionConfidence * 0.4
      + (draft.explanationDetectionConfidence ?? 0) * 0.2,
  );
  const stillNeedsReview = parserRuleIds.includes("question.malformed-boundary")
    || warnings.some((warning) => /conflict|duplicate|doesn't match|no such option|no question stem|no answer options|missing or out of sequence/i.test(warning));
  if (stillNeedsReview) overallImportConfidence = Math.min(overallImportConfidence, 0.49);
  return {
    ...draft,
    correctAnswerText: draft.correctKey ? draft.options.find((option) => option.key === draft.correctKey)?.text : undefined,
    answerDetectionConfidence,
    overallImportConfidence,
    confidence: categoricalConfidence(overallImportConfidence),
    needsReview: stillNeedsReview || undefined,
    parserRuleIds,
    warnings,
  };
}

/**
 * Pure diagnostic projection for development tools and regression tests.
 * It deliberately contains no UI state and never changes parser output.
 */
export function createImportMappingLedger(
  drafts: readonly ParsedQuestionDraft[],
): ImportMappingDiagnostic[] {
  return drafts.map((draft) => {
    const sourceSpans: ImportMappingDiagnostic["sourceSpans"] = [];
    const questionSnippet = draft.questionSourceSnippet ?? draft.sourceSnippet;
    const answerSnippet = draft.answerEvidenceSnippet ?? draft.answerEvidence;
    if (questionSnippet) {
      sourceSpans.push({ kind: "question", snippet: questionSnippet, page: draft.questionSourcePage ?? draft.sourcePage });
    }
    if (answerSnippet) {
      sourceSpans.push({ kind: "answer", snippet: answerSnippet, page: draft.answerEvidencePage });
    }
    if (draft.explanationSourceSnippet) {
      sourceSpans.push({ kind: "explanation", snippet: draft.explanationSourceSnippet, page: draft.explanationSourcePage });
    }
    return {
      questionNumber: draft.questionNumber,
      extractedOptions: draft.options.map((option) => ({ ...option })),
      answerEvidence: answerSnippet,
      selectedMapping: draft.correctKey,
      confidence: draft.answerDetectionConfidence ?? 0,
      conflictReason: draft.warnings.find((warning) => /conflict|ambiguous|did not exactly match|no such option/i.test(warning)),
      sourceSpans,
    };
  });
}
