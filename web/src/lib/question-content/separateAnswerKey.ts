import type { ImportPackage, PackageIssue, PackageQuestion } from "./package";
import { associateAnswerSource, parseAnswerSections, type ParsedQuestionDraft } from "../questionParse";

export interface SeparateKeyContext { name: string; checksum: string; }
export interface SeparateKeyResult<T> { value: T; matched: number; conflicted: number; unmatchedNumbers: number[]; warnings: string[]; }

/** Users must explicitly select a file as an answer key. Never treat ordinary explanatory prose as a printed key. */
export function normalizeSeparateKeyText(input: string): string {
  const source = input.trim();
  if (parseAnswerSections(source).entries.size) return source;
  const nonEmpty = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!nonEmpty.length) return "";
  const numbered = nonEmpty.filter(line => /^(?:q(?:uestion)?\s*)?\d{1,4}\s*(?:[).:\-–]\s*)?\(?[A-Ha-h]\)?(?:\s|$|[.,:;—–-])/i.test(line));
  // Pure numbered keys are common separately from their question paper.
  // A file of lecture notes with occasional numbered letters is NOT a key.
  if (numbered.length < 1 || numbered.length < Math.ceil(nonEmpty.length * 0.8)) return source;
  return `Answer key:\n${source}`;
}

const keyEvidence = (context: SeparateKeyContext): string =>
  `Explicitly selected separate answer-key source: ${context.name} (SHA-256 ${context.checksum.replace(/^sha256:/, "")}).`;

function safeEntries(raw: string) {
  const parsed = parseAnswerSections(normalizeSeparateKeyText(raw));
  return parsed.entries;
}

/** Adds source-tied key evidence using the EXISTING draft parser conflict rules. */
export function pairDraftAnswers(drafts: readonly ParsedQuestionDraft[], text: string, key: SeparateKeyContext): SeparateKeyResult<ParsedQuestionDraft[]> {
  const entries = safeEntries(text);
  const warnings = [keyEvidence(key)];
  if (!entries.size) return { value: [...drafts], matched: 0, conflicted: 0, unmatchedNumbers: [],
    warnings: [...warnings, "The selected file contained no reliably numbered answer-key section. No keys were changed."] };
  const counts = new Map<number, number>();
  for (const question of drafts) if (question.questionNumber !== undefined) counts.set(question.questionNumber, (counts.get(question.questionNumber) ?? 0) + 1);
  const input = drafts.map(draft => {
    if (draft.questionNumber === undefined || (counts.get(draft.questionNumber) ?? 0) === 1) return draft;
    return { ...draft, correctKey: undefined, correctAnswerText: undefined, needsReview: true,
      answerDetectionConfidence: 0.05, confidence: "low" as const,
      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "conflict.duplicate-number-separated-key"])],
      warnings: [...draft.warnings, "Several questions share this source number; the separate key cannot be assigned safely."] };
  });
  const associated = associateAnswerSource(input, normalizeSeparateKeyText(text));
  let matched = 0, conflicted = 0;
  const value = associated.drafts.map((draft, index) => {
    const num = drafts[index].questionNumber;
    if (num === undefined || !entries.has(num)) return draft;
    if ((counts.get(num) ?? 0) > 1 || draft.warnings.some(w => /conflict|left unset|no such option|did not exactly match|matches more than one option/i.test(w))) {
      conflicted++;
      return { ...draft, correctKey: undefined, correctAnswerText: undefined, answerEvidenceSnippet: [draft.answerEvidenceSnippet, keyEvidence(key)].filter(Boolean).join("\n"), needsReview: true };
    }
    if (draft.correctKey && entries.get(num)?.letter !== "?" && draft.answerEvidence) {
      matched++;
      return { ...draft, needsReview: true, confidence: "medium" as const,
        warnings: [...draft.warnings, "A separately selected numbered answer key has not been proven to belong to this exact question; confirm the original before scoring."],
        answerEvidenceSnippet: [draft.answerEvidenceSnippet ?? draft.answerEvidence, keyEvidence(key)].filter(Boolean).join("\n"),
        parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "answer.separate-source-needs-verification"])] };
    }
    return draft;
  });
  const unmatchedNumbers = [...entries.keys()].filter(num => !counts.has(num));
  if (unmatchedNumbers.length) warnings.push(`${unmatchedNumbers.length} answer-key numbers have no unique matching source question (${unmatchedNumbers.slice(0, 12).join(", ")}).`);
  if (conflicted) warnings.push(`${conflicted} question-to-answer mappings conflict or have duplicate question numbers; no conflicting answer was accepted.`);
  return { value, matched, conflicted, unmatchedNumbers, warnings };
}

/** Reconcile numbered printed-key records with block-preserving Word/PDF questions.
 * Source conflicts retain their prior key as evidence BUT block scored practice.
 * Ambiguous or duplicate question numbers are never auto-resolved. */
export function pairPackageAnswers(pkg: ImportPackage, issues: readonly PackageIssue[], text: string, key: SeparateKeyContext):
    SeparateKeyResult<{ pkg: ImportPackage; issues: PackageIssue[] }> {
  const entries = safeEntries(text);
  const warnings = [keyEvidence(key)];
  if (!entries.size) return { value: { pkg, issues: [...issues] }, matched: 0, conflicted: 0, unmatchedNumbers: [],
    warnings: [...warnings, "No numbered answer key was recognized. All original evidence remains unchanged."] };
  const counts = new Map<number, number>();
  for (const q of pkg.questions) if (q.source.questionNumber !== undefined)
    counts.set(q.source.questionNumber, (counts.get(q.source.questionNumber) ?? 0) + 1);
  let matched = 0, conflicted = 0;
  const questions = pkg.questions.map((question): PackageQuestion => {
    const number = question.source.questionNumber;
    const entry = number === undefined ? undefined : entries.get(number);
    if (!entry) return question;
    const meta = keyEvidence(key);
    const provenance = { ...question.provenance, notes: [question.provenance.notes, meta].filter(Boolean).join("\n") };
    const original = question.correctAnswer?.labels ?? [];
    const labels = question.choices.map(choice => choice.label);
    const claim = entry.letter;
    const ambiguous = (counts.get(number!) ?? 0) !== 1 || !claim || claim === "?" || !labels.includes(claim)
      || Boolean(entry.answerText); // prose must go through human review, not a naïve label guess
    const disagree = original.length > 0 && (original.length !== 1 || original[0] !== claim);
    if (ambiguous || disagree) {
      conflicted++;
      const note = `Separate key ${key.name} conflicts with or cannot uniquely identify question ${number}. ${original.length ? `Original key: ${original.join(", ")}. ` : ""}Separate key claim: ${claim ?? "unknown"}. Check the original sources.`;
      return { ...question, provenance, flags: [...(question.flags ?? []), { type: "source_inconsistency", message: note }] };
    }
    matched++;
    const originallyVerified = original.length === 1 && original[0] === claim
      && ["printed-key", "reviewer"].includes(question.correctAnswer?.evidence ?? "")
      && !(question.flags ?? []).some(flag => flag.type === "answer_needs_review");
    if (originallyVerified) return { ...question, provenance }; // Existing stronger evidence wins.
    return { ...question, provenance, correctAnswer: { labels: [claim!], evidence: "printed-key" },
      flags: [...(question.flags ?? []).filter(flag => flag.type !== "answer_needs_review"), {
        type: "answer_needs_review",
        message: "Number-only association to a separate answer-key document is provisional. Confirm this question and the key against the original source before scored practice.",
      }] };
  });
  const unmatchedNumbers = [...entries.keys()].filter(number => !counts.has(number));
  if (unmatchedNumbers.length) warnings.push(`Answer-key numbers not found in source: ${unmatchedNumbers.slice(0, 12).join(", ")}.`);
  if (conflicted) warnings.push(`${conflicted} mappings need review because the key is ambiguous or conflicts with the source.`);
  return { value: { pkg: { ...pkg, questions }, issues: [...issues] }, matched, conflicted, unmatchedNumbers, warnings };
}
