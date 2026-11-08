// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedReviewedImport } from "../../lib/questionImportSave";
import { parseQuestionBlocks } from "../../lib/questionParse";
import { useStore } from "../../lib/store";
import { pushToast } from "../../lib/toast";
import { DB_NAME } from "../../lib/localVault";
import { ImportPanel } from "./ImportPanel";

// The module is mocked BEFORE ImportPanel's ESM imports resolve: spying on an
// already-imported named ESM binding does not intercept its call in Vitest.
const saveGate = vi.hoisted(() => ({
  pending: [] as Array<(result: import("../../lib/questionImportSave").SavedReviewedImport) => void>,
}));
vi.mock("../../lib/questionImportSave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/questionImportSave")>();
  return {
    ...actual,
    prepareReviewedImport: (...args: Parameters<typeof actual.prepareReviewedImport>) => {
      const prepared = actual.prepareReviewedImport(...args);
      return prepared.ok
        ? { ...prepared, equivalent: { setId: "confirmed-set", questionIds: ["confirmed-question"] } }
        : prepared;
    },
    saveReviewedImport: vi.fn(
      () => new Promise<SavedReviewedImport>((resolve) => { saveGate.pending.push(resolve); }),
    ),
  };
});
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../lib/ai", () => ({
  checkProviderHealth: vi.fn(async () => ({ ok: false, detail: "No provider" })),
  cleanExplanation: vi.fn(),
  enhanceQuestionSet: vi.fn(),
  generateQuestionDrafts: vi.fn(),
  loadAiSettings: vi.fn(() => ({ mode: "demo" })),
  mapAnswerFromText: vi.fn(),
  resolveActiveProvider: vi.fn(() => null),
}));

const originals = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
};
const localValues = new Map<string, string>();
const storage: Storage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => { localValues.delete(key); },
  setItem: (key, value) => { localValues.set(key, String(value)); },
};
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
beforeEach(async () => {
  saveGate.pending.length = 0;
  vi.mocked(pushToast).mockClear();
  localValues.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(DB_NAME);
  await useStore.setState({ questions: [], questionSets: [], documents: [] });
});
afterEach(async () => {
  cleanup();
  await useStore.setState(originals);
  vi.unstubAllGlobals();
});

describe("Import Center equivalent reuse receipt feedback", () => {
  it("never claims a saved duplicate before the pending receipt and allows a failed repair to retry", async () => {
    const user = userEvent.setup();
    const rawText = "1. Previously reviewed question?\\nA. Alpha\\nB. Beta\\nAnswer: B\\nExplanation: Stable explanation.";
    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(rawText), rawText, title: "Existing reviewed set",
      fileName: "reviewed-existing.txt", fileType: "text",
    }} />);
    const toast = vi.mocked(pushToast);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(saveGate.pending).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Finalizing…" })).toHaveProperty("disabled", true);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    // Typed failure models the asynchronous account-change guard in #240.
    // This UI test is NOT evidence of live provider/session isolation.
    saveGate.pending[0]({
      ok: false, message: "The account changed while importing questions.", rollbackFailures: [],
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Nothing was finalized", tone: "warn",
    })));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(saveGate.pending).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Finalizing…" })).toHaveProperty("disabled", true);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    saveGate.pending[1]({
      ok: true, reused: true, joined: false, setId: "confirmed-set", questionIds: ["confirmed-question"],
      documentId: undefined, reusedDocument: false, images: { attached: 0, missing: 0, problems: [] },
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Import already finalized", tone: "success",
    })));
    expect(toast.mock.calls.filter(([message]) => message.title === "Import already finalized")).toHaveLength(1);
  });
});
