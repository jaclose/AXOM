// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQuestionAttachmentScope, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import type { NoctyriumState } from "../types";
import type { ContentReference } from "./cloudContent";
import { contentMetadata } from "./deferredContent";
import { downloadAccountContent, materializeState, retainDownloadedContent } from "./contentDownloads";

const mocks = vi.hoisted(() => ({
  account: vi.fn(), hydrate: vi.fn(), split: vi.fn(), media: vi.fn(),
  getState: vi.fn(), setState: vi.fn(), original: vi.fn(),
  getBlob: vi.fn(), putBlob: vi.fn(), download: vi.fn(),
}));
vi.mock("../account/supabase", () => ({ accountOperationClient: mocks.account }));
vi.mock("../store", () => ({ useStore: { getState: mocks.getState, setState: mocks.setState } }));
vi.mock("./cloudContent", async importOriginal => ({
  ...await importOriginal<typeof import("./cloudContent")>(),
  hydrateCloudContent: mocks.hydrate, splitCloudContent: mocks.split,
}));
vi.mock("./cloudMedia", async importOriginal => ({
  ...await importOriginal<typeof import("./cloudMedia")>(), workspaceMedia: mocks.media,
  downloadCloudMediaAsset: mocks.download,
}));
vi.mock("../questionAttachments", async importOriginal => ({
  ...await importOriginal<typeof import("../questionAttachments")>(),
  getQuestionAttachmentBlob: mocks.getBlob, putQuestionAttachmentBlob: mocks.putBlob,
}));
vi.mock("../../pages/QuestionWorkspacePage", () => ({ default: () => null }));
vi.mock("./cloudOriginals", () => ({ downloadCloudOriginal: mocks.original }));

const HASH = "a".repeat(64);
const collections = ["questions", "documents"] as const;
type Collection = typeof collections[number];
function ref(collection: Collection, id: string): ContentReference {
  return { collection, id, hash: HASH, byteSize: 1, expandedBytes: 1 };
}
function state(collection: Collection, downloaded: string[], deferred: string[]): NoctyriumState {
  return {
    questions: [], documents: [], [collection]: downloaded.map(id => ({ id })),
    deferredContent: deferred.length ? {
      accountId: "owner", questions: [], documents: [], media: [],
      [collection]: deferred.map(id => ({ id })), sources: deferred.map(id => ref(collection, id)),
    } : undefined,
  } as unknown as NoctyriumState;
}
function noIO() {
  for (const mock of [mocks.account, mocks.hydrate, mocks.split, mocks.media, mocks.original, mocks.setState]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  setQuestionAttachmentAccount("owner");
  mocks.account.mockResolvedValue({ client: {}, userId: "owner", assertCurrent: async () => {} });
  mocks.hydrate.mockImplementation(async (_client, _userId, partial) => partial);
  mocks.media.mockReturnValue(new Map());
  mocks.split.mockResolvedValue({ objects: [] });
  mocks.original.mockResolvedValue(undefined);
  mocks.getBlob.mockResolvedValue(undefined);
  mocks.putBlob.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
});
afterEach(() => setQuestionAttachmentAccount(undefined));

describe.each(collections)("content identity admission: %s", collection => {
  it.each([{ selection: undefined }, { selection: ["x"] }, { selection: ["unselected"] }])("rejects overlap before any I/O (selection %j)", async ({ selection }) => {
    const remote = state(collection, ["x"], ["x"]);
    const before = JSON.stringify(remote);
    const filter = selection === undefined ? undefined : collection === "questions" ? { questionIds: selection } : { documentIds: selection };
    await expect(materializeState(remote, filter)).rejects.toThrow(/overlap/);
    mocks.getState.mockReturnValue(remote);
    await expect(downloadAccountContent(filter)).rejects.toThrow(/overlap/);
    expect(() => contentMetadata(remote)).toThrow(/overlap/);
    expect(JSON.stringify(remote)).toBe(before);
    noIO();
  });

  it.each([true, false])("rejects overlap before retention digest work (matching=%s)", async matching => {
    const remote = state(collection, ["x"], ["x"]);
    const local = state(collection, ["x"], []);
    mocks.split.mockResolvedValue({ objects: matching ? [{ reference: ref(collection, "x") }] : [] });
    const before = JSON.stringify([remote, local]);
    await expect(retainDownloadedContent(remote, local)).rejects.toThrow(/overlap/);
    expect(JSON.stringify([remote, local])).toBe(before);
    noIO();
  });

  it.each([{ downloaded: ["x", "x"] }, { downloaded: [""] }])("refuses ambiguous downloaded identities %j", async ({ downloaded }) => {
    const remote = state(collection, downloaded, ["y"]);
    const before = JSON.stringify(remote);
    expect(() => contentMetadata(remote)).toThrow(/identit/);
    await expect(materializeState(remote)).rejects.toThrow(/identit/);
    await expect(retainDownloadedContent(remote, state(collection, ["y"], []))).rejects.toThrow(/identit/);
    expect(JSON.stringify(remote)).toBe(before);
    noIO();
  });

  it("refuses duplicate deferred IDs and ambiguous local retention sources", async () => {
    const remote = state(collection, ["x"], ["y"]);
    const bad = state(collection, ["x"], ["y", "y"]);
    const local = state(collection, ["y", "y"], []);
    const before = JSON.stringify([remote, bad, local]);
    await expect(materializeState(bad)).rejects.toThrow();
    await expect(retainDownloadedContent(remote, local)).rejects.toThrow(/identit/);
    expect(JSON.stringify([remote, bad, local])).toBe(before);
    noIO();
  });

  it("preserves distinct IDs and exact-digest retention", async () => {
    const remote = state(collection, ["x"], ["y"]);
    const local = state(collection, ["y"], []);
    mocks.split.mockResolvedValue({ objects: [{ reference: ref(collection, "y") }] });
    const before = JSON.stringify([remote, local]);
    expect(contentMetadata(remote)[collection].map(r => r.id)).toEqual(["x", "y"]);
    const retained = await retainDownloadedContent(remote, local);
    expect(retained[collection].map(r => r.id)).toEqual(["x", "y"]);
    expect(retained.deferredContent).toBeUndefined();
    const materialized = await materializeState(remote);
    expect(materialized[collection].map(r => r.id)).toEqual(["x", "y"]);
    expect(materialized.deferredContent).toBeUndefined();
    expect(JSON.stringify([remote, local])).toBe(before);
  });
});
it("does not conflate question and document namespaces", async () => {
  const remote = state("documents", [], ["same"]);
  remote.questions = [{ id: "same" }] as NoctyriumState["questions"];
  const before = JSON.stringify(remote);
  const result = contentMetadata(remote);
  expect(result.questions.map(r => r.id)).toEqual(["same"]);
  expect(result.documents.map(r => r.id)).toEqual(["same"]);
  const downloaded = await materializeState(remote);
  expect(downloaded.questions.map(r => r.id)).toEqual(["same"]);
  expect(downloaded.documents.map(r => r.id)).toEqual(["same"]);
  expect(JSON.stringify(remote)).toBe(before);
});

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function figures(count = 1) {
  const remote = state("questions", [], ["y"]);
  const updatedAt = "2026-11-01T00:00:00.000Z";
  const entries = Array.from({ length: count }, (_, i) => {
    const blobKey = `figure-${i}`;
    return [blobKey, {
      questionId: "y", attachment: {
        id: blobKey, blobKey, byteSize: 1, mimeType: "image/png",
        fileName: "figure.png", altText: "", createdAt: updatedAt, updatedAt,
      },
    }] as const;
  });
  remote.deferredContent!.media = entries.map(([blobKey]) => ({ blobKey, hash: HASH, byteSize: 1, updatedAt }));
  mocks.media.mockReturnValue(new Map(entries));
  return remote;
}

describe("deferred binary account isolation", () => {
  it.each([0, 3])("drains all started peers and stops dispatch after download failure at index %s", async failing => {
    const remote = figures(5);
    const before = JSON.stringify(remote);
    const peers = Array.from({ length: 4 }, () => pending<Blob>());
    const started = pending<void>();
    let calls = 0;
    mocks.download.mockImplementation(() => {
      const peer = peers[calls++];
      if (calls === 4) started.resolve(undefined);
      if (!peer) throw new Error("Unexpected additional download");
      return peer.promise;
    });
    let settled = false;
    const result = materializeState(remote).then(
      () => { settled = true; return undefined; },
      error => { settled = true; return error; },
    );
    await started.promise;
    const failure = new Error("download failed");
    peers[failing].reject(failure);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    peers.forEach((peer, i) => { if (i !== failing) peer.resolve(new Blob(["x"])); });
    expect(await result).toBe(failure);
    expect(calls).toBe(4);
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(JSON.stringify(remote)).toBe(before);
  });

  it.each([false, true])("rejects A/B or A/B/A transition inside asynchronous guard (ABA=%s)", async aba => {
    const remote = figures();
    const before = JSON.stringify(remote);
    let downloaded = false;
    mocks.download.mockImplementation(async () => { downloaded = true; return new Blob(["x"]); });
    mocks.account.mockResolvedValue({
      client: {}, userId: "owner", assertCurrent: async () => {
        if (downloaded) {
          setQuestionAttachmentAccount("other");
          if (aba) setQuestionAttachmentAccount("owner");
        }
      },
    });
    await expect(materializeState(remote)).rejects.toThrow(/account changed/);
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(JSON.stringify(remote)).toBe(before);
  });

  it("pins all local binary access to the initiating account and generation", async () => {
    const remote = figures();
    const before = JSON.stringify(remote);
    const scope = getQuestionAttachmentScope();
    const result = await materializeState(remote);
    expect(mocks.getBlob).toHaveBeenCalledWith("figure-0", { scope, accountId: "owner", localOnly: true });
    expect(mocks.putBlob).toHaveBeenCalledWith("figure-0", expect.objectContaining({ questionId: "y" }), { scope, accountId: "owner" });
    expect(result.deferredContent).toBeUndefined();
    expect(JSON.stringify(remote)).toBe(before);
  });

  it("does not overwrite a known conflicting local record", async () => {
    const remote = figures();
    mocks.getBlob.mockResolvedValue({ blob: new Blob(["wrong size"]) });
    await expect(materializeState(remote)).rejects.toThrow(/different size/);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });

  it("retains a same-size local copy discovered during the download", async () => {
    const remote = figures();
    mocks.getBlob.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ blob: new Blob(["x"]) });
    await materializeState(remote);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });

  it("refuses adoption after an account transition even if the workspace reference is unchanged", async () => {
    const remote = figures();
    mocks.getState.mockReturnValueOnce(remote).mockImplementationOnce(() => {
      setQuestionAttachmentAccount("other");
      setQuestionAttachmentAccount("owner");
      return remote;
    });
    await expect(downloadAccountContent()).rejects.toThrow(/workspace changed/);
    expect(mocks.setState).not.toHaveBeenCalled();
  });
});
