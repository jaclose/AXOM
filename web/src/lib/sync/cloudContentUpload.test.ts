// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { clearCloudContentCache, type ContentUpload, uploadCloudContent } from "./cloudContent";

async function record(id: string): Promise<ContentUpload> {
  const content = JSON.stringify({ stem: `Question ${id}` });
  const bytes = new TextEncoder().encode(content);
  const hash = await sha256(bytes);
  return {
    content, canonicalText: content, canonicalHash: hash,
    reference: { collection: "questions", id, hash, byteSize: bytes.length, expandedBytes: bytes.length },
  };
}

function storageClient(upload: (...args: unknown[]) => unknown, download: (...args: unknown[]) => unknown): SupabaseClient {
  return { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
}

const guard = vi.fn(async () => undefined);
beforeEach(() => { clearCloudContentCache(); guard.mockClear(); });

describe("cloud content upload", () => {
  it("uploads a large batch with bounded parallel requests", async () => {
    const records = await Promise.all(Array.from({ length: 17 }, (_, index) => record(String(index))));
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const upload = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return { error: null };
    });
    const client = storageClient(upload, vi.fn());
    const progress = vi.fn();
    const pending = uploadCloudContent(client, "account-a", records, [], guard, progress);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(8));
    expect(active).toBe(8);
    expect(progress).toHaveBeenLastCalledWith(0, records.length);
    release();
    await pending;
    expect(upload).toHaveBeenCalledTimes(records.length);
    expect(peak).toBe(8);
    expect(progress).toHaveBeenLastCalledWith(records.length, records.length);
  });

  it("deduplicates a batch and reuses only account-scoped verified uploads on retry", async () => {
    const first = await record("first");
    const second = await record("second");
    const twin = { ...first, reference: { ...first.reference, id: "twin" } };
    const upload = vi.fn(async () => ({ error: null }));
    const client = storageClient(upload, vi.fn());
    await uploadCloudContent(client, "account-a", [first, second, twin], [], guard);
    expect(upload).toHaveBeenCalledTimes(2);
    await uploadCloudContent(client, "account-a", [first, second], [], guard);
    expect(upload).toHaveBeenCalledTimes(2);
    await uploadCloudContent(client, "account-b", [first, second], [], guard);
    expect(upload).toHaveBeenCalledTimes(4);
    clearCloudContentCache();
    await uploadCloudContent(client, "account-a", [first], [], guard);
    expect(upload).toHaveBeenCalledTimes(5);
  });

  it("caches a conflict only after downloading and hashing the existing bytes", async () => {
    const item = await record("source");
    let remote = new Blob(["corrupt"]);
    const upload = vi.fn(async () => ({ error: { statusCode: "409" } }));
    const download = vi.fn(async () => ({ data: remote, error: null }));
    const client = storageClient(upload, download);
    await expect(uploadCloudContent(client, "account-a", [item], [], guard)).rejects.toThrow(/could not be verified/);
    expect(download).toHaveBeenCalledTimes(1);
    remote = new Blob([item.content]);
    await uploadCloudContent(client, "account-a", [item], [], guard);
    expect(download).toHaveBeenCalledTimes(2);
    await uploadCloudContent(client, "account-a", [item], [], guard);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("stops scheduling after an error and waits for in-flight uploads to finish", async () => {
    const records = await Promise.all(Array.from({ length: 12 }, (_, index) => record(String(index))));
    const resolveUpload: Array<(value: { error: Error | null }) => void> = [];
    const upload = vi.fn(() => new Promise<{ error: Error | null }>(resolve => { resolveUpload.push(resolve); }));
    const client = storageClient(upload, vi.fn());
    let finished = false;
    const result = uploadCloudContent(client, "account-a", records, [], guard)
      .then(() => "resolved", (error: Error) => error.message)
      .finally(() => { finished = true; });
    await vi.waitFor(() => expect(resolveUpload).toHaveLength(8));
    resolveUpload[0]({ error: new Error("Upload refused") });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    for (const resolve of resolveUpload.slice(1)) resolve({ error: null });
    expect(await result).toBe("Upload refused");
    expect(upload).toHaveBeenCalledTimes(8);
    upload.mockImplementation(async () => ({ error: null }));
    await uploadCloudContent(client, "account-a", records, [], guard);
    expect(upload).toHaveBeenCalledTimes(13);
  });
});
