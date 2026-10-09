// Test support, not app code: a package through the real import and save code
// into the real workspace store, on an in-memory browser storage. Used by the
// proof on invented content and by the local proof on a real bank.
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import type { QuestionSet, SourceDocument } from "../library";
import { DB_NAME, flushLocalVaultWrites, localVaultStorage } from "../localVault";
import { listQuestionAttachmentBlobKeys } from "../questionAttachments";
import type { QuestionRecord } from "../questions";
import { useStore } from "../store";
import { saveBank, type BankSave, type Workspace as ImportWorkspace } from "./bankImport";
import type { ImportPackage, PackageIssue } from "./package";
import type { PackageImportOptions } from "./toReviewedImport";

export interface Workspace {
  questions: QuestionRecord[];
  questionSets: QuestionSet[];
  documents: SourceDocument[];
}

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

let original: Workspace | undefined;

/** An empty workspace on fresh in-memory storage. */
export async function openEmptyWorkspace(): Promise<void> {
  const state = useStore.getState();
  original ??= { questions: state.questions, questionSets: state.questionSets, documents: state.documents };
  values.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(DB_NAME);
  await useStore.persist.rehydrate();
  await useStore.setState({ questions: [], questionSets: [], documents: [] });
  await flushLocalVaultWrites();
}

export async function closeWorkspace(): Promise<void> {
  if (original) await useStore.setState(original);
  await flushLocalVaultWrites();
  await deleteDatabase(DB_NAME);
  vi.unstubAllGlobals();
}

/** The app's own store, as the import screens hand it to the save. */
export const realWorkspace: ImportWorkspace = {
  library: () => {
    const state = useStore.getState();
    return { questions: state.questions, questionSets: state.questionSets, documents: state.documents };
  },
  store: () => useStore.getState(),
};

/** A package through the canonical import into the real store, then flushed to storage. */
export async function importPackage(pkg: ImportPackage, issues: readonly PackageIssue[], files: readonly File[], options: PackageImportOptions = {}): Promise<BankSave> {
  const saved = await saveBank(pkg, issues, files, realWorkspace, options);
  await flushLocalVaultWrites();
  return saved;
}

/** What a reload would read: the vault's own copy, not the store in memory. */
export async function workspaceOnDisk(): Promise<Workspace> {
  await flushLocalVaultWrites();
  const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  const state = raw ? JSON.parse(raw).state : {};
  return { questions: state.questions ?? [], questionSets: state.questionSets ?? [], documents: state.documents ?? [] };
}

/** Drop what is in memory and read the workspace back from storage, as opening the app does. */
export async function reloadWorkspace(): Promise<Workspace> {
  await flushLocalVaultWrites();
  await useStore.persist.rehydrate();
  const state = useStore.getState();
  return { questions: state.questions, questionSets: state.questionSets, documents: state.documents };
}

export const storedImageCount = async (): Promise<number> => (await listQuestionAttachmentBlobKeys()).length;
