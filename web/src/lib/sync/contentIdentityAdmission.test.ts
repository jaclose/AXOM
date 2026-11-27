// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoctyriumState } from "../types";
import type { ContentReference } from "./cloudContent";
import { contentMetadata } from "./deferredContent";
import { downloadAccountContent, materializeState, retainDownloadedContent } from "./contentDownloads";

const mocks = vi.hoisted(() => ({
  account: vi.fn(), hydrate: vi.fn(), split: vi.fn(), media: vi.fn(),
  getState: vi.fn(), setState: vi.fn(), original: vi.fn(),
}));
vi.mock("../account/supabase", () => ({ accountOperationClient: mocks.account }));
vi.mock("../store", () => ({ useStore: { getState: mocks.getState, setState: mocks.setState } }));
vi.mock("./cloudContent", async importOriginal => ({
  ...await importOriginal<typeof import("./cloudContent")>(),
  hydrateCloudContent: mocks.hydrate, splitCloudContent: mocks.split,
}));
vi.mock("./cloudMedia", async importOriginal => ({
  ...await importOriginal<typeof import("./cloudMedia")>(), workspaceMedia: mocks.media,
}));
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
  mocks.account.mockResolvedValue({ client: {}, userId: "owner", assertCurrent: async () => {} });
  mocks.hydrate.mockImplementation(async (_client, _userId, partial) => partial);
  mocks.media.mockReturnValue(new Map());
  mocks.split.mockResolvedValue({ objects: [] });
  mocks.original.mockResolvedValue(undefined);
});

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
