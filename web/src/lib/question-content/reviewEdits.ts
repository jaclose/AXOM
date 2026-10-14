import { sanitizeRichText, type QuestionBlock, type TableBlock } from "./blocks";
import type { ImportPackage, PackageIssue, PackageQuestion } from "./package";

export type ReviewSection = "stem" | "choice" | "explanation";
export interface ReviewBlockLocation { section: ReviewSection; choiceId?: string; index: number; }

const ANSWER_RECHECK_NOTE = "A reviewer edited the extracted content. Confirm the correct answer against the original source before scored practice.";

/** Any material edit makes a formerly verified answer provisional again. */
function requireAnswerRecheck(question: PackageQuestion): PackageQuestion {
  const { correctAnswer: _previousAnswer, ...withoutAnswer } = question;
  return { ...withoutAnswer, flags: [
    ...(question.flags ?? []).filter(flag => flag.type !== "answer_needs_review"),
    { type: "answer_needs_review", message: ANSWER_RECHECK_NOTE },
  ] };
}

/** Edit only the selected supported block, preserving images, tables and block order. */
export function editReviewedBlock(pkg: ImportPackage, questionId: string, where: ReviewBlockLocation, value: string): ImportPackage {
  if (value.length > 50_000) throw new Error("A single edited field cannot exceed 50,000 characters. Split this content before importing.");
  let matched = false;
  const questions = pkg.questions.map(question => {
    if (question.id !== questionId) return question;
    const choice = where.section === "choice" ? question.choices.find(item => item.id === where.choiceId) : undefined;
    if (where.section === "choice" && !choice) throw new Error("The selected answer choice no longer exists.");
    const blocks = where.section === "stem" ? question.stem : where.section === "explanation" ? question.explanation ?? [] : choice!.blocks;
    const block = blocks[where.index];
    if (!block) throw new Error("The selected text block no longer exists.");
    let updated: QuestionBlock;
    switch (block.type) {
      case "text": updated = { ...block, text: value }; break;
      case "rich_text": updated = { ...block, html: sanitizeRichText(value) }; break;
      case "callout": updated = { ...block, text: value }; break;
      default: throw new Error("This source block is structured media. Edit its table cells separately or correct the original document.");
    }
    if (JSON.stringify(updated) === JSON.stringify(block)) return question;
    matched = true;
    const patched = [...blocks]; patched[where.index] = updated;
    const modified = where.section === "stem" ? { ...question, stem: patched }
      : where.section === "explanation" ? { ...question, explanation: patched }
      : { ...question, choices: question.choices.map(item => item.id === where.choiceId ? { ...item, blocks: patched } : item) };
    return requireAnswerRecheck(modified);
  });
  if (!pkg.questions.some(question => question.id === questionId)) throw new Error("The selected question no longer exists.");
  return matched ? { ...pkg, questions } : pkg;
}

/** Correct one table cell/header without flattening anatomical or lab tables. */
export function editReviewedTableCell(pkg: ImportPackage, questionId: string, where: ReviewBlockLocation | "choiceTable",
  position: { row: number; column: number } | { header: number }, value: string): ImportPackage {
  if (value.length > 5000) throw new Error("An edited table cell cannot exceed 5,000 characters.");
  let matched = false;
  const questions = pkg.questions.map(question => {
    if (question.id !== questionId) return question;
    const blocks = where === "choiceTable" ? [] : where.section === "stem" ? question.stem
      : where.section === "explanation" ? question.explanation ?? [] : question.choices.find(c => c.id === where.choiceId)?.blocks ?? [];
    const block = where === "choiceTable" ? question.choiceTable : blocks[where.index];
    if (!block || block.type !== "table") throw new Error("The selected table is no longer available.");
    let table: TableBlock;
    if ("header" in position) {
      if (!block.headers || position.header < 0 || position.header >= block.headers.length) throw new Error("Invalid header position.");
      const headers = [...block.headers]; headers[position.header] = value;
      table = { ...block, headers };
    } else {
      const row = block.rows[position.row];
      if (!row || position.column < 0 || position.column >= row.length) throw new Error("Invalid table cell.");
      const rows = block.rows.map((old, index) => index === position.row ? old.map((cell, i) => i === position.column ? value : cell) : old);
      table = { ...block, rows };
    }
    if (JSON.stringify(table) === JSON.stringify(block)) return question;
    matched = true;
    if (where === "choiceTable") return requireAnswerRecheck({ ...question, choiceTable: table });
    const updated = [...blocks]; updated[where.index] = table;
    const modified = where.section === "stem" ? { ...question, stem: updated }
      : where.section === "explanation" ? { ...question, explanation: updated }
      : { ...question, choices: question.choices.map(c => c.id === where.choiceId ? { ...c, blocks: updated } : c) };
    return requireAnswerRecheck(modified);
  });
  if (!pkg.questions.some(question => question.id === questionId)) throw new Error("The selected question no longer exists.");
  return matched ? { ...pkg, questions } : pkg;
}

/** A reviewer-confirmed key resolves stale extraction guesses, not structural errors. */
const ANSWER_ONLY_ISSUES = new Set(["answer_needs_review", "missing_answer_key", "possible_answer_marking"]);
export function unresolvedExtractionIssues(issues: readonly PackageIssue[], explicitlyConfirmed: ReadonlySet<string>): PackageIssue[] {
  return issues.filter(issue => !(issue.questionId && explicitlyConfirmed.has(issue.questionId) && ANSWER_ONLY_ISSUES.has(issue.code)));
}
