// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, downloadCloudMediaAsset, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent first-protection provenance acceptance, stacked on #286.
 *
 * A manually created PRIVATE question image does not inherit an installed
 * course's revocable academic access merely because the bytes match a unique
 * course asset. Unlike the existing #285 repair, there is NO prior protected
 * private manifest here. Original private bytes must be backed up to the
 * account's own namespace before a protected save can be certified.
 *
 * Synthetic IndexedDB/Storage/RLS only. No live accounts, source files,
 * production uploads, deletion, migrations, or runtime modifications.
 */
const OWNER = "synthetic-fresh-private-owner";
const REVISION = "99999999-9999-4999-8999-999999999999";
const PATH = "figures/independent-course-figure.png";
const AT = "2026-11-08T00:00:00.000Z";
const BYTES = new Uint8Array([137, 80, 78, 71, 31, 52, 17, 8, 6]);
const assertCurrent = async () => {};

async function fixture(installIdenticalCourse: boolean) {
  const hash = await sha256(BYTES);
  const academic = { revisionId: REVISION, path: PATH, sha256: hash };
  const blob = new Blob([BYTES], { type: "image/png" });
  const blobKey = "synthetic-manual-" + crypto.randomUUID();
  const attachment = {
    id: "synthetic-manual-attachment", blobKey,
    fileName: "my-question-image.png",
    mimeType: "image/png" as const,
    byteSize: blob.size, altText: "Independently authored private image",
    createdAt: AT, updatedAt: AT,
  };
  await putQuestionAttachmentBlob(blobKey, {
    ...attachment, questionId: "synthetic-private-question", blob,
  });
  const state = makeSeed();
  state.questions = [{
    id: "synthetic-private-question", source: "manual",
    stem: "My own question image must retain its private recovery authority.",
    options: [{ key: "A", text: "A" }], correctKey: "A",
    status: "unseen", tags: [], attempts: [], notes: "",
    attachments: [attachment], createdAt: AT, updatedAt: AT,
  }];
  state.documents = installIdenticalCourse ? [{
    id: "unrelated-installed-course", fileType: "axom-academic-reference",
    rawText: JSON.stringify({ bindings: { sources: [], assets: [academic] } }),
  }] as unknown as NoctyriumState["documents"] : [];
  const accountOriginals = new Map<string, Blob>();
  const checks: string[] = [];
  let courseAvailable = true;
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw new Error("Unexpected table: " + table);
      return {
        select(_fields: string) {
          let revision = "";
          let path = "";
          const query = {
            eq(field: string, value: string) {
              if (field === "revision_id") revision = value;
              else if (field === "path") path = value;
              else throw new Error("Unexpected academic filter: " + field);
              return query;
            },
            async single() {
              checks.push(revision + ":" + path);
              if (!courseAvailable) return {
                data: null, error: { code: "PGRST116", message: "Synthetic course access revoked" },
              };
              return {
                data: {
                  object_path: "synthetic/course/" + REVISION,
                  sha256: hash, byte_size: BYTES.length, mime_type: "image/png",
                },
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
        if (bucket === "academic-content") return {
          async download() {
            if (!courseAvailable) return { data: null, error: { statusCode: "403" } };
            return { data: new Blob([BYTES], { type: "image/png" }), error: null };
          },
        };
        if (bucket === "workspace-media") return {
          async upload(path: string, original: Blob) {
            if (accountOriginals.has(path)) return { error: { statusCode: "409" } };
            accountOriginals.set(path, original);
            return { error: null };
          },
          async download(path: string) {
            const data = accountOriginals.get(path) ?? null;
            return { data, error: data ? null : { statusCode: "404" } };
          },
        };
        throw new Error("Unexpected storage bucket: " + bucket);
      },
    },
  } as unknown as SupabaseClient;
  return {
    state, client, hash, checks, accountOriginals,
    revokeCourse() { courseAvailable = false; },
  };
}

beforeEach(() => {
  setQuestionAttachmentAccount(OWNER);
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
});

describe("fresh private image must not acquire revocable academic provenance from unique identical bytes", () => {
  it("positive control: original with no matching installed course is uploaded and restored privately", async () => {
    const f = await fixture(false);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].academic).toBeUndefined();
    expect(f.accountOriginals.has(OWNER + "/" + f.hash)).toBe(true);
    const restored = await downloadCloudMediaAsset(f.client, OWNER, manifest[0]);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(BYTES);
  });

  it("requires first-time private backup even if exactly one unrelated course image has the same SHA-256", async () => {
    const f = await fixture(true);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].academic).toBeUndefined();
    expect(f.accountOriginals.has(OWNER + "/" + f.hash)).toBe(true);
    expect(f.checks).toEqual([]);
  });

  it("restores a freshly protected private original after unrelated matching course access is revoked", async () => {
    const f = await fixture(true);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(manifest).toHaveLength(1);
    f.revokeCourse();
    const restored = await downloadCloudMediaAsset(f.client, OWNER, manifest[0]);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(BYTES);
    expect(manifest[0].academic).toBeUndefined();
    expect(f.accountOriginals.has(OWNER + "/" + f.hash)).toBe(true);
  });
});
