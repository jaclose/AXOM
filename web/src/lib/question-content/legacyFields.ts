// ===========================================================================
// The plain-text reading of a block question, in the shape `QuestionRecord`
// has always had. Search, duplicate detection, annotations, the course bank
// and the review engine read these strings, so a question with a table and a
// figure still works everywhere a text-only question does.
// ===========================================================================
import type { QuestionOption } from "../questions";
import { blocksToPlainText } from "./blocks";
import { questionScope, type PackageManifest, type PackageQuestion } from "./package";

export interface LegacyQuestionFields {
  stem: string;
  options: QuestionOption[];
  /** Absent when there is no key, or when the key names more than one choice. */
  correctKey?: string;
  explanation?: string;
  module: string;
  week: number;
  bank: string;
  topic?: string;
  questionNumber?: number;
  sourcePage?: number;
}

function choiceText(question: PackageQuestion, label: string, blocks: PackageQuestion["choices"][number]["blocks"]): string {
  if (blocks.length) return blocksToPlainText(blocks);
  const table = question.choiceTable;
  const row = table?.rowKeys ? table.rows[table.rowKeys.indexOf(label)] : undefined;
  if (!table || !row) return "";
  return row.map((cell, index) => (table.headers?.[index] ? `${table.headers[index]} ${cell}` : cell)).join("; ");
}

export function legacyQuestionFields(manifest: PackageManifest, question: PackageQuestion): LegacyQuestionFields {
  const scope = questionScope(manifest, question);
  const labels = question.correctAnswer?.labels ?? [];
  const explanation = question.explanation?.length ? blocksToPlainText(question.explanation) : undefined;
  return {
    stem: blocksToPlainText(question.stem),
    options: question.choices.map((choice) => ({ key: choice.label, text: choiceText(question, choice.label, choice.blocks) })),
    ...(labels.length === 1 ? { correctKey: labels[0] } : {}),
    ...(explanation ? { explanation } : {}),
    module: scope.course,
    week: scope.week,
    bank: manifest.bank.title,
    ...(scope.topic ? { topic: scope.topic } : {}),
    ...(question.source.questionNumber !== undefined ? { questionNumber: question.source.questionNumber } : {}),
    ...(question.source.page !== undefined ? { sourcePage: question.source.page } : {}),
  };
}
