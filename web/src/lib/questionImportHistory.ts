// ===========================================================================
// Has this file been imported before? Importing is something a learner does
// again and again with the same folder, so the answer decides what a second
// import may add.
//
// A file is known by its bytes (its checksum). A file with the same name and
// different bytes is another version of it. In both cases the questions that
// came in last time are found again by their wording (stem and options), which
// is the one thing an import fixes: everything else on a question (its week,
// tags, explanation, attempts) is the learner's to change afterwards, so none
// of it is compared and none of it is touched.
// ===========================================================================
import type { QuestionSet, SourceDocument } from "./library";
import { questionSignature } from "./questionDuplicates";
import type { QuestionOption, QuestionRecord } from "./questions";

export interface ImportLibrary {
  questions: readonly QuestionRecord[];
  questionSets: readonly QuestionSet[];
  documents: readonly SourceDocument[];
}

export interface PriorImport {
  document: SourceDocument;
  /** The same bytes, or the same name with different bytes. */
  relation: "same-file" | "other-version";
  /** The sets that import made, still in the library. */
  sets: QuestionSet[];
  /** Questions that came from the document and are still in the bank. */
  questions: QuestionRecord[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The earlier import of this file, if its questions are still in the bank. A
 * source kept without questions, or one whose questions were all deleted, is
 * not an earlier import: bringing the file in again is the way to get them.
 */
export function findPriorImport(
  file: { checksum?: string; fileName: string },
  library: ImportLibrary,
): PriorImport | undefined {
  const withQuestions = (document: SourceDocument, relation: PriorImport["relation"]): PriorImport | undefined => {
    const questions = library.questions.filter((question) => question.sourceDocumentId === document.id);
    if (!questions.length) return undefined;
    return { document, relation, questions, sets: library.questionSets.filter((set) => set.sourceDocumentIds.includes(document.id)) };
  };
  if (file.checksum) {
    for (const document of library.documents) {
      if (document.checksum !== file.checksum) continue;
      const prior = withQuestions(document, "same-file");
      if (prior) return prior;
    }
  }
  const sameName = library.documents
    .filter((document) => nameKey(document.fileName) === nameKey(file.fileName) && (!file.checksum || document.checksum !== file.checksum))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  for (const document of sameName) {
    const prior = withQuestions(document, "other-version");
    if (prior) return prior;
  }
  return undefined;
}

/** Which of these questions the earlier import already brought in, by wording. */
export function alreadyImported(
  drafts: ReadonlyArray<{ stem: string; options: QuestionOption[] }>,
  prior: PriorImport,
): boolean[] {
  const known = new Set(prior.questions.map(questionSignature));
  return drafts.map((draft) => known.has(questionSignature(draft)));
}

export const ALREADY_IMPORTED_RULE = "duplicate.already-imported";

/** What to tell the learner at the top of the review, in plain words. */
export function priorImportNote(prior: PriorImport, already: number, total: number): string {
  const when = prior.document.uploadedAt.slice(0, 10);
  const setName = prior.sets[0]?.title;
  const where = setName ? ` as "${setName}"` : "";
  const fresh = total - already;
  const lead = prior.relation === "same-file"
    ? `This file was imported on ${when}${where}.`
    : `A different version of this file was imported on ${when}${where}.`;
  if (already === 0) return `${lead} None of these questions match the ones it brought in.`;
  const rest = fresh === 0
    ? "Every question here is already in your bank, so none is selected."
    : `${already} of these ${total} questions ${already === 1 ? "is" : "are"} already in your bank and ${already === 1 ? "is" : "are"} not selected. ${fresh} ${fresh === 1 ? "is" : "are"} new.`;
  return `${lead} ${rest} What you have changed on the earlier questions is left as it is.`;
}

/**
 * Mark what an earlier import already brought in. Those questions stay in the
 * review, unselected, each saying why, so the learner sees them and can take
 * one again on purpose. Nothing is decided for a source the learner re-opened
 * from the library themselves (`existingDocumentId`): that is its own action.
 */
export function applyPriorImport<T extends { stem: string; options: QuestionOption[]; warnings: string[]; parserRuleIds?: string[] }>(
  drafts: readonly T[],
  file: { checksum?: string; fileName: string; existingDocumentId?: string } | null | undefined,
  library: ImportLibrary,
): { drafts: T[]; selected: boolean[]; prior?: PriorImport; note?: string } {
  const all = () => drafts.map(() => true);
  if (!file || file.existingDocumentId) return { drafts: [...drafts], selected: all() };
  const prior = findPriorImport(file, library);
  if (!prior) return { drafts: [...drafts], selected: all() };
  const known = alreadyImported(drafts, prior);
  const already = known.filter(Boolean).length;
  return {
    prior,
    selected: known.map((isKnown) => !isKnown),
    note: priorImportNote(prior, already, drafts.length),
    drafts: drafts.map((draft, index) => (known[index]
      ? {
          ...draft,
          parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), ALREADY_IMPORTED_RULE])],
          warnings: [...draft.warnings, "This question is already in your bank from an earlier import of this file, so it is not selected. Select it only to bring in a second copy."],
        }
      : draft)),
  };
}

