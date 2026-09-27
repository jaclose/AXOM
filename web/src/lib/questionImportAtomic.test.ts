// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import type { QuestionSet, SourceDocument } from "./library";
import {
  DB_NAME,
  getVaultWriteCheckpoint,
  localVaultStorage,
} from "./localVault";
import type {
  ReviewedImportPersistencePlan,
  ReviewedQuestionInput,
} from "./questionImportFinalization";
import type { QuestionRecord } from "./questions";
import { useStore } from "./store";

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

const original = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
};

function question(id: string, questionNumber: number): ReviewedQuestionInput {
  return {
    id,
    source: "imported",
    stem: `Question ${questionNumber}?`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B",
    explanation: "Beta is supported.",
    setId: "set-atomic",
    sourceDocumentId: "doc-atomic",
    questionNumber,
    tags: [],
    extraction: {
      confidence: "high",
      reviewed: true,
      reviewedAt: "2026-07-22T00:00:00.000Z",
    },
  };
}

const existingQuestion: QuestionRecord = {
  id: "q-existing",
  source: "manual",
  stem: "Existing question?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "A",
  correctAnswerText: "Alpha",
  status: "unseen",
  tags: [],
  attempts: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const questionSet: QuestionSet = {
  id: "set-atomic",
  title: "Atomic reviewed set",
  sourceDocumentIds: ["doc-atomic"],
  createdAt: "2026-07-22T00:00:00.000Z",
  questionIds: [],
  tags: [],
  aiEnhanced: false,
  parserWarnings: [],
};

const sourceDocument: SourceDocument = {
  id: "doc-atomic",
  title: "Atomic source",
  fileName: "atomic.txt",
  fileType: "text",
  uploadedAt: "2026-07-22T00:00:00.000Z",
  rawText: "Question source",
  sizeBytes: 100,
  tags: [],
  linkedQuestionSetIds: ["set-atomic"],
  libraryOnly: false,
};

function plan(questions = [question("q-1", 1), question("q-2", 2)]): ReviewedImportPersistencePlan {
  return {
    questions,
    questionSet,
    documentWrite: { kind: "create", document: sourceDocument },
  };
}

beforeEach(async () => {
  values.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(DB_NAME);
  await useStore.persist.rehydrate();
  await useStore.setState({ questions: [], questionSets: [], documents: [] });
});

afterEach(async () => {
  // A failure test removes both browser storage paths; restore them before the
  // shared store is returned to its original state.
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  vi.restoreAllMocks();
  await useStore.setState(original);
  await deleteDatabase(DB_NAME);
  vi.unstubAllGlobals();
});

describe("atomic reviewed-import store transaction", () => {
  it("persists all reviewed records in one vault write", async () => {
    const checkpoint = getVaultWriteCheckpoint();

    await expect(useStore.getState().commitReviewedImport(plan())).resolves.toEqual({
      ok: true,
      questionIds: ["q-1", "q-2"],
      questionSetId: "set-atomic",
      documentId: "doc-atomic",
    });

    expect(getVaultWriteCheckpoint() - checkpoint).toBe(1);
    const state = useStore.getState();
    expect(state.questions.map((item) => item.id)).toEqual(["q-2", "q-1"]);
    expect(state.questionSets[0]).toMatchObject({
      id: "set-atomic",
      questionIds: ["q-1", "q-2"],
      sourceDocumentIds: ["doc-atomic"],
    });
    expect(state.documents[0]).toMatchObject({
      id: "doc-atomic",
      linkedQuestionSetIds: ["set-atomic"],
      libraryOnly: false,
    });

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions.map((item: { id: string }) => item.id)).toEqual(["q-2", "q-1"]);
    expect(persisted.questionSets[0].questionIds).toEqual(["q-1", "q-2"]);
    expect(persisted.documents[0].linkedQuestionSetIds).toEqual(["set-atomic"]);
  });

  it("rejects the complete plan before writing when one question is invalid", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    const invalid = { ...question("q-2", 2), stem: "" };

    const result = await useStore.getState().commitReviewedImport(plan([
      question("q-1", 1),
      invalid,
    ]));

    expect(result).toMatchObject({ ok: false, rollbackFailures: [] });
    expect(result.ok || result.message).toMatch(/Question 2: Question stem is required/i);
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [], documents: [] });
  });

  it("rejects a missing source-document update target before writing", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    const importPlan = plan();
    importPlan.documentWrite = {
      kind: "update",
      id: "missing-document",
      patch: { linkedQuestionSetIds: ["set-atomic"] },
      original: sourceDocument,
    };

    const result = await useStore.getState().commitReviewedImport(importPlan);

    expect(result).toEqual({
      ok: false,
      message: 'Source document "missing-document" no longer exists.',
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [], documents: [] });
  });

  it.each([
    [
      "fewer than two usable options",
      { options: [{ key: "A", text: "Alpha" }], correctKey: "A" },
      /at least two usable/i,
    ],
    [
      "duplicate option labels",
      { options: [{ key: "A", text: "Alpha" }, { key: "A", text: "Again" }] },
      /option keys must be unique/i,
    ],
    ["a missing correct-answer key", { correctKey: undefined }, /correct answer matching/i],
    ["a remaining review flag", { needsReview: true }, /review must be completed/i],
    ["missing reviewed extraction evidence", { extraction: undefined }, /reviewed import confirmation/i],
  ] satisfies Array<[string, Partial<ReviewedQuestionInput>, RegExp]>) (
    "rejects %s before writing",
    async (_label, patch, expectedMessage) => {
      const checkpoint = getVaultWriteCheckpoint();
      const result = await useStore.getState().commitReviewedImport(plan([
        { ...question("q-invalid", 1), ...patch },
      ]));

      expect(result).toMatchObject({ ok: false, rollbackFailures: [] });
      expect(result.ok || result.message).toMatch(expectedMessage);
      expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    },
  );

  it("requires a question set whenever reviewed questions are present", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    const importPlan = plan([question("q-1", 1)]);
    importPlan.questionSet = undefined;

    await expect(useStore.getState().commitReviewedImport(importPlan)).resolves.toEqual({
      ok: false,
      message: "Reviewed questions must be finalized into a question set.",
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
  });

  it("rejects inconsistent question and set source-document associations", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    const importPlan = plan([{ ...question("q-1", 1), sourceDocumentId: undefined }]);

    const result = await useStore.getState().commitReviewedImport(importPlan);

    expect(result).toEqual({
      ok: false,
      message: 'Question "q-1" does not share the question set\'s source-document association.',
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
  });

  it("restores all three in-memory slices and reports unconfirmed rollback durability", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    const checkpoint = getVaultWriteCheckpoint();

    const result = await useStore.getState().commitReviewedImport(plan());

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/no local storage fallback/i),
      rollbackFailures: ["reviewed import state"],
    });
    expect(getVaultWriteCheckpoint() - checkpoint).toBe(2);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [], documents: [] });
  });

  it("preserves a concurrent mutation to an existing question after a deferred write failure", async () => {
    await useStore.setState({ questions: [existingQuestion], questionSets: [], documents: [] });
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(plan());
    expect(useStore.getState().questions.map((item) => item.id)).toEqual(["q-2", "q-1", "q-existing"]);

    await useStore.setState((live) => ({
      questions: live.questions.map((item) => (
        item.id === "q-existing" ? { ...item, notes: "Concurrent learner edit" } : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: [],
    });
    expect(useStore.getState().questions).toEqual([
      expect.objectContaining({ id: "q-existing", notes: "Concurrent learner edit" }),
    ]);
    expect(useStore.getState()).toMatchObject({ questionSets: [], documents: [] });

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual([
      expect.objectContaining({ id: "q-existing", notes: "Concurrent learner edit" }),
    ]);
    expect(persisted.questionSets).toEqual([]);
    expect(persisted.documents).toEqual([]);
  });

  it("preserves and reports a concurrent same-field source-document edit", async () => {
    const existingDocument = { ...sourceDocument, id: "doc-existing", linkedQuestionSetIds: [], libraryOnly: true };
    await useStore.setState({ questions: [], questionSets: [], documents: [existingDocument] });
    const importPlan = plan([{ ...question("q-1", 1), sourceDocumentId: "doc-existing" }]);
    importPlan.questionSet = { ...questionSet, sourceDocumentIds: ["doc-existing"] };
    importPlan.documentWrite = {
      kind: "update",
      id: "doc-existing",
      original: existingDocument,
      patch: { title: "Import title", libraryOnly: false },
    };

    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(importPlan);
    await useStore.setState((live) => ({
      documents: live.documents.map((item) => (
        item.id === "doc-existing" ? { ...item, title: "Concurrent title" } : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    const result = await pending;
    expect(result).toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: ["source document doc-existing.title"],
    });
    expect(useStore.getState().documents).toEqual([
      expect.objectContaining({
        id: "doc-existing",
        title: "Concurrent title",
        linkedQuestionSetIds: [],
        libraryOnly: true,
      }),
    ]);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [] });
  });

  it("keeps a concurrent source link coherent while rolling back its own reverse link", async () => {
    const existingDocument = { ...sourceDocument, id: "doc-existing", linkedQuestionSetIds: [], libraryOnly: true };
    await useStore.setState({ questions: [], questionSets: [], documents: [existingDocument] });
    const importPlan = plan([{ ...question("q-1", 1), sourceDocumentId: "doc-existing" }]);
    importPlan.questionSet = { ...questionSet, sourceDocumentIds: ["doc-existing"] };
    importPlan.documentWrite = {
      kind: "update",
      id: "doc-existing",
      original: existingDocument,
      patch: { libraryOnly: false },
    };

    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(importPlan);
    const foreignSet = { ...questionSet, id: "set-concurrent", sourceDocumentIds: ["doc-existing"], questionIds: [] };
    await useStore.setState((live) => ({
      questionSets: [foreignSet, ...live.questionSets],
      documents: live.documents.map((item) => (
        item.id === "doc-existing"
          ? { ...item, linkedQuestionSetIds: [...item.linkedQuestionSetIds, foreignSet.id] }
          : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toMatchObject({ ok: false, rollbackFailures: [] });
    expect(useStore.getState().questionSets).toEqual([foreignSet]);
    expect(useStore.getState().documents).toEqual([
      expect.objectContaining({
        id: "doc-existing",
        linkedQuestionSetIds: ["set-concurrent"],
        libraryOnly: false,
      }),
    ]);
  });

  it("retains and reports an imported document that gained a concurrent set reference", async () => {
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(plan());
    const foreignSet = { ...questionSet, id: "set-concurrent", questionIds: [] };
    await useStore.setState((live) => ({
      questionSets: [foreignSet, ...live.questionSets],
      documents: live.documents.map((item) => (
        item.id === sourceDocument.id
          ? { ...item, linkedQuestionSetIds: [...item.linkedQuestionSetIds, foreignSet.id] }
          : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: ["source document doc-atomic (concurrent references)"],
    });
    expect(useStore.getState().questionSets).toEqual([foreignSet]);
    expect(useStore.getState().documents).toEqual([
      expect.objectContaining({
        id: "doc-atomic",
        linkedQuestionSetIds: ["set-concurrent"],
        libraryOnly: false,
      }),
    ]);
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
