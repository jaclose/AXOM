import type { SourceDocument } from "./library";
import { analysisIsCurrent, type QuestionAnalysis } from "./decode";
import { questionMappingStatus, type QuestionRecord } from "./questions";

export interface QuestionTeachingCoverage {
  ready: number;
  withExplanation: number;
  withCompleteChoiceTeaching: number;
  withReviewedDepth: number;
  withTeachingVisuals: number;
  proposalsToReview: number;
  improvementQueueIds: string[];
}
function hasExplanation(question: QuestionRecord): boolean {
  return Boolean(question.explanation?.trim() || question.content?.explanation?.length);
}

const CHECKED_PACKAGE_TEACHING = /^package-teaching-v\d+:(?:SOURCE_CHECKED|INDEPENDENTLY_CHECKED)$/;

function normalizedKey(value: string | undefined): string | undefined {
  const key = value?.normalize("NFKC").trim().toUpperCase();
  return key || undefined;
}

function isCheckedPackageTeaching(analysis: QuestionAnalysis): boolean {
  return analysis.origin === "source" && CHECKED_PACKAGE_TEACHING.test(analysis.promptVersion ?? "");
}

function isCurrentForCoverage(
  analysis: QuestionAnalysis,
  question: QuestionRecord,
  document?: Pick<SourceDocument, "id" | "checksum" | "pageTexts">,
): boolean {
  if (analysisIsCurrent(analysis, question, document)) return true;
  // Package teaching was historically fingerprinted before its source
  // document was written. Accept that exact legacy fingerprint only for the
  // strictly materialized, source-checked package format.
  return isCheckedPackageTeaching(analysis) && analysisIsCurrent(analysis, question);
}

function currentAnalyses(
  question: QuestionRecord,
  document?: Pick<SourceDocument, "id" | "checksum" | "pageTexts">,
): QuestionAnalysis[] {
  return (question.analyses ?? []).filter((analysis) => (
    analysis.status !== "rejected" && isCurrentForCoverage(analysis, question, document)
  ));
}

function analysisExplainsEveryChoice(question: QuestionRecord, analysis: QuestionAnalysis): boolean {
  const correctKey = normalizedKey(question.correctKey);
  const optionKeys = question.options.flatMap((option) => {
    const key = normalizedKey(option.key);
    return key ? [key] : [];
  });
  if (!correctKey || question.options.length < 2 || optionKeys.length !== question.options.length || !optionKeys.includes(correctKey)) return false;
  if (!analysis.explanation?.trim()) return false;
  const explained = new Set(analysis.distractors.flatMap((entry) => {
    const key = normalizedKey(entry.key);
    return key && entry.whyWrong.trim() ? [key] : [];
  }));
  return optionKeys.every((key) => key === correctKey || explained.has(key));
}

function questionExplainsEveryChoice(question: QuestionRecord): boolean {
  if (!question.correctKey || question.options.length < 2) return false;
  return question.options.every((option) => Boolean(
    question.choiceRationales?.[option.key]?.trim()
    || (option.key === question.correctKey && hasExplanation(question)),
  ));
}

function hasTeachingVisual(question: QuestionRecord): boolean {
  return Boolean(question.content?.assets.some((asset) => (
    asset.role === "explanation" || asset.role === "answer_reveal" || asset.role === "reference"
  )));
}

/**
 * Deterministic content QA for the additive teaching layer. Readiness remains
 * an answer-evidence decision; this summary never promotes or changes a key.
 */
export function summarizeQuestionTeachingCoverage(
  questions: readonly QuestionRecord[],
  documents: readonly Pick<SourceDocument, "id" | "checksum" | "pageTexts">[] = [],
): QuestionTeachingCoverage {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const ready = questions.filter((question) => questionMappingStatus(question) === "ready");
  const rows = ready.map((question) => {
    const document = question.sourceDocumentId ? documentsById.get(question.sourceDocumentId) : undefined;
    const analyses = currentAnalyses(question, document);
    const proposals = analyses.filter((analysis) => analysis.status === "proposed");
    // Reviewed analyses may contribute teaching. Proposed content contributes
    // only when it came through the strict source-checked package materializer;
    // it remains a proposal and therefore never increases reviewed depth.
    const availableTeaching = analyses.filter((analysis) => (
      analysis.status === "reviewed" || isCheckedPackageTeaching(analysis)
    ));
    const explanation = hasExplanation(question) || availableTeaching.some((analysis) => Boolean(analysis.explanation?.trim()));
    const choices = questionExplainsEveryChoice(question)
      || availableTeaching.some((analysis) => analysisExplainsEveryChoice(question, analysis));
    const reviewed = analyses.some((analysis) => analysis.status === "reviewed");
    const visuals = hasTeachingVisual(question);
    const gapScore = Number(!explanation) * 8 + Number(!choices) * 4 + Number(proposals.length > 0) * 2 + Number(!reviewed);
    return { question, explanation, choices, reviewed, proposals: proposals.length, visuals, gapScore };
  });
  return {
    ready: ready.length,
    withExplanation: rows.filter((row) => row.explanation).length,
    withCompleteChoiceTeaching: rows.filter((row) => row.choices).length,
    withReviewedDepth: rows.filter((row) => row.reviewed).length,
    withTeachingVisuals: rows.filter((row) => row.visuals).length,
    proposalsToReview: rows.reduce((total, row) => total + row.proposals, 0),
    improvementQueueIds: rows
      .filter((row) => row.gapScore > 0)
      .sort((left, right) => right.gapScore - left.gapScore || left.question.id.localeCompare(right.question.id))
      .map((row) => row.question.id),
  };
}
