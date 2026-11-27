// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressText, sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudContentCache, hydrateCloudContent, readContentReferences, uploadCloudContent, type ContentReference, type ContentUpload } from "./cloudContent";

const A = "synthetic-a";
const B = "synthetic-b";
const guard = async () => {};
const size = (text: string) => new TextEncoder().encode(text).length;

async function fixture(stem = "Synthetic é 字") {
  const text = JSON.stringify({ stem });
  const packed = await compressText(text);
  const hash = await sha256(new TextEncoder().encode(packed));
  const reference: ContentReference = { collection: "questions", id: "q", hash, byteSize: size(packed), expandedBytes: size(text) };
  const object: ContentUpload = { reference, content: packed, canonicalText: text, canonicalHash: await sha256(new TextEncoder().encode(text)) };
  const state = makeSeed();
  state.documents = [];
  state.questions = [{ id: "q", notes: "Keep learner overlay" } as NoctyriumState["questions"][number]];
  const blobs = new Map<string, Blob>();
  const download = vi.fn(async (path: string) => {
    const data = blobs.get(path);
    return data ? { data, error: null } : { data: null, error: new Error("Synthetic missing") };
  });
  const upload = vi.fn(async (path: string, data: Blob): Promise<{ error: unknown }> => {
    blobs.set(path, data);
    return { error: null };
  });
  const client = { storage: { from(bucket: string) {
    expect(bucket).toBe("workspace-content");
    return { download, upload };
  } } } as unknown as SupabaseClient;
  const hydrate = (owner: string, ref = reference, assertCurrent = guard) =>
    hydrateCloudContent(client, owner, state, [ref], assertCurrent);
  const push = (owner: string, previous: ContentReference[] = [], assertCurrent = guard) =>
    uploadCloudContent(client, owner, [object], previous, assertCurrent);
  return { stem, packed, reference, state, blobs, download, upload, hydrate, push };
}

beforeEach(() => clearCloudContentCache());

describe("private source object proof", () => {
  it.each([false, true])("requires verified packed byte size on every cache hit (compressed=%s)", async compressed => {
    const f = await fixture(compressed ? "é字".repeat(5000) : "Synthetic é 字");
    if (compressed) expect(f.packed).toMatch(/^AXOM_GZIP_V1:/);
    else expect(f.reference.byteSize).toBeGreaterThan(f.packed.length);
    const before = JSON.stringify(f.state);
    for (const owner of [A, B]) f.blobs.set(owner + "/" + f.reference.hash, new Blob([f.packed]));
    expect((await f.hydrate(A)).questions[0]).toMatchObject({ stem: f.stem, notes: "Keep learner overlay" });
    await f.hydrate(A);
    expect(f.download).toHaveBeenCalledTimes(1);
    for (const delta of [-1, 1]) {
      await expect(f.hydrate(A, { ...f.reference, byteSize: f.reference.byteSize + delta })).rejects.toThrow(/could not be downloaded or verified/);
    }
    expect(f.download).toHaveBeenCalledTimes(1);
    await expect(f.hydrate(B, { ...f.reference, byteSize: f.reference.byteSize - 1 })).rejects.toThrow(/could not be downloaded or verified/);
    await f.hydrate(B);
    await f.hydrate(A);
    expect(f.download).toHaveBeenCalledTimes(3);
    clearCloudContentCache();
    await expect(f.hydrate(A, { ...f.reference, byteSize: f.reference.byteSize + 1 })).rejects.toThrow(/could not be downloaded or verified/);
    expect(f.download).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(f.state)).toBe(before);
  });

  it("does not treat a prior academic digest as a private object receipt", async () => {
    const f = await fixture();
    const academic: ContentReference = { ...f.reference, academic: {
      revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path: "banks/source.json", sha256: "f".repeat(64),
      adapterVersion: 1, kind: "question", questionId: "q", reviewedAt: "2026-11-01T00:00:00Z",
    } };
    await f.push(A, [academic]);
    expect(f.upload).toHaveBeenCalledTimes(1);
    await f.push(A);
    expect(f.upload).toHaveBeenCalledTimes(1);
    clearCloudContentCache();
    expect((await f.hydrate(A)).questions[0].stem).toBe(f.stem);
    await f.push(A, [f.reference]);
    expect(f.upload).toHaveBeenCalledTimes(1);
    await f.push(B, [academic]);
    expect(f.upload).toHaveBeenCalledTimes(2);
  });

  it("does not confirm a failed upload or an unverifiable conflict", async () => {
    const f = await fixture();
    f.upload.mockResolvedValueOnce({ error: new Error("Synthetic write denied") });
    await expect(f.push(A)).rejects.toThrow("Synthetic write denied");
    f.upload.mockResolvedValueOnce({ error: { statusCode: "409" } });
    f.blobs.set(A + "/" + f.reference.hash, new Blob(["wrong bytes"]));
    await expect(f.push(A)).rejects.toThrow(/could not be verified/);
    await f.push(A);
    expect(f.upload).toHaveBeenCalledTimes(3);
    await f.push(A);
    expect(f.upload).toHaveBeenCalledTimes(3);
    clearCloudContentCache();
    f.upload.mockResolvedValueOnce({ error: { statusCode: "409" } });
    await f.push(A);
    expect(f.download).toHaveBeenCalledTimes(2);
    await f.push(A);
    expect(f.upload).toHaveBeenCalledTimes(4);
  });

  it("refuses a changed account before upload and before hydration adoption", async () => {
    const f = await fixture();
    const before = JSON.stringify(f.state);
    const changed = async () => { throw new Error("Account changed"); };
    await expect(f.push(A, [], changed)).rejects.toThrow("Account changed");
    expect(f.upload).not.toHaveBeenCalled();
    await f.push(A);
    let checks = 0;
    await expect(f.hydrate(A, f.reference, async () => {
      if (++checks > 1) throw new Error("Account changed");
    })).rejects.toThrow("Account changed");
    expect(JSON.stringify(f.state)).toBe(before);
  });
});

describe("lossless private source decoding", () => {
  it.each([
    [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0xff],
  ].map(bytes => ({ bytes })))("rejects hash-matching malformed UTF-8 without caching: $bytes", async ({ bytes }) => {
    const f = await fixture();
    const blob = new Blob(['{"stem":"', Uint8Array.from(bytes), '"}']);
    const ref = { ...f.reference, hash: await sha256(new Uint8Array(await blob.arrayBuffer())),
      byteSize: blob.size, expandedBytes: size(await blob.text()) };
    for (const owner of [A, B]) f.blobs.set(owner + "/" + ref.hash, blob);
    const before = JSON.stringify(f.state);
    for (const owner of [A, A, B, A]) {
      await expect(f.hydrate(owner, ref)).rejects.toThrow();
      expect(JSON.stringify(f.state)).toBe(before);
    }
    expect(f.download).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])("preserves valid replacement characters and legacy leading BOM (BOM=%s)", async bom => {
    const f = await fixture();
    const stem = "Synthetic � é 字";
    const text = JSON.stringify({ stem });
    const blob = new Blob([(bom ? "\uFEFF" : "") + text]);
    const ref = { ...f.reference, hash: await sha256(new Uint8Array(await blob.arrayBuffer())),
      byteSize: blob.size, expandedBytes: size(text) };
    for (const owner of [A, B]) f.blobs.set(owner + "/" + ref.hash, blob);
    const before = JSON.stringify(f.state);
    for (const owner of [A, A, B, A]) {
      expect((await f.hydrate(owner, ref)).questions[0]).toMatchObject({ stem, notes: "Keep learner overlay" });
    }
    expect(f.download).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.state)).toBe(before);
  });

  it.each([
    { text: '{"stem":"ok"}', delta: 1 },
    { text: '{"forbidden":1}', delta: 0 },
    { text: '{', delta: 0 },
  ])("does not cache a rejected source: $text", async ({ text, delta }) => {
    const f = await fixture();
    const blob = new Blob([text]);
    const ref = { ...f.reference, hash: await sha256(new Uint8Array(await blob.arrayBuffer())),
      byteSize: blob.size, expandedBytes: size(text) + delta };
    f.blobs.set(A + "/" + ref.hash, blob);
    const before = JSON.stringify(f.state);
    await expect(f.hydrate(A, ref)).rejects.toThrow();
    await expect(f.hydrate(A, ref)).rejects.toThrow();
    expect(f.download).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.state)).toBe(before);
  });
});

describe("private digest size agreement", () => {
  it.each(["byteSize", "expandedBytes"] as const)("refuses conflicting %s before download or upload in either order", async field => {
    const f = await fixture();
    const second: ContentReference = { ...f.reference, id: "q2", [field]: f.reference[field] + 1 };
    const state = { ...f.state, questions: [...f.state.questions, { ...f.state.questions[0], id: "q2" }] };
    const before = JSON.stringify(state);
    const client = { storage: { from: () => ({ download: f.download, upload: f.upload }) } } as unknown as SupabaseClient;
    for (const refs of [[f.reference, second], [second, f.reference]]) {
      const snapshot = JSON.stringify(refs);
      expect(() => readContentReferences(refs)).toThrow(/conflicting private file sizes/);
      await expect(hydrateCloudContent(client, A, state, refs, guard)).rejects.toThrow(/conflicting private file sizes/);
      await expect(uploadCloudContent(client, A, refs.map(reference => ({ reference, content: f.packed, canonicalText: "", canonicalHash: reference.hash })), [], guard)).rejects.toThrow(/conflicting private file sizes/);
      expect(JSON.stringify(refs)).toBe(snapshot);
    }
    expect(f.download).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("admits identical reuse across collections and separate academic claims", async () => {
    const f = await fixture();
    const twin: ContentReference = { ...f.reference, collection: "documents" };
    const academic: ContentReference = { ...f.reference, id: "shared", byteSize: f.reference.byteSize + 1, academic: {
      revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path: "banks/source.json", sha256: "f".repeat(64),
      adapterVersion: 1, kind: "question", questionId: "shared", reviewedAt: "2026-11-01T00:00:00Z",
    } };
    expect(readContentReferences([f.reference, twin, academic])).toEqual([f.reference, twin, academic]);
  });

  it("does not reuse a prior receipt with different size claims", async () => {
    const f = await fixture();
    await f.push(A, [{ ...f.reference, expandedBytes: f.reference.expandedBytes + 1 }]);
    expect(f.upload).toHaveBeenCalledTimes(1);
    await f.push(A);
    expect(f.upload).toHaveBeenCalledTimes(1);
  });

  it("checks packed byte size before starting a new upload despite a same-hash receipt", async () => {
    const f = await fixture();
    await f.push(A);
    const client = { storage: { from: () => ({ download: f.download, upload: f.upload }) } } as unknown as SupabaseClient;
    const object: ContentUpload = { reference: { ...f.reference, byteSize: f.reference.byteSize + 1 }, content: f.packed, canonicalText: "", canonicalHash: f.reference.hash };
    await expect(uploadCloudContent(client, A, [object], [], guard)).rejects.toThrow(/could not be verified/);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.download).not.toHaveBeenCalled();
  });
});
