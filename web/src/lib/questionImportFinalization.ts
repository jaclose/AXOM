import type { QuestionSet, SourceDocument } from "./library";
import { assertVaultWritesSince, getVaultWriteCheckpoint } from "./localVault";
import type { QuestionRecord } from "./questions";

type Awaitable<T> = T | Promise<T>;

export interface QuestionImportPersistence {
  /**
   * Preferred production path: validate and persist the complete reviewed
   * import as one workspace snapshot. The individual CRUD methods remain the
   * compatibility fallback for narrow adapters and component tests.
   */
  commitReviewedImport?(plan: ReviewedImportPersistencePlan): Awaitable<ReviewedImportPersistenceResult>;
  addQuestion(input: unknown): Awaitable<{ ok: boolean; errors: string[]; id?: string }>;
  removeQuestion(id: string): Awaitable<void>;
  addQuestionSet(set: QuestionSet): Awaitable<void>;
  removeQuestionSet(id: string): Awaitable<void>;
  addDocument(document: SourceDocument): Awaitable<void>;
  updateDocument(id: string, patch: Partial<SourceDocument>): Awaitable<void>;
  removeDocument(id: string): Awaitable<void>;
}

export interface ReviewedQuestionInput extends Record<string, unknown> {
  id: string;
  source?: QuestionRecord["source"];
  stem: string;
  options: QuestionRecord["options"];
  correctKey?: string;
  explanation?: string;
  choiceRationales?: QuestionRecord["choiceRationales"];
  topic?: string;
  system?: string;
  objective?: string;
  category?: string;
  bank?: string;
  sourceDocumentId?: string;
  sourceFile?: QuestionRecord["sourceFile"];
  questionNumber?: number;
  sourcePage?: number;
  examType?: QuestionRecord["examType"];
  difficulty?: QuestionRecord["difficulty"];
  citation?: string;
  tags?: string[];
}

export type ImportDocumentWrite =
  | { kind: "create"; document: SourceDocument }
  | { kind: "update"; id: string; patch: Partial<SourceDocument>; original: SourceDocument };

export interface ReviewedImportPersistencePlan {
  questions: ReviewedQuestionInput[];
  questionSet?: QuestionSet;
  documentWrite?: ImportDocumentWrite;
}

export type ReviewedImportPersistenceResult =
  | { ok: true; questionIds: string[]; questionSetId?: string; documentId?: string }
  | { ok: false; message: string; rollbackFailures: string[] };

export interface CoordinatedReviewedImportResult {
  result: ReviewedImportPersistenceResult;
  /** True when this caller joined an identical write already in progress. */
  joined: boolean;
}

class ImportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportWriteError";
  }
}

async function awaitDurable<T>(operation: () => Awaitable<T>): Promise<T> {
  const checkpoint = getVaultWriteCheckpoint();
  const result = await operation();
  assertVaultWritesSince(checkpoint);
  return result;
}

/**
 * Persist one reviewed import through the existing store actions and wait for
 * every underlying vault write. Cleanup is best-effort and exhaustive: one
 * failed rollback step never prevents the remaining records from being
 * removed, and the caller receives an explicit list when cleanup was not
 * durably confirmed.
 */
export async function persistReviewedImport(
  persistence: QuestionImportPersistence,
  plan: ReviewedImportPersistencePlan,
): Promise<ReviewedImportPersistenceResult> {
  if (persistence.commitReviewedImport) {
    return persistence.commitReviewedImport(plan);
  }

  const attemptedQuestionIds: string[] = [];
  const savedQuestionIds: string[] = [];
  let setAttempted = false;
  let documentAttempted = false;

  try {
    for (const question of plan.questions) {
      attemptedQuestionIds.push(question.id);
      const result = await awaitDurable(() => persistence.addQuestion(question));
      if (!result.ok || !result.id) {
        throw new ImportWriteError(
          result.errors.slice(0, 2).join(" ") || "AXOM could not persist the reviewed questions.",
        );
      }
      attemptedQuestionIds[attemptedQuestionIds.length - 1] = result.id;
      savedQuestionIds.push(result.id);
    }

    if (plan.questionSet) {
      setAttempted = true;
      await awaitDurable(() => persistence.addQuestionSet({
        ...plan.questionSet!,
        questionIds: [...savedQuestionIds],
      }));
    }

    const documentWrite = plan.documentWrite;
    if (documentWrite?.kind === "create") {
      documentAttempted = true;
      await awaitDurable(() => persistence.addDocument(documentWrite.document));
    } else if (documentWrite?.kind === "update") {
      documentAttempted = true;
      await awaitDurable(() => persistence.updateDocument(
        documentWrite.id,
        documentWrite.patch,
      ));
    }

    return {
      ok: true,
      questionIds: savedQuestionIds,
      questionSetId: plan.questionSet?.id,
      documentId: plan.documentWrite?.kind === "create"
        ? plan.documentWrite.document.id
        : plan.documentWrite?.id,
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    const rollback = async (label: string, operation: () => Awaitable<void>) => {
      try {
        await awaitDurable(operation);
      } catch {
        rollbackFailures.push(label);
      }
    };

    const documentWrite = plan.documentWrite;
    if (documentAttempted && documentWrite?.kind === "create") {
      await rollback("source document", () => persistence.removeDocument(documentWrite.document.id));
    } else if (documentAttempted && documentWrite?.kind === "update") {
      await rollback("source-document link", () => persistence.updateDocument(
        documentWrite.id,
        documentWrite.original,
      ));
    }
    if (setAttempted && plan.questionSet) {
      await rollback("question set", () => persistence.removeQuestionSet(plan.questionSet!.id));
    }
    for (const id of [...attemptedQuestionIds].reverse()) {
      await rollback(`question ${id}`, () => persistence.removeQuestion(id));
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : "AXOM could not persist the reviewed import.",
      rollbackFailures,
    };
  }
}

const comparableQuestion = (question: ReviewedQuestionInput | QuestionRecord) => ({
  source: question.source,
  stem: question.stem.trim(),
  options: question.options.map((option) => ({ key: option.key.trim().toUpperCase(), text: option.text.trim() })),
  correctKey: question.correctKey?.trim().toUpperCase(),
  explanation: question.explanation?.trim() || undefined,
  choiceRationales: question.choiceRationales,
  topic: question.topic?.trim() || undefined,
  system: question.system?.trim() || undefined,
  objective: question.objective?.trim() || undefined,
  category: question.category?.trim() || undefined,
  bank: question.bank?.trim() || undefined,
  sourceDocumentId: question.sourceDocumentId,
  sourceFile: question.sourceFile
    ? { name: question.sourceFile.name, type: question.sourceFile.type, size: question.sourceFile.size }
    : undefined,
  questionNumber: question.questionNumber,
  sourcePage: question.sourcePage,
  examType: question.examType,
  difficulty: question.difficulty,
  citation: question.citation?.trim() || undefined,
  tags: [...(question.tags ?? [])],
});

const inFlightReviewedImports = new Map<string, Promise<ReviewedImportPersistenceResult>>();
type AtomicReviewedImportCommit = NonNullable<QuestionImportPersistence["commitReviewedImport"]>;
const reviewedImportCommitQueues = new WeakMap<AtomicReviewedImportCommit, Promise<void>>();

/**
 * Tentative Zustand state can look equivalent before its vault write is
 * durable. Callers use this synchronous guard to distinguish that state from
 * an import that completed in an earlier interaction.
 */
export function isReviewedImportInFlight(fingerprint: string): boolean {
  return inFlightReviewedImports.has(fingerprint);
}

/**
 * Serialize production atomic commits that share the same store action. This
 * keeps one failed transaction's targeted rollback from interleaving with a
 * second reviewed-import transaction. Narrow CRUD adapters intentionally keep
 * their established fallback behavior.
 */
function persistReviewedImportInOrder(
  persistence: QuestionImportPersistence,
  plan: ReviewedImportPersistencePlan,
): Promise<ReviewedImportPersistenceResult> {
  const commit = persistence.commitReviewedImport;
  if (!commit) return persistReviewedImport(persistence, plan);

  const preceding = reviewedImportCommitQueues.get(commit);
  const pending = preceding
    ? preceding.then(() => persistReviewedImport(persistence, plan))
    : persistReviewedImport(persistence, plan);
  const tail = pending.then(
    () => undefined,
    () => undefined,
  );
  reviewedImportCommitQueues.set(commit, tail);
  void tail.then(() => {
    if (reviewedImportCommitQueues.get(commit) === tail) {
      reviewedImportCommitQueues.delete(commit);
    }
  });
  return pending;
}

/**
 * Build a deterministic identity without transient record IDs or timestamps.
 * This is deliberately exact-content protection, not semantic duplicate
 * detection: a changed title, destination, source identity, or reviewed field
 * remains a distinct import.
 */
export function reviewedImportFingerprint(input: {
  title: string;
  destination: "set" | "doc" | "both";
  sourceIdentity?: string;
  candidates: readonly ReviewedQuestionInput[];
}): string {
  return JSON.stringify({
    title: input.title.trim(),
    destination: input.destination,
    sourceIdentity: input.sourceIdentity,
    candidates: input.candidates.map((candidate) => ({
      ...comparableQuestion(candidate),
      sourceDocumentId: undefined,
    })),
  });
}

/**
 * Share an identical write across mounted ImportPanel instances. Component-
 * local guards stop rapid clicks; this coordinator also covers navigation or
 * remount while the first durable transaction is still pending.
 */
export async function persistReviewedImportOnce(
  fingerprint: string,
  persistence: QuestionImportPersistence,
  plan: ReviewedImportPersistencePlan,
): Promise<CoordinatedReviewedImportResult> {
  const existing = inFlightReviewedImports.get(fingerprint);
  if (existing) return { result: await existing, joined: true };

  let resolvePending!: (result: ReviewedImportPersistenceResult) => void;
  let rejectPending!: (reason?: unknown) => void;
  const pending = new Promise<ReviewedImportPersistenceResult>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  // Publish the guard before the store action can expose tentative state to a
  // synchronous subscriber. This prevents that state from masquerading as a
  // previously completed equivalent import.
  inFlightReviewedImports.set(fingerprint, pending);
  void persistReviewedImportInOrder(persistence, plan).then(resolvePending, rejectPending);
  try {
    return { result: await pending, joined: false };
  } finally {
    if (inFlightReviewedImports.get(fingerprint) === pending) {
      inFlightReviewedImports.delete(fingerprint);
    }
  }
}

/** Find a prior, exact reviewed import so navigation/retry cannot duplicate it. */
export function findEquivalentReviewedSet(input: {
  sets: readonly QuestionSet[];
  questions: readonly QuestionRecord[];
  title: string;
  sourceDocumentId?: string;
  candidates: readonly ReviewedQuestionInput[];
}): { set: QuestionSet; questionIds: string[] } | undefined {
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));
  const expected = input.candidates.map(comparableQuestion);

  for (const set of input.sets) {
    if (set.title.trim() !== input.title.trim()) continue;
    if (input.sourceDocumentId) {
      if (!set.sourceDocumentIds.includes(input.sourceDocumentId)) continue;
    } else if (set.sourceDocumentIds.length > 0) {
      continue;
    }
    if (set.questionIds.length !== expected.length) continue;
    const stored = set.questionIds.map((id) => questionsById.get(id));
    if (stored.some((question) => !question)) continue;
    const same = stored.every((question, index) => (
      JSON.stringify(comparableQuestion(question!)) === JSON.stringify(expected[index])
    ));
    if (same) return { set, questionIds: [...set.questionIds] };
  }
  return undefined;
}
