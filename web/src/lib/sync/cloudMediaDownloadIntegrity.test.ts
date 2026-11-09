// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { MEDIA_BUCKET, downloadCloudMediaAsset, type CloudMediaReference } from "./cloudMedia";

/**
 * Synthetic account image fixtures only. Never touch production users, storage
 * buckets, question attachments, migrations or media. This acceptance checks
 * byte-for-byte recovery, not merely matching length or MIME metadata.
 */
const originalBytes = new Uint8Array([137, 80, 78, 71, 10, 20, 30, 40, 50]);
const original = () => new Blob([originalBytes], { type: "image/png" });
const reference = async (): Promise<CloudMediaReference> => ({
  blobKey: "qa-synthetic-source-figure",
  hash: await sha256(originalBytes),
  byteSize: originalBytes.byteLength,
  updatedAt: "2026-11-07T12:00:00.000Z",
});

function mockMediaClient(blob: Blob | null, error: unknown = null) {
  const download = vi.fn(async (_path: string) => ({ data: blob, error }));
  const from = vi.fn((_bucket: string) => ({ download }));
  return { client: { storage: { from } } as unknown as SupabaseClient, from, download };
}

describe("account question-image recovery: immutable original integrity", () => {
  it("restores exactly the authenticated account's original bytes", async () => {
    const expected = await reference();
    const { client, from, download } = mockMediaClient(original());
    const restored = await downloadCloudMediaAsset(client, "synthetic-owner-a", expected);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(originalBytes);
    expect(from).toHaveBeenCalledExactlyOnceWith(MEDIA_BUCKET);
    expect(download).toHaveBeenCalledExactlyOnceWith(`synthetic-owner-a/${expected.hash}`);
  });

  it("rejects equal-size altered binary bytes instead of declaring an image restored", async () => {
    const expected = await reference();
    const corrupted = new Blob([new Uint8Array([137, 80, 78, 71, 10, 20, 30, 40, 51])], { type: "image/png" });
    expect(corrupted.size).toBe(expected.byteSize);
    const { client } = mockMediaClient(corrupted);
    await expect(downloadCloudMediaAsset(client, "synthetic-owner-a", expected))
      .rejects.toThrow("The downloaded image failed its integrity check.");
  });

  it("rejects truncated and absent bytes; never silently returns a partial original", async () => {
    const expected = await reference();
    const truncated = mockMediaClient(new Blob([originalBytes.slice(0, -1)], { type: "image/png" }));
    await expect(downloadCloudMediaAsset(truncated.client, "synthetic-owner-a", expected))
      .rejects.toThrow("The downloaded image failed its integrity check.");
    const absent = mockMediaClient(null);
    await expect(downloadCloudMediaAsset(absent.client, "synthetic-owner-a", expected))
      .rejects.toThrow("The downloaded image failed its integrity check.");
    const unavailable = mockMediaClient(null, { statusCode: "404", message: "not found" });
    await expect(downloadCloudMediaAsset(unavailable.client, "synthetic-owner-a", expected))
      .rejects.toThrow("This image is not available offline yet. Reconnect and retry.");
  });

  it("scopes object download paths to the requested account, without a cross-account fallback", async () => {
    const expected = await reference();
    const first = mockMediaClient(original());
    const second = mockMediaClient(null, { statusCode: "404" });
    await downloadCloudMediaAsset(first.client, "synthetic-owner-a", expected);
    await expect(downloadCloudMediaAsset(second.client, "synthetic-owner-b", expected))
      .rejects.toThrow("This image is not available offline yet. Reconnect and retry.");
    expect(first.download).toHaveBeenCalledExactlyOnceWith(`synthetic-owner-a/${expected.hash}`);
    expect(second.download).toHaveBeenCalledExactlyOnceWith(`synthetic-owner-b/${expected.hash}`);
  });
});
