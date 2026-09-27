import { describe, expect, it, vi } from "vitest";
import type { QuestionSet, SourceDocument } from "./library";
import type { QuestionRecord } from "./questions";
import {
  findEquivalentReviewedSet,
  isReviewedImportInFlight,
  persistReviewedImport,
  persistReviewedImportOnce,
  reviewedImportFingerprint,
  type QuestionImportPersistence,
  type ReviewedImportPersistencePlan,
  type ReviewedQuestionInput,
} from "./questionImportFinalization";

const question = (id: string, stem = `Question ${id}?`): ReviewedQuestionInput => ({
  id,
  source: "imported",
  stem,
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B",
  explanation: "Beta is supported.",
  bank: "Reviewed set",
  sourceDocumentId: "doc-1",
  sourceFile: { name: "source.txt", type: "text", size: 100, addedAt: "2026-07-22T00:00:00.000Z" },
  questionNumber: 1,
  citation: "source.txt",
  tags: [],
});

const set: QuestionSet = {
  id: "set-1",
  title: "Reviewed set",
  sourceDocumentIds: ["doc-1"],
  createdAt: "2026-07-22T00:00:00.000Z",
  questionIds: ["q-1"],
  tags: [],
  aiEnhanced: false,
  parserWarnings: [],
};

const document: SourceDocument = {
  id: "doc-1",
  title: "Source",
  fileName: "source.txt",
  fileType: "text",
  uploadedAt: "2026-07-22T00:00:00.000Z",
  rawText: "Question source",
  sizeBytes: 100,
  tags: [],
  linkedQuestionSetIds: ["set-1"],
  libraryOnly: false,
};

function persistence(overrides: Partial<QuestionImportPersistence> = {}): QuestionImportPersistence {
  return {
    addQuestion: vi.fn(async (input) => ({ ok: true, errors: [], id: (input as ReviewedQuestionInput).id })),
    removeQuestion: vi.fn(async () => undefined),
    addQuestionSet: vi.fn(async () => undefined),
    removeQuestionSet: vi.fn(async () => undefined),
    addDocument: vi.fn(async () => undefined),
    updateDocument: vi.fn(async () => undefined),
    removeDocument: vi.fn(async () => undefined),
    ...overrides,
  };
}

function plan(questions = [question("q-1")]): ReviewedImportPersistencePlan {
  return {
    questions,
    questionSet: { ...set, questionIds: questions.map((item) => item.id) },
    documentWrite: { kind: "create", document },
  };
}

describe("reviewed import persistence transaction", () => {
  it("prefers one atomic reviewed-import commit when the adapter provides it", async () => {
    const expected = {
      ok: true as const,
      questionIds: ["q-1"],
      questionSetId: "set-1",
      documentId: "doc-1",
    };
    const commitReviewedImport = vi.fn(async () => expected);
    const api = persistence({ commitReviewedImport });
    const importPlan = plan();

    await expect(persistReviewedImport(api, importPlan)).resolves.toEqual(expected);
    expect(commitReviewedImport).toHaveBeenCalledOnce();
    expect(commitReviewedImport).toHaveBeenCalledWith(importPlan);
    expect(api.addQuestion).not.toHaveBeenCalled();
    expect(api.addQuestionSet).not.toHaveBeenCalled();
    expect(api.addDocument).not.toHaveBeenCalled();
  });

  it("removes successful question writes when a later question is rejected", async () => {
    const api = persistence({
      addQuestion: vi.fn()
        .mockResolvedValueOnce({ ok: true, errors: [], id: "q-1" })
        .mockResolvedValueOnce({ ok: false, errors: ["Second write failed"] }),
    });
    const result = await persistReviewedImport(api, plan([
      question("q-1", "First question?"),
      { ...question("q-2", "Second question?"), questionNumber: 2 },
    ]));

    expect(result).toEqual({ ok: false, message: "Second write failed", rollbackFailures: [] });
    expect(api.removeQuestion).toHaveBeenCalledWith("q-1");
    expect(api.addQuestionSet).not.toHaveBeenCalled();
    expect(api.addDocument).not.toHaveBeenCalled();
  });

  it("waits for source durability and rolls back the set and questions when it rejects", async () => {
    let rejectDocument!: (error: Error) => void;
    const durableWrite = new Promise<void>((_resolve, reject) => { rejectDocument = reject; });
    const api = persistence({ addDocument: vi.fn(() => durableWrite) });
    let settled = false;
    const pending = persistReviewedImport(api, plan()).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    rejectDocument(new Error("Vault unavailable"));
    const result = await pending;

    expect(result).toEqual({ ok: false, message: "Vault unavailable", rollbackFailures: [] });
    expect(api.removeDocument).toHaveBeenCalledWith("doc-1");
    expect(api.removeQuestionSet).toHaveBeenCalledWith("set-1");
    expect(api.removeQuestion).toHaveBeenCalledWith("q-1");
  });

  it("continues cleanup and reports every failed rollback step honestly", async () => {
    const api = persistence({
      addDocument: vi.fn(async () => { throw new Error("Document write failed"); }),
      removeQuestionSet: vi.fn(async () => { throw new Error("Set cleanup failed"); }),
    });
    const result = await persistReviewedImport(api, plan());

    expect(result).toEqual({
      ok: false,
      message: "Document write failed",
      rollbackFailures: ["question set"],
    });
    expect(api.removeDocument).toHaveBeenCalledWith("doc-1");
    expect(api.removeQuestion).toHaveBeenCalledWith("q-1");
  });
});

describe("reviewed import retry identity", () => {
  it("finds an exact prior set after navigation without relying on component memory", () => {
    const stored: QuestionRecord = {
      ...question("q-existing", "Same reviewed question?"),
      id: "q-existing",
      source: "imported",
      status: "unseen",
      attempts: [],
      tags: [],
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const existingSet = { ...set, id: "set-existing", questionIds: [stored.id] };
    const candidate = {
      ...question("q-new", "Same reviewed question?"),
      sourceFile: { ...question("q-new").sourceFile!, addedAt: "later" },
    };

    expect(findEquivalentReviewedSet({
      sets: [existingSet],
      questions: [stored],
      title: "Reviewed set",
      sourceDocumentId: "doc-1",
      candidates: [candidate],
    })).toEqual({ set: existingSet, questionIds: ["q-existing"] });
  });

  it("finds an exact prior questions-only set without a source document", () => {
    const stored: QuestionRecord = {
      ...question("q-existing", "Same reviewed question?"),
      id: "q-existing",
      sourceDocumentId: undefined,
      source: "imported",
      status: "unseen",
      attempts: [],
      tags: [],
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const existingSet = {
      ...set,
      id: "set-existing",
      sourceDocumentIds: [],
      questionIds: [stored.id],
    };
    const candidate = {
      ...question("q-new", "Same reviewed question?"),
      sourceDocumentId: undefined,
      sourceFile: { ...question("q-new").sourceFile!, addedAt: "later" },
    };

    expect(findEquivalentReviewedSet({
      sets: [existingSet],
      questions: [stored],
      title: "Reviewed set",
      candidates: [candidate],
    })).toEqual({ set: existingSet, questionIds: ["q-existing"] });
  });

  it("joins an identical import already in flight across component lifetimes", async () => {
    let releaseQuestion!: () => void;
    const questionGate = new Promise<void>((resolve) => { releaseQuestion = resolve; });
    let fingerprint = "";
    let observedGuardBeforeWrite = false;
    const api = persistence({
      addQuestion: vi.fn(async (input) => {
        observedGuardBeforeWrite = isReviewedImportInFlight(fingerprint);
        await questionGate;
        return { ok: true, errors: [], id: (input as ReviewedQuestionInput).id };
      }),
    });
    const importPlan = plan();
    fingerprint = reviewedImportFingerprint({
      title: importPlan.questionSet!.title,
      destination: "both",
      sourceIdentity: "checksum:stable",
      candidates: importPlan.questions,
    });

    const first = persistReviewedImportOnce(fingerprint, api, importPlan);
    const second = persistReviewedImportOnce(fingerprint, api, {
      ...importPlan,
      questions: [{ ...importPlan.questions[0], id: "q-remounted" }],
      questionSet: { ...importPlan.questionSet!, id: "set-remounted" },
    });
    expect(isReviewedImportInFlight(fingerprint)).toBe(true);
    expect(observedGuardBeforeWrite).toBe(true);
    expect(api.addQuestion).toHaveBeenCalledTimes(1);

    releaseQuestion();
    const [owner, joined] = await Promise.all([first, second]);
    expect(owner).toEqual({
      joined: false,
      result: {
        ok: true,
        questionIds: ["q-1"],
        questionSetId: "set-1",
        documentId: "doc-1",
      },
    });
    expect(joined).toEqual({ ...owner, joined: true });
    expect(api.addQuestionSet).toHaveBeenCalledTimes(1);
    expect(api.addDocument).toHaveBeenCalledTimes(1);
    expect(isReviewedImportInFlight(fingerprint)).toBe(false);
  });

  it("serializes distinct imports that share the production atomic commit", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const callOrder: string[] = [];
    const commitReviewedImport = vi.fn(async (currentPlan: ReviewedImportPersistencePlan) => {
      const questionId = currentPlan.questions[0].id;
      callOrder.push(questionId);
      if (questionId === "q-1") await firstGate;
      return {
        ok: true as const,
        questionIds: [questionId],
        questionSetId: currentPlan.questionSet?.id,
        documentId: currentPlan.documentWrite?.kind === "create"
          ? currentPlan.documentWrite.document.id
          : currentPlan.documentWrite?.id,
      };
    });
    const api = persistence({ commitReviewedImport });
    const firstPlan = plan([question("q-1")]);
    const secondPlan = plan([{ ...question("q-2"), questionNumber: 2 }]);

    const first = persistReviewedImportOnce("distinct:first", api, firstPlan);
    const second = persistReviewedImportOnce("distinct:second", api, secondPlan);
    await Promise.resolve();

    expect(commitReviewedImport).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["q-1"]);
    expect(isReviewedImportInFlight("distinct:first")).toBe(true);
    expect(isReviewedImportInFlight("distinct:second")).toBe(true);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(commitReviewedImport).toHaveBeenCalledTimes(2);
    expect(callOrder).toEqual(["q-1", "q-2"]);
    expect(isReviewedImportInFlight("distinct:first")).toBe(false);
    expect(isReviewedImportInFlight("distinct:second")).toBe(false);
  });
});
