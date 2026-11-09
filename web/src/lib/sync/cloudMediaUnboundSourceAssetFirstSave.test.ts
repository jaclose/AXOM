// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, downloadCloudMediaAsset, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent, test-only first-save source-attachment provenance acceptance.
 *
 * A checksum in an imported question's own source asset proves byte identity;
 * it does NOT establish that an unrelated installed academic revision is the
 * source of that image or that the learner may rely on its revocable RLS for
 * recovery. #291 handles manual/unattested images; this scenario is an
 * imported, source-checksum-attested, *unbound* personal PDF asset.
 *
 * All fixtures are synthetic. No real learner account, production backend,
 * image, database migration or remote upload is touched.
 */
const OWNER = "synthetic-private-pdf-account";
const REV_OTHER = "44444444-4444-4444-8444-444444444444";
const PATH_OTHER = "other-course/independent-figure.png";
const AT = "2026-11-08T00:00:00.000Z";
const BYTES = new Uint8Array([137, 80, 78, 71, 80, 82, 73, 86, 5, 9, 17]);
const assertCurrent = async () => {};

async function fixture(unrelatedCourseInstalled: boolean) {
  const hash = await sha256(BYTES);
  const pdfHash = await sha256(new TextEncoder().encode("synthetic privately imported lecture PDF"));
  const unrelated = { revisionId: REV_OTHER, path: PATH_OTHER, sha256: hash };
  const blob = new Blob([BYTES], { type: "image/png" });
  const blobKey = "synthetic-pdf-" + crypto.randomUUID();
  const id = "my-pdf-imported-question";
  const assetId = "private-pdf-image";
  const attachment = {
    id: "attachment-" + blobKey,
    blobKey,
    assetId,
    fileName: "my-pdf-figure.png",
    mimeType: "image/png" as const,
    byteSize: blob.size,
    altText: "Figure extracted from independently imported personal PDF",
    createdAt: AT, updatedAt: AT,
  };
  await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: id, blob });
  const state = makeSeed();
  state.questions = [{
    id, source: "pdf",
    stem: "A locally imported source image needs independent recovery.",
    options: [{ key: "A", text: "A" }], correctKey: "A",
    status: "unseen", tags: [], attempts: [], notes: "",
    content: {
      id,
      provenance: { method: "pdf-import", sourceChecksum: "sha256:" + pdfHash },
      assets: [{ id: assetId, questionId: id, filename: "my-pdf-figure.png",
        mimeType: "image/png", role: "question", checksum: "sha256:" + hash }],
    } as unknown as QuestionRecord["content"],
    attachments: [attachment], createdAt: AT, updatedAt: AT,
  }];
  // Stored academic binding B is unrelated to the personal imported PDF.
  // It happens to contain identical image bytes; the question has no
  // source-binding receipt for this revision/path.
  state.documents = unrelatedCourseInstalled ? [{
    id: "unrelated-installed-course",
    fileType: "axom-academic-reference",
    rawText: JSON.stringify({ bindings: { sources: [], assets: [unrelated] } }),
  }] as unknown as NoctyriumState["documents"] : [];
  const originals = new Map<string, Blob>();
  const academicChecks: string[] = [];
  let courseAuthorized = true;
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw new Error("Unexpected table " + table);
      return {
        select(_fields: string) {
          let revision = "", path = "";
          const q = {
            eq(column: string, value: string) {
              if (column === "revision_id") revision = value;
              else if (column === "path") path = value;
              else throw new Error("Unexpected filter " + column);
              return q;
            },
            async single() {
              academicChecks.push(revision + ":" + path);
              if (!courseAuthorized) return {
                data: null, error: { code: "PGRST116", message: "Synthetic course RLS denied" },
              };
              return { data: { object_path: "synthetic/course/object", sha256: hash,
                byte_size: BYTES.length, mime_type: "image/png" }, error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket === "academic-content") return {
          async download() {
            if (!courseAuthorized) return { data: null, error: { statusCode: "403" } };
            return { data: new Blob([BYTES], { type: "image/png" }), error: null };
          },
        };
        if (bucket === "workspace-media") return {
          async upload(path: string, data: Blob) {
            if (originals.has(path)) return { error: { statusCode: "409" } };
            originals.set(path, data);
            return { error: null };
          },
          async download(path: string) {
            const data = originals.get(path) ?? null;
            return { data, error: data ? null : { statusCode: "404" } };
          },
        };
        throw new Error("Unexpected storage bucket " + bucket);
      },
    },
  } as unknown as SupabaseClient;
  return {
    state, client, hash, blobKey, unrelated, originals, academicChecks,
    revokeCourse() { courseAuthorized = false; },
  };
}

beforeEach(() => {
  setQuestionAttachmentAccount(OWNER);
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
});

describe("first-save imported source asset must not be rebound by unrelated academic image SHA-256", () => {
  it("positive control: source-checksum-attested personal PDF image with no academic match saves privately", async () => {
    const f = await fixture(false);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].academic).toBeUndefined();
    expect(f.originals.has(OWNER + "/" + f.hash)).toBe(true);
  });

  it("does not promote unbound personal PDF image to an unrelated academic revision with identical bytes", async () => {
    const f = await fixture(true);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].academic).toBeUndefined();
    expect(f.originals.has(OWNER + "/" + f.hash)).toBe(true);
    expect(f.academicChecks).toEqual([]);
  });

  it("restores the personal PDF original after unrelated course RLS is revoked", async () => {
    const f = await fixture(true);
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent);
    f.revokeCourse();
    const restored = await downloadCloudMediaAsset(f.client, OWNER, manifest[0]);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(BYTES);
    expect(manifest[0].academic).toBeUndefined();
  });

  it("control: a previously verified exact academic revision remains academic, not silently demoted", async () => {
    const f = await fixture(true);
    const previous = [{ blobKey: f.blobKey, hash: f.hash, byteSize: BYTES.length,
      updatedAt: AT, academic: f.unrelated }];
    const manifest = await uploadCloudMedia(f.client, OWNER, f.state, assertCurrent, previous);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].academic).toEqual(f.unrelated);
    expect(f.academicChecks).toContain(REV_OTHER + ":" + PATH_OTHER);
  });
});
