// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent synthetic acceptance: identical image bytes are not authority to
 * access a *different* academic revision. RLS must be evaluated for each
 * distinct revision/path, even when hashes and sizes agree.
 * No credentials, production sessions, remote objects, or learner data used.
 */
const REV_A = "11111111-1111-4111-8111-111111111111";
const REV_B = "22222222-2222-4222-8222-222222222222";
const PATH = "assets/shared-figure.png";
const AT = "2026-11-08T00:00:00.000Z";
const BYTES = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 1, 2]);
const OWNER = "synthetic-account";

async function fixture(denied: Set<string> = new Set()) {
  const hash = await sha256(BYTES);
  const academicA = { revisionId: REV_A, path: PATH, sha256: hash };
  const academicB = { revisionId: REV_B, path: PATH, sha256: hash };
  const state = makeSeed();
  state.questions = [];
  state.documents = [];
  state.deferredContent = {
    accountId: OWNER,
    questions: [{ id: "synthetic-question-a" }, { id: "synthetic-question-b" }],
    documents: [],
    sources: [
      { collection: "questions", id: "synthetic-question-a", hash: "a".repeat(64), byteSize: 1, expandedBytes: 1 },
      { collection: "questions", id: "synthetic-question-b", hash: "b".repeat(64), byteSize: 1, expandedBytes: 1 },
    ],
    media: [
      { blobKey: "synthetic-figure-a", hash, byteSize: BYTES.length, updatedAt: AT, academic: academicA },
      { blobKey: "synthetic-figure-b", hash, byteSize: BYTES.length, updatedAt: AT, academic: academicB },
    ],
  };
  const checked: string[] = [];
  const downloads: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw new Error("Unexpected table: " + table);
      return {
        select(_columns: string) {
          let revisionId = "";
          let path = "";
          const query = {
            eq(column: string, value: string) {
              if (column === "revision_id") revisionId = value;
              else if (column === "path") path = value;
              else throw new Error("Unexpected filter: " + column);
              return query;
            },
            async single() {
              checked.push(revisionId + ":" + path);
              if (denied.has(revisionId))
                return { data: null, error: { code: "PGRST116", message: "RLS denied" } };
              return { data: { object_path: "authorized/" + revisionId, sha256: hash, byte_size: BYTES.length, mime_type: "image/png" }, error: null };
            },
          };
          return query;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket === "academic-content") return {
          async download(path: string) {
            downloads.push(path);
            return { data: new Blob([BYTES], { type: "image/png" }), error: null };
          },
        };
        if (bucket === "workspace-media") return {
          async upload() { throw new Error("Private upload not expected"); },
          async download() { throw new Error("Private download not expected"); },
        };
        throw new Error("Unexpected bucket: " + bucket);
      },
    },
  } as unknown as SupabaseClient;
  return { state: state as NoctyriumState, client, checked, downloads };
}
const assertCurrent = async () => {};

beforeEach(() => { clearCloudMediaUploadCache(); });

describe("deferred academic media requires per-binding RLS proof", () => {
  it("verifies both distinct authorized revisions even when their byte hashes match", async () => {
    const { client, state, checked } = await fixture();
    const receipt = await uploadCloudMedia(client, OWNER, state, assertCurrent);
    expect(receipt).toHaveLength(2);
    expect(checked).toContain(REV_A + ":" + PATH);
    expect(checked).toContain(REV_B + ":" + PATH);
  });

  it("refuses a receipt if second same-hash revision is no longer authorized", async () => {
    const { client, state, checked } = await fixture(new Set([REV_B]));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent)).rejects.toThrow();
    expect(checked).toContain(REV_B + ":" + PATH);
  });

  it("also refuses a receipt when the first revision is denied", async () => {
    const { client, state } = await fixture(new Set([REV_A]));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent)).rejects.toThrow();
  });
});
