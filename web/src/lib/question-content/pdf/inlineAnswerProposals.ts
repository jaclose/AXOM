import type { ParsedQuestionDraft } from "../../questionParse";
import type { QuestionBlock } from "../blocks";
import type { PackageQuestion } from "../package";

export interface SourceAnswerMarker {
  /** One-based PDF page and extracted line, including a marker on the next page. */
  page: number;
  line: number;
  label: string;
}

export interface SourceQuestionOccurrence {
  /** One-based PDF opening; 0/0 means an ambiguous suffix that cannot support a proposal. */
  page: number;
  line: number;
  /** In-memory full stem and ordered-choice fingerprint. Never write this into a receipt. */
  fingerprint: string;
  answerMarkers: readonly SourceAnswerMarker[];
}

export interface InlineAnswerProposal {
  questionId: string;
  questionPage: number;
  questionLine: number;
  answerCopyQuestionId: string;
  answerPage: number;
  answerLine: number;
  answerMarkerPage: number;
  answerMarkerLine: number;
  /** Source text suggests this letter. It is never a scoring key. */
  suggestedChoice: string;
  storedAnswerLabels: string[];
  answerCopyStoredAnswerLabels: string[];
  conflict: boolean;
  reviewRequired: true;
  reviewReason: "inline-answer-copy" | "conflicts-with-key";
}

const clean = (text: string): string => text.normalize("NFKC").replace(/\s+/g, " ").trim();

function sequenceFingerprint(stem: string, choices: readonly { label: string; text: string }[]): string | undefined {
  const cleanedStem = clean(stem);
  if (!cleanedStem) return;
  const ordered = choices.map(choice => ({ label: choice.label.trim().toUpperCase(), text: clean(choice.text) }));
  return JSON.stringify([cleanedStem, ordered.map(choice => [choice.label, choice.text])]);
}

function choiceTextForSequence(blocks: readonly QuestionBlock[]): string | undefined {
  if (blocks.some(block => block.type !== "text")) return;
  return blocks.map(block => block.type === "text" ? block.text : "").join(" ");
}

function stemTextForSequence(blocks: readonly QuestionBlock[]): string | undefined {
  if (!blocks.length || blocks.some(block => block.type !== "text" && block.type !== "image")) return;
  const text = blocks.flatMap(block => block.type === "text" ? [block.text] : []).join(" ");
  return text.trim() ? text : undefined;
}

/** A strict in-memory match to the source parser's stem and ordered choices. */
export function fingerprintParsedQuestionDraft(draft: ParsedQuestionDraft): string | undefined {
  return sequenceFingerprint(draft.stem, draft.options.map(option => ({ label: option.key, text: option.text })));
}

/** Unusual choice rows and stem images may prove sequence, but cannot yield answer proposals. */
export function fingerprintPackageQuestion(question: PackageQuestion): string | undefined {
  const stem = stemTextForSequence(question.stem);
  if (stem === undefined) return;
  const choices: { label: string; text: string }[] = [];
  for (const choice of question.choices) {
    const text = choiceTextForSequence(choice.blocks);
    if (text === undefined) return;
    choices.push({ label: choice.label, text });
  }
  return sequenceFingerprint(stem, choices);
}

function hasStrictTextChoices(question: PackageQuestion): boolean {
  if (question.choiceTable || question.choices.length < 2 || question.choices.length > 10) return false;
  const seen = new Set<string>();
  for (const choice of question.choices) {
    const label = choice.label.trim().toUpperCase();
    const text = choiceTextForSequence(choice.blocks);
    if (!/^[A-J]$/.test(label) || seen.has(label) || !text?.trim()) return false;
    seen.add(label);
  }
  return true;
}

function validPosition(page: number, line: number): boolean {
  return Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(line) && line > 0;
}

function comparePosition(a: { page: number; line: number }, b: { page: number; line: number }): number {
  return a.page - b.page || a.line - b.line;
}

/**
 * Exact global sequence is needed to bind repeated bank rows to source occurrences.
 * A single mismatch makes the whole source abstain; no key or readiness is changed.
 */
export function buildInlineAnswerProposals(
  questions: readonly PackageQuestion[], occurrences: readonly SourceQuestionOccurrence[],
): InlineAnswerProposal[] {
  if (questions.length !== occurrences.length || questions.length < 2) return [];
  if (new Set(questions.map(question => question.id)).size !== questions.length) return [];
  const byFingerprint = new Map<string, number[]>();
  let unknownSuffix = false;
  let lastLocated: SourceQuestionOccurrence | undefined;
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index], occurrence = occurrences[index];
    const bankFingerprint = fingerprintPackageQuestion(question);
    if (!bankFingerprint || bankFingerprint !== occurrence.fingerprint) return [];
    const unknown = occurrence.page === 0 && occurrence.line === 0;
    if (unknown) {
      if (occurrence.answerMarkers.length) return [];
      unknownSuffix = true;
    } else {
      if (unknownSuffix || !validPosition(occurrence.page, occurrence.line)
        || (lastLocated && comparePosition(lastLocated, occurrence) >= 0)
        || (question.source.page !== undefined && question.source.page !== occurrence.page)) return [];
      lastLocated = occurrence;
    }
    const group = byFingerprint.get(bankFingerprint) ?? [];
    group.push(index);
    byFingerprint.set(bankFingerprint, group);
  }

  const proposals: InlineAnswerProposal[] = [];
  for (const indices of byFingerprint.values()) {
    if (indices.length !== 2) continue;
    const [originalAt, revealAt] = indices;
    const original = occurrences[originalAt], reveal = occurrences[revealAt];
    if (!validPosition(original.page, original.line) || !validPosition(reveal.page, reveal.line)
      || original.answerMarkers.length !== 0 || reveal.answerMarkers.length !== 1) continue;
    const marker = reveal.answerMarkers[0], label = marker.label.trim().toUpperCase();
    const next = occurrences[revealAt + 1];
    if (!validPosition(marker.page, marker.line) || (next && !validPosition(next.page, next.line))
      || comparePosition(reveal, marker) >= 0
      || (next && comparePosition(marker, next) >= 0) || !/^[A-J]$/.test(label)) continue;
    const question = questions[originalAt], answeredCopy = questions[revealAt];
    if (question.stem.some(block => block.type !== "text")
      || answeredCopy.stem.some(block => block.type !== "text")
      || !hasStrictTextChoices(question) || !hasStrictTextChoices(answeredCopy)) continue;
    if (!question.choices.some(choice => choice.label.toUpperCase() === label)
      || !answeredCopy.choices.some(choice => choice.label.toUpperCase() === label)) continue;
    const storedAnswerLabels = question.correctAnswer?.labels ?? [];
    const answerCopyStoredAnswerLabels = answeredCopy.correctAnswer?.labels ?? [];
    const disagrees = (labels: readonly string[]): boolean => labels.length > 0
      && (labels.length !== 1 || labels[0].toUpperCase() !== label);
    const conflict = disagrees(storedAnswerLabels) || disagrees(answerCopyStoredAnswerLabels);
    proposals.push({ questionId: question.id, questionPage: original.page, questionLine: original.line,
      answerCopyQuestionId: answeredCopy.id, answerPage: reveal.page, answerLine: reveal.line,
      answerMarkerPage: marker.page, answerMarkerLine: marker.line, suggestedChoice: label,
      storedAnswerLabels: [...storedAnswerLabels], answerCopyStoredAnswerLabels: [...answerCopyStoredAnswerLabels],
      conflict, reviewRequired: true,
      reviewReason: conflict ? "conflicts-with-key" : "inline-answer-copy" });
  }
  return proposals;
}
