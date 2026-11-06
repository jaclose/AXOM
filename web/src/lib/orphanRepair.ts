// ===========================================================================
// Orphan repair (rehaul phase 9) — a pure integrity pass over the question-bank
// graph. It NEVER deletes questions/attempts; it only fixes dangling links:
//   - questions pointing at a set/document that no longer exists → unlinked
//   - question sets whose sourceDocumentIds point at missing documents → pruned
//   - question sets referencing questionIds that no longer exist → pruned
//   - documents' linkedQuestionSetIds pointing at missing sets → pruned
// Returns a report so the UI can show what (if anything) it repaired.
// ===========================================================================
import type { AxomState } from "./types";
import type { QuestionRecord } from "./questions";
import type { QuestionSet, SourceDocument } from "./library";

export interface OrphanReport {
  questionsUnlinkedFromSet: number;
  questionsUnlinkedFromDocument: number;
  setsWithPrunedDocuments: number;
  setsWithPrunedQuestions: number;
  documentsWithPrunedSets: number;
  totalIssues: number;
}

export interface OrphanRepairResult {
  report: OrphanReport;
  questions: QuestionRecord[];
  questionSets: QuestionSet[];
  documents: SourceDocument[];
}

export function findOrphans(state: Pick<AxomState, "questions" | "questionSets" | "documents">): OrphanReport {
  const questions = state.questions ?? [];
  const sets = state.questionSets ?? [];
  const documents = state.documents ?? [];
  const setIds = new Set(sets.map((s) => s.id));
  const docIds = new Set(documents.map((d) => d.id));
  const questionIds = new Set(questions.map((q) => q.id));

  const report: OrphanReport = {
    questionsUnlinkedFromSet: questions.filter((q) => q.setId && !setIds.has(q.setId)).length,
    questionsUnlinkedFromDocument: questions.filter((q) => q.sourceDocumentId && !docIds.has(q.sourceDocumentId)).length,
    setsWithPrunedDocuments: sets.filter((s) => s.sourceDocumentIds.some((id) => !docIds.has(id))).length,
    setsWithPrunedQuestions: sets.filter((s) => s.questionIds.some((id) => !questionIds.has(id))).length,
    documentsWithPrunedSets: documents.filter((d) => d.linkedQuestionSetIds.some((id) => !setIds.has(id))).length,
    totalIssues: 0,
  };
  report.totalIssues =
    report.questionsUnlinkedFromSet + report.questionsUnlinkedFromDocument +
    report.setsWithPrunedDocuments + report.setsWithPrunedQuestions + report.documentsWithPrunedSets;
  return report;
}

export function repairOrphans(state: Pick<AxomState, "questions" | "questionSets" | "documents">): OrphanRepairResult {
  const questions = state.questions ?? [];
  const sets = state.questionSets ?? [];
  const documents = state.documents ?? [];
  const setIds = new Set(sets.map((s) => s.id));
  const docIds = new Set(documents.map((d) => d.id));
  const questionIds = new Set(questions.map((q) => q.id));
  const report = findOrphans(state);

  const repairedQuestions = questions.map((q) => {
    const setId = q.setId && !setIds.has(q.setId) ? undefined : q.setId;
    const sourceDocumentId = q.sourceDocumentId && !docIds.has(q.sourceDocumentId) ? undefined : q.sourceDocumentId;
    return setId === q.setId && sourceDocumentId === q.sourceDocumentId ? q : { ...q, setId, sourceDocumentId };
  });

  const repairedSets = sets.map((s) => {
    const sourceDocumentIds = s.sourceDocumentIds.filter((id) => docIds.has(id));
    const cleanQuestionIds = s.questionIds.filter((id) => questionIds.has(id));
    return sourceDocumentIds.length === s.sourceDocumentIds.length && cleanQuestionIds.length === s.questionIds.length
      ? s
      : { ...s, sourceDocumentIds, questionIds: cleanQuestionIds };
  });

  const repairedDocuments = documents.map((d) => {
    const linkedQuestionSetIds = d.linkedQuestionSetIds.filter((id) => setIds.has(id));
    return linkedQuestionSetIds.length === d.linkedQuestionSetIds.length ? d : { ...d, linkedQuestionSetIds };
  });

  return { report, questions: repairedQuestions, questionSets: repairedSets, documents: repairedDocuments };
}
