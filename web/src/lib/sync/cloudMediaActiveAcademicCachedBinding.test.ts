// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, downloadCloudMediaAsset, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent, synthetic regression lock for #273.
 *
 * A live local Blob and an identical SHA-256 do NOT authorize substituting a
 * distinct academic revision. The currently associated revision/path must
 * pass its own RLS check, or protection must remain pending. An ambiguous
 * unbound image may instead be uploaded as an account-private original.
 *
 * No authenticated account, external data, production bucket, or deletion.
 */
const REV_A = "11111111-1111-4111-8111-111111111111";
const REV_B = "22222222-2222-4222-8222-222222222222";
const PATH_A = "figures/academic-a.png";
const PATH_B = "figures/academic-b.png";
const AT = "2026-11-08T00:00:00.000Z";
const OWNER = "synthetic-academic-cache-account";
const BYTES = new Uint8Array([137, 80, 78, 71, 42, 23, 11, 7]);
const assertCurrent = async () => {};

async function fixture(options: { includeB?: boolean; denyB?: boolean } = {}) {
  const hash = await sha256(BYTES);
  const academicA = { revisionId: REV_A, path: PATH_A, sha256: hash };
  const academicB = { revisionId: REV_B, path: PATH_B, sha256: hash };
  const blobKey = "synthetic-cached-" + crypto.randomUUID();
  const blob = new Blob([BYTES], { type: "image/png" });
  const attachment = {
    id: "synthetic-attachment", blobKey, fileName: "original.png",
    mimeType: "image/png" as const, byteSize: blob.size,
    altText: "Synthetic local original", createdAt: AT, updatedAt: AT,
  };
  await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: "synthetic-question", blob });
  const state = makeSeed();
  state.questions = [{
    id: "synthetic-question", source: "manual", stem: "Preserve revision authorization",
    options: [{ key: "A", text: "A" }], correctKey: "A",
    status: "unseen", tags: [], attempts: [], notes: "",
    attachments: [attachment], createdAt: AT, updatedAt: AT,
  }];
  state.documents = [{
    id: "synthetic-reference-file", fileType: "axom-academic-reference",
    rawText: JSON.stringify({
      bindings: { sources: [], assets: options.includeB === false ? [academicA] : [academicA, academicB] },
    }),
  }] as unknown as NoctyriumState["documents"];
  const checked: string[] = [];
  const downloaded: string[] = [];
  const privateUploaded: string[] = [];
  const privateDownloaded: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw Error("Unexpected table " + table);
      return {
        select(_fields: string) {
          let revision = "";
          let path = "";
          const query = {
            eq(field: string, value: string) {
              if (field === "revision_id") revision = value;
              else if (field === "path") path = value;
              else throw Error("Unexpected field " + field);
              return query;
            },
            async single() {
              checked.push(revision + ":" + path);
              if (options.denyB && revision === REV_B) {
                return { data: null, error: { code: "PGRST116", message: "synthetic RLS denial" } };
              }
              return {
                data: { object_path: "synthetic/" + revision, sha256: hash,
                  byte_size: BYTES.length, mime_type: "image/png" },
                error: null,
              };
            },
          };
          return query;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket === "academic-content") {
          return {
            async download(path: string) {
              downloaded.push(path);
              return { data: new Blob([BYTES], { type: "image/png" }), error: null };
            },
          };
        }
        if (bucket === "workspace-media") {
          return {
            async upload(path: string, uploaded: Blob) {
              privateUploaded.push(path);
              expect(uploaded.size).toBe(BYTES.length);
              return { error: null };
            },
            async download(path: string) {
              privateDownloaded.push(path);
              return { data: new Blob([BYTES], { type: "image/png" }), error: null };
            },
          };
        }
        throw Error("Unexpected bucket " + bucket);
      },
    },
  } as unknown as SupabaseClient;
  const previous = [{ blobKey, hash, byteSize: BYTES.length, updatedAt: AT, academic: academicB }];
  return { state, client, checked, downloaded, privateUploaded, privateDownloaded, previous, academicB, hash };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
});

describe("live-cache academic image revision authority", () => {
  it("preserves previously authorized B even when same-hash A appears first", async () => {
    const f = await fixture();
    const receipt = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, f.previous);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].academic).toEqual(f.academicB);
    expect(f.checked).toEqual([REV_B + ":" + PATH_B]);
    expect(f.privateUploaded).toHaveLength(0);
  });

  it("fails closed for denied B despite cached original and accessible same-hash A", async () => {
    const f = await fixture({ denyB: true });
    await expect(uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, f.previous))
      .rejects.toThrow();
    expect(f.checked).toEqual([REV_B + ":" + PATH_B]);
    expect(f.downloaded).toHaveLength(0);
    expect(f.privateUploaded).toHaveLength(0);
  });

  it("refuses a revoked B binding rather than silently rebinding local bytes to A", async () => {
    const f = await fixture({ includeB: false });
    await expect(uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, f.previous))
      .rejects.toThrow("original academic image binding is no longer available");
    expect(f.checked).toHaveLength(0);
    expect(f.privateUploaded).toHaveLength(0);
  });

  it("uploads an unbound ambiguous same-hash figure privately instead of guessing an academic revision", async () => {
    const f = await fixture();
    const receipt = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].academic).toBeUndefined();
    expect(receipt[0].hash).toBe(f.hash);
    expect(f.checked).toHaveLength(0);
    expect(f.privateUploaded).toEqual([OWNER + "/" + f.hash]);
  });
  it("never silently converts an existing private protected original into academic-only media by matching hash", async () => {
    const f = await fixture({ includeB: false });
    // The protected prior receipt is explicitly PRIVATE, although an unrelated
    // subsequently installed course happens to contain the very same bytes.
    // Changing the receipt to academic changes recovery/access semantics:
    // revoking course RLS would then break restore of the user's private image.
    const previousPrivate = f.previous.map(({ academic: _academic, ...rest }) => rest);
    const receipt = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, previousPrivate);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].academic).toBeUndefined();
    expect(receipt[0].hash).toBe(f.hash);
    expect(f.checked).toHaveLength(0);
    expect(f.privateDownloaded).toEqual([OWNER + "/" + f.hash]);
    expect(f.privateUploaded).toHaveLength(0);
  });


  it("restores a previously private original after identical-hash academic access is revoked", async () => {
    const f = await fixture({ includeB: false });
    // Protected account-private receipt predates the unrelated course asset.
    // Preserve the private recovery path regardless of subsequent course RLS.
    const previousPrivate = f.previous.map(({ academic: _academic, ...rest }) => rest);
    const renewed = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, previousPrivate);
    expect(renewed).toHaveLength(1);

    // The course revision is now unreadable. The account-private original
    // remains byte-for-byte available and is never modified or replaced.
    const courseRevoked = {
      ...f.client,
      from(table: string) {
        if (table !== "academic_files") throw Error("Unexpected table " + table);
        return {
          select(_fields: string) {
            const query = {
              eq(_field: string, _value: string) { return query; },
              async single() {
                return { data: null, error: { code: "PGRST116", message: "synthetic academic access revoked" } };
              },
            };
            return query;
          },
        };
      },
    } as unknown as SupabaseClient;

    const restored = await downloadCloudMediaAsset(courseRevoked, OWNER, renewed[0]);
    expect([...new Uint8Array(await restored.arrayBuffer())]).toEqual([...BYTES]);
    expect(f.privateDownloaded).toEqual([OWNER + "/" + f.hash, OWNER + "/" + f.hash]);
    expect(f.privateUploaded).toHaveLength(0);
  });

});
