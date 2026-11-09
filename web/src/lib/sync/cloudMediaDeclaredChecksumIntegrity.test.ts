// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { validateWorkspaceMedia, workspaceMedia } from "./cloudMedia";

/**
 * A packaged question may carry the SHA-256 of its original image in
 * content.assets. A cloud manifest must not certify another hash just because
 * the attachment's size, blobKey and timestamp happen to agree.
 *
 * Pure synthetic metadata: no Supabase connection, login, browser, or writes.
 */
const AT = "2026-11-02T00:00:00.000Z";
const BLOB_KEY = "synthetic-declared-checksum-image";
const ORIGINAL = "a".repeat(64);
const OTHER = "b".repeat(64);

function stateWithChecksum(hash?: string): NoctyriumState {
  const state = makeSeed();
  const question: QuestionRecord = {
    id: "synthetic-q-with-image",
    source: "manual",
    stem: "Review the original figure.",
    options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "attachment-1",
      assetId: "asset-1",
      blobKey: BLOB_KEY,
      fileName: "figure.png",
      mimeType: "image/png",
      byteSize: 5,
      altText: "Source figure",
      createdAt: AT,
      updatedAt: AT,
    }],
    content: {
      id: "synthetic-package-question",
      source: { filename: "synthetic-source.pdf" },
      stem: [{ type: "image", assetId: "asset-1" }],
      choices: [],
      assets: [{
        id: "asset-1",
        filename: "figure.png",
        mimeType: "image/png",
        role: "stem",
        questionId: "synthetic-package-question",
        ...(hash ? { checksum: `sha256:${hash}` } : {}),
      }],
      provenance: { method: "authored" },
    },
    createdAt: AT,
    updatedAt: AT,
  };
  state.questions = [question];
  state.documents = [];
  return state;
}

function manifest(hash: string) {
  return [{ blobKey: BLOB_KEY, hash, byteSize: 5, updatedAt: AT }];
}

describe("cloud image protection versus source-declared SHA-256", () => {
  it("accepts an exact matching hash when the original declares its checksum", () => {
    const state = stateWithChecksum(ORIGINAL);
    expect(workspaceMedia(state).get(BLOB_KEY)?.checksum).toBe(ORIGINAL);
    expect(validateWorkspaceMedia(state, manifest(ORIGINAL))).toHaveLength(1);
  });

  it("fails closed when the manifest hash disagrees with the declared original, even if size and timestamp match", () => {
    const state = stateWithChecksum(ORIGINAL);
    expect(workspaceMedia(state).get(BLOB_KEY)?.checksum).toBe(ORIGINAL);
    expect(() => validateWorkspaceMedia(state, manifest(OTHER))).toThrow();
  });

  it("preserves compatibility for legacy attachments without a declared checksum", () => {
    const state = stateWithChecksum();
    expect(workspaceMedia(state).get(BLOB_KEY)?.checksum).toBeUndefined();
    expect(validateWorkspaceMedia(state, manifest(ORIGINAL))).toHaveLength(1);
  });
});
