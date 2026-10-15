// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import type { QuestionSet, SourceDocument } from "./library";
import {
  DB_NAME,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
  localVaultStorage,
} from "./localVault";
import type {
  ReviewedRefilingPlan,
  ReviewedImportPersistencePlan,
  ReviewedQuestionInput,
} from "./questionImportFinalization";
import { findOrphans } from "./orphanRepair";
import type { QuestionRecord } from "./questions";
import { useStore } from "./store";
import { persistPreparedLibraryReview } from "../components/bookshelf/PreparedLibrary";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "./privateLibrary/types";
import type { ImportPackage } from "./question-content/package";
import type { BankSave } from "./question-content/bankImport";

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

function planWithoutDocument(
  questions = [question("q-1", 1), question("q-2", 2)],
): ReviewedImportPersistencePlan {
  return {
    questions: questions.map(({ sourceDocumentId: _sourceDocumentId, ...item }) => item),
    questionSet: { ...questionSet, sourceDocumentIds: [] },
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

  it("restores prepared-review metadata in memory and leaves the durable baseline intact after a real vault outage", async () => {
    const checksum = "a".repeat(64);
    const catalogDocument: SourceDocument = {
      id: "private-library-prepared",
      title: "Prepared academic library",
      fileName: "catalog.json",
      fileType: PRIVATE_LIBRARY_DOCUMENT,
      uploadedAt: "2026-10-15T00:00:00.000Z",
      rawText: JSON.stringify({
        format: "axom-private-library",
        schemaVersion: 1,
        id: "prepared",
        version: "test",
        templates: [],
        sources: [{
          id: "source",
          name: "Source.pdf",
          sourcePath: "Source.pdf",
          checksum,
          module: "FTCM",
          status: "prepared",
          reason: "Prepared for review",
          bankFile: "banks/source.json",
          ready: 99,
          review: 4,
        }],
      }),
      sizeBytes: 1,
      tags: [],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    };
    const reviewDocument: SourceDocument = {
      id: `private-review-${checksum}`,
      title: "Source review",
      fileName: "Source.pdf",
      fileType: PRIVATE_REVIEW_DOCUMENT,
      uploadedAt: "2026-10-15T00:00:00.000Z",
      rawText: "{}",
      sizeBytes: 2,
      tags: [],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    };
    const pkg: ImportPackage = {
      manifest: {
        schemaVersion: 1,
        course: { name: "FTCM", term: 1, week: 1 },
        bank: { id: "bank", title: "Reviewed source", discipline: "Medicine" },
        source: { filename: "Source.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: [],
    };
    const bank = {
      pkg,
      issues: [],
      sourceText: { rawText: "Reviewed source text" },
      sourceBytes: 20,
      notes: [],
    } satisfies PreparedBank;
    const result: BankSave = {
      status: "saved",
      sections: [{
        setTitle: "Reviewed source",
        questionIds: ["source-ready"],
        savedIds: ["ready"],
        reused: false,
        images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [],
      held: [],
      withheldAssets: [],
      filing: { module: "FTCM", term: 1, agrees: true },
      errors: [],
    };
    useStore.setState({ questions: [], questionSets: [], documents: [catalogDocument, reviewDocument] });
    await flushLocalVaultWrites();
    const durableBefore = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);

    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    await expect(persistPreparedLibraryReview(reviewDocument.id, bank, pkg, result))
      .rejects.toThrow(/could not confirm.*prior review metadata could not be restored.*no local storage fallback/i);

    expect(useStore.getState().documents).toEqual([catalogDocument, reviewDocument]);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("localStorage", storage);
    const durableAfter = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    expect(JSON.parse(durableAfter!).state.documents).toEqual(JSON.parse(durableBefore!).state.documents);
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

  it("retains and reports a concurrently edited inserted question without dangling ownership", async () => {
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(plan());
    await useStore.setState((live) => ({
      questions: live.questions.map((item) => (
        item.id === "q-1" ? { ...item, notes: "Edited while the import was saving" } : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: [
        "question q-1",
        "source document doc-atomic (concurrent references)",
      ],
    });
    const live = useStore.getState();
    expect(live.questions).toEqual([
      expect.objectContaining({
        id: "q-1",
        notes: "Edited while the import was saving",
        setId: undefined,
        sourceDocumentId: "doc-atomic",
      }),
    ]);
    expect(live.questionSets).toEqual([]);
    expect(live.documents).toEqual([
      expect.objectContaining({
        id: "doc-atomic",
        linkedQuestionSetIds: [],
        libraryOnly: false,
      }),
    ]);
    expect(findOrphans(live).totalIssues).toBe(0);

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual(live.questions);
    expect(persisted.questionSets).toEqual([]);
    expect(persisted.documents).toEqual(live.documents);
  });

  it("retains and reports an edited inserted set with all surviving members", async () => {
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(plan());
    await useStore.setState((live) => ({
      questionSets: live.questionSets.map((item) => (
        item.id === questionSet.id ? { ...item, title: "Edited while the import was saving" } : item
      )),
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: [
        "question set set-atomic",
        "question q-2",
        "question q-1",
        "source document doc-atomic (concurrent references)",
      ],
    });
    const live = useStore.getState();
    expect(live.questionSets).toEqual([
      expect.objectContaining({
        id: "set-atomic",
        title: "Edited while the import was saving",
        questionIds: ["q-1", "q-2"],
      }),
    ]);
    expect(live.questions.map((item) => [item.id, item.setId])).toEqual([
      ["q-2", "set-atomic"],
      ["q-1", "set-atomic"],
    ]);
    expect(live.documents).toEqual([
      expect.objectContaining({
        id: "doc-atomic",
        linkedQuestionSetIds: ["set-atomic"],
        libraryOnly: false,
      }),
    ]);
    expect(findOrphans(live).totalIssues).toBe(0);

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual(live.questions);
    expect(persisted.questionSets).toEqual(live.questionSets);
    expect(persisted.documents).toEqual(live.documents);
  });

  it("retains and reports an inserted question referenced by a foreign set", async () => {
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedImport(planWithoutDocument());
    const foreignSet: QuestionSet = {
      ...questionSet,
      id: "set-foreign",
      title: "Concurrent collection",
      sourceDocumentIds: [],
      questionIds: ["q-1"],
    };
    await useStore.setState((live) => ({
      questionSets: [foreignSet, ...live.questionSets],
    }));
    rejectAtomicWrite(new Error("Deferred vault failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred vault failure",
      rollbackFailures: ["question q-1"],
    });
    const live = useStore.getState();
    expect(live.questionSets).toEqual([foreignSet]);
    expect(live.questions).toEqual([
      expect.objectContaining({ id: "q-1", setId: undefined }),
    ]);
    expect(findOrphans(live).totalIssues).toBe(0);

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual(live.questions);
    expect(persisted.questionSets).toEqual([foreignSet]);
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

  it("refiles multiple reused sets in one vault write without changing question timestamps", async () => {
    const q1 = {
      ...existingQuestion,
      id: "q-refile-1",
      setId: "set-refile-1",
      module: "GOER",
      week: 2,
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const q2 = {
      ...existingQuestion,
      id: "q-refile-2",
      setId: "set-refile-2",
      module: "GOER",
      week: 2,
      updatedAt: "2026-07-19T00:00:00.000Z",
    };
    const set1 = { ...questionSet, id: "set-refile-1", sourceDocumentIds: [], questionIds: [q1.id], scope: { module: "GOER", week: 2 } };
    const set2 = { ...questionSet, id: "set-refile-2", sourceDocumentIds: [], questionIds: [q2.id], scope: { module: "GOER", week: 2 } };
    await useStore.setState({ questions: [q1, q2], questionSets: [set1, set2], documents: [] });
    const target = { module: "FTCM" };
    const refiling: ReviewedRefilingPlan = {
      sets: [
        { setId: set1.id, expectedScope: set1.scope, questions: [{ questionId: q1.id, expectedScope: set1.scope }], targetScope: target },
        { setId: set2.id, expectedScope: set2.scope, questions: [{ questionId: q2.id, expectedScope: set2.scope }], targetScope: target },
      ],
    };
    const checkpoint = getVaultWriteCheckpoint();

    await expect(useStore.getState().commitReviewedRefiling(refiling)).resolves.toEqual({ ok: true });

    expect(getVaultWriteCheckpoint() - checkpoint).toBe(1);
    expect(useStore.getState().questionSets.map((set) => set.scope)).toEqual([target, target]);
    expect(useStore.getState().questions.map((item) => ({
      id: item.id,
      module: item.module,
      week: item.week,
      updatedAt: item.updatedAt,
    }))).toEqual([
      { id: q1.id, module: "FTCM", week: undefined, updatedAt: q1.updatedAt },
      { id: q2.id, module: "FTCM", week: undefined, updatedAt: q2.updatedAt },
    ]);
    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questionSets.map((set: QuestionSet) => set.scope)).toEqual([target, target]);
    expect(persisted.questions.map((item: QuestionRecord) => item.updatedAt)).toEqual([q1.updatedAt, q2.updatedAt]);
  });

  it("restores the exact pre-refiling arrays after a persistence failure", async () => {
    const priorQuestion = {
      ...existingQuestion,
      id: "q-refile-failure",
      setId: "set-refile-failure",
      module: "GOER",
      week: 2,
    };
    const priorSet = {
      ...questionSet,
      id: "set-refile-failure",
      sourceDocumentIds: [],
      questionIds: [priorQuestion.id],
      scope: { module: "GOER", week: 2 },
    };
    const priorQuestions = [priorQuestion];
    const priorSets = [priorSet];
    await useStore.setState({ questions: priorQuestions, questionSets: priorSets, documents: [] });
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));
    const checkpoint = getVaultWriteCheckpoint();

    const pending = useStore.getState().commitReviewedRefiling({
      sets: [{
        setId: priorSet.id,
        expectedScope: priorSet.scope,
        questions: [{ questionId: priorQuestion.id, expectedScope: priorSet.scope }],
        targetScope: { module: "FTCM" },
      }],
    });
    expect(useStore.getState().questions[0]).toMatchObject({ module: "FTCM" });
    rejectAtomicWrite(new Error("Deferred refiling failure"));

    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Deferred refiling failure",
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint() - checkpoint).toBe(1);
    expect(useStore.getState().questions).toEqual(priorQuestions);
    expect(useStore.getState().questionSets).toEqual(priorSets);
    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual(priorQuestions);
    expect(persisted.questionSets).toEqual(priorSets);
  });

  it("rolls back only filing fields and preserves concurrent question-set work", async () => {
    const q1 = {
      ...existingQuestion,
      id: "q-refile-concurrent-edit",
      setId: "set-refile-concurrent-edit",
      module: "GOER",
      week: 2,
    };
    const q2 = {
      ...existingQuestion,
      id: "q-refile-concurrent-delete",
      setId: "set-refile-concurrent-delete",
      module: "GOER",
      week: 2,
    };
    const unrelatedQuestion = { ...existingQuestion, id: "q-unrelated", setId: "set-unrelated", notes: "before" };
    const set1 = { ...questionSet, id: q1.setId, sourceDocumentIds: [], questionIds: [q1.id], scope: { module: "GOER", week: 2 } };
    const set2 = { ...questionSet, id: q2.setId, sourceDocumentIds: [], questionIds: [q2.id], scope: { module: "GOER", week: 2 } };
    const unrelatedSet = { ...questionSet, id: "set-unrelated", title: "Before", sourceDocumentIds: [], questionIds: [unrelatedQuestion.id] };
    await useStore.setState({
      questions: [q1, q2, unrelatedQuestion],
      questionSets: [set1, set2, unrelatedSet],
      documents: [],
    });
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const pending = useStore.getState().commitReviewedRefiling({
      sets: [
        { setId: set1.id, expectedScope: set1.scope, questions: [{ questionId: q1.id, expectedScope: set1.scope }], targetScope: { module: "FTCM" } },
        { setId: set2.id, expectedScope: set2.scope, questions: [{ questionId: q2.id, expectedScope: set2.scope }], targetScope: { module: "FTCM" } },
      ],
    });
    expect(useStore.getState().questions.find((item) => item.id === q1.id)).toMatchObject({ module: "FTCM" });

    useStore.getState().updateQuestion(q1.id, { notes: "edited while saving" });
    useStore.getState().updateQuestionSet(set1.id, { title: "Edited while saving" });
    useStore.getState().updateQuestion(unrelatedQuestion.id, { notes: "unrelated edit" });
    useStore.getState().updateQuestionSet(unrelatedSet.id, { title: "Unrelated edit" });
    void useStore.setState((state) => ({
      questions: state.questions.filter((question) => question.id !== q2.id),
      questionSets: state.questionSets.filter((set) => set.id !== set2.id),
    }));
    rejectAtomicWrite(new Error("Deferred refiling failure"));

    await expect(pending).resolves.toMatchObject({ ok: false, message: "Deferred refiling failure" });
    const live = useStore.getState();
    expect(live.questions.find((item) => item.id === q1.id)).toMatchObject({
      module: "GOER",
      week: 2,
      notes: "edited while saving",
    });
    expect(live.questionSets.find((set) => set.id === set1.id)).toMatchObject({
      title: "Edited while saving",
      scope: { module: "GOER", week: 2 },
    });
    expect(live.questions.find((item) => item.id === unrelatedQuestion.id)).toMatchObject({ notes: "unrelated edit" });
    expect(live.questionSets.find((set) => set.id === unrelatedSet.id)).toMatchObject({ title: "Unrelated edit" });
    expect(live.questions.some((item) => item.id === q2.id)).toBe(false);
    expect(live.questionSets.some((set) => set.id === set2.id)).toBe(false);

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questions).toEqual(live.questions);
    expect(persisted.questionSets).toEqual(live.questionSets);
  });

  it("rejects a stale source-set scope before publishing a refiling", async () => {
    const priorQuestion = { ...existingQuestion, id: "q-refile-stale", setId: "set-refile-stale", module: "GOER", week: 2 };
    const priorSet = {
      ...questionSet,
      id: "set-refile-stale",
      sourceDocumentIds: [],
      questionIds: [priorQuestion.id],
      scope: { module: "GOER", week: 2 },
    };
    await useStore.setState({ questions: [priorQuestion], questionSets: [priorSet], documents: [] });
    const checkpoint = getVaultWriteCheckpoint();

    const result = await useStore.getState().commitReviewedRefiling({
      sets: [{
        setId: priorSet.id,
        expectedScope: { module: "GOER", week: 1 },
        questions: [{ questionId: priorQuestion.id, expectedScope: priorSet.scope }],
        targetScope: { module: "FTCM" },
      }],
    });

    expect(result).toEqual({
      ok: false,
      message: 'Reused source set "set-refile-stale" changed filing before refiling.',
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState().questions).toEqual([priorQuestion]);
    expect(useStore.getState().questionSets).toEqual([priorSet]);
  });

  it.each([
    ["membership", ["q-refile-boundary", "q-added-later"], "set-refile-boundary", /changed membership/],
    ["ownership", ["q-refile-boundary"], "set-other", /changed source-set ownership/],
  ] as const)("rejects changed source-set %s before publishing a refiling", async (_case, liveIds, liveOwner, message) => {
    const priorQuestion = {
      ...existingQuestion,
      id: "q-refile-boundary",
      setId: liveOwner,
      module: "GOER",
      week: 2,
    };
    const priorSet = {
      ...questionSet,
      id: "set-refile-boundary",
      sourceDocumentIds: [],
      questionIds: [...liveIds],
      scope: { module: "GOER", week: 2 },
    };
    await useStore.setState({ questions: [priorQuestion], questionSets: [priorSet], documents: [] });
    const checkpoint = getVaultWriteCheckpoint();

    const result = await useStore.getState().commitReviewedRefiling({
      sets: [{
        setId: priorSet.id,
        expectedScope: priorSet.scope,
        questions: [{ questionId: priorQuestion.id, expectedScope: priorSet.scope }],
        targetScope: { module: "FTCM" },
      }],
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(message), rollbackFailures: [] });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState().questions).toEqual([priorQuestion]);
    expect(useStore.getState().questionSets).toEqual([priorSet]);
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
