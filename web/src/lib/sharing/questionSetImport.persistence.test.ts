// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import {
  DB_NAME,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
  localVaultStorage,
} from "../localVault";
import type { QuestionRecord } from "../questions";
import { useStore } from "../store";
import { createQuestionSetShare, sharedQuestionSetDigest } from "./questionSetShare";

const SHARE_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-10-15T12:00:00.000Z";
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

function question(): QuestionRecord {
  return {
    id: "remote-q1",
    source: "manual",
    stem: "Which synthetic choice is correct?",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B",
    correctAnswerText: "Beta",
    explanation: "Beta is correct in this synthetic fixture.",
    status: "unseen",
    tags: ["synthetic"],
    attempts: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function snapshot() {
  return createQuestionSetShare({
    id: "remote-set",
    title: "Synthetic shared set",
    sourceDocumentIds: [],
    createdAt: NOW,
    questionIds: ["remote-q1"],
    tags: ["synthetic"],
    aiEnhanced: false,
    parserWarnings: [],
  }, [question()], NOW);
}

async function input() {
  const shared = snapshot();
  return {
    snapshot: shared,
    identity: { shareId: SHARE_ID, contentDigest: await sharedQuestionSetDigest(shared) },
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
  await flushLocalVaultWrites();
});

afterEach(async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  vi.restoreAllMocks();
  await useStore.setState(original);
  await flushLocalVaultWrites();
  await deleteDatabase(DB_NAME);
  vi.unstubAllGlobals();
});

describe("durable shared-question-set import", () => {
  it("persists the sanitized questions, exact order, and non-secret provenance in one vault write", async () => {
    const share = await input();
    const checkpoint = getVaultWriteCheckpoint();
    const result = await useStore.getState().commitSharedQuestionSetImport(share);

    expect(result).toMatchObject({
      ok: true,
      added: 1,
      reused: 0,
      alreadyImported: false,
    });
    expect(getVaultWriteCheckpoint() - checkpoint).toBe(1);
    const state = useStore.getState();
    expect(state.questionSets).toHaveLength(1);
    expect(state.questionSets[0]).toMatchObject({
      id: result.ok ? result.questionSetId : "",
      sourceDocumentIds: [],
      questionIds: result.ok ? result.questionIds : [],
      importProvenance: {
        version: 1,
        shareId: SHARE_ID,
        contentDigest: share.identity.contentDigest,
      },
    });
    expect(state.questionSets[0]).not.toHaveProperty("scope");
    expect(state.questions[0]).toMatchObject({
      source: "imported",
      sourceDocumentId: undefined,
      courseId: undefined,
      setId: undefined,
      attachments: undefined,
      notes: undefined,
      attempts: [],
    });

    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = JSON.parse(raw!).state;
    expect(persisted.questionSets[0].importProvenance).toEqual({
      version: 1,
      shareId: SHARE_ID,
      contentDigest: share.identity.contentDigest,
    });
    expect(JSON.stringify(persisted)).not.toContain("share_token");
  });

  it("replays the same share without another write or changing learner-owned fields", async () => {
    const share = await input();
    const first = await useStore.getState().commitSharedQuestionSetImport(share);
    if (!first.ok) throw new Error(first.message);
    const questionId = first.questionIds[0];
    await useStore.setState((state) => ({
      questions: state.questions.map((item) => item.id === questionId
        ? { ...item, notes: "Learner note", attempts: [{ at: NOW, status: "correct" }] }
        : item),
    }));
    await flushLocalVaultWrites();
    const checkpoint = getVaultWriteCheckpoint();

    const repeated = await useStore.getState().commitSharedQuestionSetImport(share);

    expect(repeated).toEqual({
      ok: true,
      questionSetId: first.questionSetId,
      questionIds: first.questionIds,
      added: 0,
      reused: 1,
      alreadyImported: true,
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState().questions.find((item) => item.id === questionId)).toMatchObject({
      notes: "Learner note",
      attempts: [{ at: NOW, status: "correct" }],
    });
    expect(useStore.getState().questionSets).toHaveLength(1);
  });

  it("joins concurrent double-click imports into one durable mutation", async () => {
    const share = await input();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    const save = vi.spyOn(localVaultStorage, "setItem").mockImplementationOnce(async (name, value) => {
      await gate;
      return originalSetItem(name, value);
    });

    const first = useStore.getState().commitSharedQuestionSetImport(share);
    const second = useStore.getState().commitSharedQuestionSetImport(share);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({ ok: true, alreadyImported: false });
    expect(useStore.getState().questionSets).toHaveLength(1);
    expect(useStore.getState().questions).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("rejects changed content under a previously imported share ID without writing", async () => {
    const share = await input();
    const first = await useStore.getState().commitSharedQuestionSetImport(share);
    expect(first.ok).toBe(true);
    const checkpoint = getVaultWriteCheckpoint();

    const changedSnapshot = { ...share.snapshot, title: "Changed synthetic shared set" };
    const changedDigest = await sharedQuestionSetDigest(changedSnapshot);

    const changed = await useStore.getState().commitSharedQuestionSetImport({
      snapshot: changedSnapshot,
      identity: { ...share.identity, contentDigest: changedDigest },
    });

    expect(changed).toMatchObject({ ok: false, rollbackFailures: [] });
    expect(changed.ok || changed.message).toMatch(/different content/i);
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState().questionSets).toHaveLength(1);
  });

  it("rejects an identity digest that does not authenticate the supplied snapshot", async () => {
    const share = await input();
    const checkpoint = getVaultWriteCheckpoint();

    const result = await useStore.getState().commitSharedQuestionSetImport({
      ...share,
      identity: { ...share.identity, contentDigest: "b".repeat(64) },
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/digest does not match/i),
      rollbackFailures: [],
    });
    expect(getVaultWriteCheckpoint()).toBe(checkpoint);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [] });
  });

  it("rolls back its inserted records when neither vault storage path can save", async () => {
    const share = await input();
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    const checkpoint = getVaultWriteCheckpoint();

    const result = await useStore.getState().commitSharedQuestionSetImport(share);

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/no local storage fallback/i),
      rollbackFailures: ["shared question set import state"],
    });
    expect(getVaultWriteCheckpoint() - checkpoint).toBe(2);
    expect(useStore.getState()).toMatchObject({ questions: [], questionSets: [] });
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database ${name} remained open.`));
  });
}
