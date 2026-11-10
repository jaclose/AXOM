// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../checksum";
import type { SourceDocument } from "../library";
import type { NoctyriumState } from "../types";
import { makeSeed } from "../seed";
import { accountOperationClient } from "../account/supabase";
import { getQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { SOURCE_ORIGINALS_DB, readSourceOriginal } from "../decode/sources";
import { storedAcademicBindings, downloadAcademicAsset } from "../academicLibrary/contentReferences";
import { hydrateCloudContent } from "./cloudContent";
import { downloadCloudOriginal } from "./cloudOriginals";
import { readDeferredContent } from "./deferredContent";
import { materializeState } from "./contentDownloads";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("../academicLibrary/contentReferences", () => ({
  storedAcademicBindings: vi.fn(), downloadAcademicAsset: vi.fn(),
}));
vi.mock("./cloudOriginals", () => ({ downloadCloudOriginal: vi.fn() }));
vi.mock("./cloudContent", () => ({
  hydrateCloudContent: vi.fn(), splitCloudContent: vi.fn(), mergeSourceFields: vi.fn(),
}));
vi.mock("./deferredContent", () => ({ readDeferredContent: vi.fn() }));

const account = "synthetic-original-owner-A";
const other = "synthetic-original-owner-B";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  setQuestionAttachmentAccount(account);
});
afterEach(async () => {
  setQuestionAttachmentAccount(undefined);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.unstubAllGlobals();
});

async function pendingOriginal() {
  const bytes = new Blob(["%PDF synthetic immutable original scoped to owner A"], { type: "application/pdf" });
  const checksum = await sha256Hex(await bytes.arrayBuffer());
  if (!checksum) throw new Error("Synthetic source checksum unavailable.");
  const document: SourceDocument = {
    id: "synthetic-original-epoch", title: "Synthetic source", fileName: "source.pdf",
    fileType: "pdf", checksum, uploadedAt: "2026-11-10", rawText: "Synthetic source",
    tags: [], linkedQuestionSetIds: [], libraryOnly: true, sizeBytes: bytes.size,
  };
  const deferred = {
    accountId: account, questions: [], documents: [document],
    sources: [{ collection: "documents", id: document.id, hash: checksum, byteSize: bytes.size }],
    media: [],
  };
  const state = { ...makeSeed(), questions: [], documents: [], deferredContent: deferred } as unknown as NoctyriumState;
  vi.mocked(readDeferredContent).mockImplementation((input) => input as ReturnType<typeof readDeferredContent>);
  vi.mocked(hydrateCloudContent).mockImplementation(async (_client, _userId, partial) => partial);
  vi.mocked(downloadCloudOriginal).mockResolvedValue();
  vi.mocked(downloadAcademicAsset).mockResolvedValue(bytes);
  vi.mocked(storedAcademicBindings).mockReturnValue({
    sources: [], assets: [],
    originals: [{ documentId: document.id,
      asset: { revisionId: "00000000-0000-0000-0000-000000000001", path: "source.pdf", sha256: checksum } }],
  });
  return { state, document, bytes };
}

describe("explicit academic original download preserves the initiating account epoch", () => {
  it("rejects an A-to-B switch between the authenticated acknowledgement and original-file save without caching A into B", async () => {
    const { state, document } = await pendingOriginal();
    let checks = 0;
    const assertCurrent = vi.fn(async () => {
      if (getQuestionAttachmentScope().accountId !== account) throw new Error("Account changed during original download.");
      checks += 1;
      // The promise is acknowledged in A, but the browser changes account
      // before the awaiting caller resumes its next local storage operation.
      if (checks === 2) queueMicrotask(() => setQuestionAttachmentAccount(other));
    });
    vi.mocked(accountOperationClient).mockResolvedValue({
      client: {} as never, userId: account, assertCurrent,
    } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);

    await expect(materializeState(state)).rejects.toThrow(/account changed/i);
    expect(getQuestionAttachmentScope().accountId).toBe(other);
    expect(await readSourceOriginal(document.id, document.checksum, { accountId: other })).toBeUndefined();
  });

  it("rejects A-to-B-to-A round trips even when the session ID returns to A", async () => {
    const { state, document } = await pendingOriginal();
    let checks = 0;
    const assertCurrent = vi.fn(async () => {
      if (getQuestionAttachmentScope().accountId !== account) throw new Error("Account changed.");
      if (++checks === 2) queueMicrotask(() => {
        setQuestionAttachmentAccount(other);
        setQuestionAttachmentAccount(account);
      });
    });
    vi.mocked(accountOperationClient).mockResolvedValue({
      client: {} as never, userId: account, assertCurrent,
    } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);

    await expect(materializeState(state)).rejects.toThrow(/account changed/i);
    expect(getQuestionAttachmentScope().accountId).toBe(account);
    expect(await readSourceOriginal(document.id, document.checksum, { accountId: account })).toBeUndefined();
  });

  it("still saves and verifies the original under a stable authenticated account", async () => {
    const { state, document, bytes } = await pendingOriginal();
    vi.mocked(accountOperationClient).mockResolvedValue({
      client: {} as never, userId: account,
      assertCurrent: async () => {
        if (getQuestionAttachmentScope().accountId !== account) throw new Error("Account changed.");
      },
    } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);

    const restored = await materializeState(state);
    expect(restored.documents.map(item => item.id)).toContain(document.id);
    const local = await readSourceOriginal(document.id, document.checksum, { accountId: account });
    expect(await local?.arrayBuffer()).toEqual(await bytes.arrayBuffer());
    setQuestionAttachmentAccount(other);
    expect(await readSourceOriginal(document.id, document.checksum, { accountId: other })).toBeUndefined();
  });
});
