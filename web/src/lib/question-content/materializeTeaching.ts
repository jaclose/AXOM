import { ANALYSIS_LIMITS, type QuestionAnalysis, type SourceTrace } from "../decode/types";
import { questionSourceFingerprint } from "../decode/analysis";
import type { QuestionRecord } from "../questions";
import type { PackageTeaching } from "./package";

type MaterializedQuestion = Pick<QuestionRecord,
  "id" | "stem" | "options" | "correctKey" | "explanation" | "choiceRationales" | "objective"
  | "sourceDocumentId" | "sourcePage" | "extraction" | "topic" | "bank">;

const MATERIALIZABLE_FACT_CHECK = new Set<PackageTeaching["factCheck"]["status"]>([
  "SOURCE_CHECKED",
  "INDEPENDENTLY_CHECKED",
]);

const normalizedLabel = (value: string | undefined): string | undefined => {
  const label = value?.trim().toUpperCase();
  return label || undefined;
};

const comparableOptionText = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

function resolvedReferences(teaching: PackageTeaching): SourceTrace[] {
  const excerpts = new Map(
    (teaching.factCheck.supportingExcerpts ?? []).map((entry) => [`${entry.sourceId}\u0000${entry.pdfPage}`, entry.excerpt]),
  );
  const references: SourceTrace[] = [];
  for (const reference of teaching.sourceReferences) {
    // A sourceId is deliberately not treated as an AXOM document id. Only an
    // explicit bridge may produce a clickable QuestionAnalysis reference.
    if (!reference.documentId) continue;
    for (const page of reference.pdfPages) {
      references.push({
        documentId: reference.documentId,
        page,
        role: "teaching",
        ...(excerpts.get(`${reference.sourceId}\u0000${page}`)
          ? { quote: excerpts.get(`${reference.sourceId}\u0000${page}`)!.slice(0, ANALYSIS_LIMITS.quote) }
          : {}),
      });
      if (references.length === ANALYSIS_LIMITS.references) return references;
    }
  }
  return references;
}

/**
 * Turn source-checked package teaching into AXOM's additive analysis layer.
 * The source question is an input only: no wording, choice or answer field is
 * changed. A mismatch refuses the overlay rather than repairing either side.
 */
export function materializeTeachingAnalysis(input: {
  teaching: PackageTeaching | undefined;
  question: MaterializedQuestion;
  generatedAt: string;
}): QuestionAnalysis | undefined {
  const { teaching, question } = input;
  if (!teaching || teaching.version !== 1) return undefined;
  if (!MATERIALIZABLE_FACT_CHECK.has(teaching.factCheck.status)) return undefined;
  if (teaching.factCheck.answerChanged) return undefined;

  const correctKey = normalizedLabel(question.correctKey);
  const answerLabel = normalizedLabel(teaching.answerLabel);
  if (!correctKey || !answerLabel || answerLabel !== correctKey) return undefined;
  const evidenceLabel = normalizedLabel(teaching.factCheck.answerKeyEvidence?.printedAnswer);
  if (evidenceLabel && evidenceLabel !== answerLabel) return undefined;

  const optionsByKey = new Map(question.options.flatMap((option) => {
    const key = normalizedLabel(option.key);
    return key ? [[key, option] as const] : [];
  }));
  const expectedDistractors = new Set([...optionsByKey.keys()].filter((key) => key !== correctKey));
  const seenDistractors = new Set<string>();
  const distractors = teaching.distractors.flatMap((entry) => {
    const key = normalizedLabel(entry.label);
    const option = key ? optionsByKey.get(key) : undefined;
    if (!key || key === correctKey || !option || seenDistractors.has(key)) return [];
    if (entry.option && comparableOptionText(entry.option) !== comparableOptionText(option.text)) return [];
    seenDistractors.add(key);
    return [{ key, whyWrong: entry.explanation, ...(entry.wouldFitIf ? { wouldFitIf: entry.wouldFitIf } : {}) }];
  });
  // Partial or contradictory option teaching is kept in package metadata for
  // review, but never materialized as if it were a valid analysis.
  if (distractors.length !== teaching.distractors.length
    || expectedDistractors.size !== seenDistractors.size
    || [...expectedDistractors].some((key) => !seenDistractors.has(key))) return undefined;

  const concept = teaching.concept?.trim() || question.topic?.trim() || question.bank?.trim() || "Source teaching";
  const analysis: QuestionAnalysis = {
    id: `${question.id}:source-teaching:v${teaching.version}`,
    questionId: question.id,
    // This must be computed last, from the reviewed wording/key and final ids.
    sourceFingerprint: questionSourceFingerprint(question),
    version: 1,
    origin: "source",
    status: teaching.factCheck.humanReviewerApproved ? "reviewed" : "proposed",
    concept,
    rule: teaching.highYieldRule,
    explanation: teaching.whyCorrect,
    decisiveClues: [],
    mechanism: [teaching.mechanism],
    distractors,
    references: resolvedReferences(teaching),
    ...(teaching.factCheck.checkedBy ? { provider: teaching.factCheck.checkedBy } : {}),
    promptVersion: `package-teaching-v${teaching.version}:${teaching.factCheck.status}`,
    generatedAt: input.generatedAt,
  };
  return analysis;
}
