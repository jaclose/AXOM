// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * Synthetic recovery acceptance: the same SHA-256 bytes can belong to distinct
 * academic revisions with distinct RLS permissions. A prior receipt bound to B
 * may not silently become a receipt for A merely because A appears first in
 * storedAcademicBindings. An absent local cache must never license rebinding.
 *
 * No live account, source media, network/storage deletion or production writes.
 */
const REV_A = "11111111-1111-4111-8111-111111111111";
const REV_B = "22222222-2222-4222-8222-222222222222";
const PATH_A = "figures/revision-a.png";
const PATH_B = "figures/revision-b.png";
const AT = "2026-11-08T00:00:00.000Z";
const OWNER = "synthetic-owner";
const BYTES = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 3, 4]);
const assertCurrent = async () => {};

async function fixture(order: "AB" | "BA", denied: Set<string> = new Set()) {
  const hash = await sha256(BYTES);
  const academicA = { revisionId: REV_A, path: PATH_A, sha256: hash };
  const academicB = { revisionId: REV_B, path: PATH_B, sha256: hash };
  const blobKey = "synthetic-missing-academic-" + crypto.randomUUID();
  const state = makeSeed();
  state.questions = [{
    id: "synthetic-active-academic-question",
    source: "manual",
    stem: "A cached academic figure must keep its original authorized binding.",
    options: [{ key: "A", text: "A" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "synthetic-active-academic-attachment",
      blobKey,
      fileName: "figure.png",
      mimeType: "image/png",
      byteSize: BYTES.length,
      altText: "Synthetic missing local figure",
      createdAt: AT,
      updatedAt: AT,
    }],
    createdAt: AT,
    updatedAt: AT,
  }];
  // The active blob is deliberately NOT installed into fake IndexedDB: this
  // exercises the previous-manifest recovery path, not a fresh upload.
  state.documents = [{
    id: "synthetic-academic-binding-index",
    fileType: "axom-academic-reference",
    rawText: JSON.stringify({
      bindings: { sources: [], assets: order === "AB" ? [academicA, academicB] : [academicB, academicA] },
    }),
  }] as unknown as NoctyriumState["documents"];
  const checked: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw new Error("Unexpected table: " + table);
      return {
        select(_columns: string) {
          let revision = "";
          let path = "";
          const query = {
            eq(column: string, value: string) {
              if (column === "revision_id") revision = value;
              else if (column === "path") path = value;
              else throw new Error("Unexpected academic filter " + column);
              return query;
            },
            async single() {
              checked.push(revision + ":" + path);
              if (denied.has(revision))
                return { data: null, error: { code: "PGRST116", message: "synthetic RLS denied" } };
              return {
                data: { object_path: "authorized/" + revision, sha256: hash, byte_size: BYTES.length, mime_type: "image/png" },
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
          async download() { return { data: new Blob([BYTES], { type: "image/png" }), error: null }; },
        };
        if (bucket === "workspace-media") return {
          async upload() { throw new Error("No upload of a missing original is allowed"); },
          async download() { throw new Error("No private object exists in this fixture"); },
        };
        throw new Error("Unexpected bucket " + bucket);
      },
    },
  } as unknown as SupabaseClient;
  const previous = [{ blobKey, hash, byteSize: BYTES.length, updatedAt: AT, academic: academicB }];
  return { state, client, checked, previous, academicB };
}

beforeEach(() => {
  setQuestionAttachmentAccount(OWNER);
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
});

describe("active media previous-manifest academic provenance", () => {
  it("retains the exact previously authorized revision B rather than substituting first same-hash revision A", async () => {
    const { state, client, checked, previous, academicB } = await fixture("AB");
    const receipt = await uploadCloudMedia(client, OWNER, state, assertCurrent, previous);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].academic).toEqual(academicB);
    expect(checked).toContain(REV_B + ":" + PATH_B);
  });

  it("refuses protection when original binding B is denied, even if same-hash revision A is accessible", async () => {
    const { state, client, checked, previous } = await fixture("AB", new Set([REV_B]));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, previous)).rejects.toThrow();
    expect(checked).toContain(REV_B + ":" + PATH_B);
  });

  it("rejects denied original B also when B precedes A (order-independent denial control)", async () => {
    const { state, client, checked, previous } = await fixture("BA", new Set([REV_B]));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, previous)).rejects.toThrow();
    expect(checked).toContain(REV_B + ":" + PATH_B);
  });
});
