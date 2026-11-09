// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { validateWorkspaceMedia } from "./cloudMedia";

/**
 * The same blobKey can be referenced from multiple questions. Matching size
 * and timestamp alone do not establish that those questions refer to the same
 * source original. A source-declared checksum is an identity constraint and
 * must not be overwritten by Map.set or lost when another reference has no
 * checksum.
 *
 * Entirely synthetic metadata. No network, browser session, storage mutation,
 * signed-in account, image replacement, or production access.
 */
const AT = "2026-11-02T00:00:00.000Z";
const SHARED = "synthetic-shared-checksum-image";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function question(id: string, checksum?: string): QuestionRecord {
  const assetId = `asset-${id}`;
  return {
    id,
    source: "manual",
    stem: "Preserve the source figure.",
    options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: `attachment-${id}`,
      assetId,
      blobKey: SHARED,
      fileName: "original.png",
      mimeType: "image/png",
      byteSize: 5,
      altText: "Original source figure",
      createdAt: AT,
      updatedAt: AT,
    }],
    content: {
      id: `package-${id}`,
      source: { filename: `source-${id}.pdf` },
      stem: [{ type: "image", assetId }],
      choices: [],
      assets: [{
        id: assetId,
        filename: "original.png",
        mimeType: "image/png",
        role: "stem",
        questionId: `package-${id}`,
        ...(checksum ? { checksum: `sha256:${checksum}` } : {}),
      }],
      provenance: { method: "authored" },
    },
    createdAt: AT,
    updatedAt: AT,
  };
}

function stateFor(first?: string, second?: string): NoctyriumState {
  const state = makeSeed();
  state.questions = [question("first", first), question("second", second)];
  state.documents = [];
  return state;
}

function manifest(hash: string) {
  return [{ blobKey: SHARED, hash, byteSize: 5, updatedAt: AT }];
}

describe("cross-question shared blobKey checksum integrity", () => {
  it("rejects distinct declared hashes even when the manifest matches the last reference", () => {
    expect(() => validateWorkspaceMedia(stateFor(HASH_A, HASH_B), manifest(HASH_B))).toThrow();
  });

  it("rejects distinct declared hashes regardless of reference iteration order", () => {
    expect(() => validateWorkspaceMedia(stateFor(HASH_B, HASH_A), manifest(HASH_A))).toThrow();
  });

  it("does not discard a verified source checksum when a later reference omits one", () => {
    expect(() => validateWorkspaceMedia(stateFor(HASH_A), manifest(HASH_B))).toThrow();
  });

  it("preserves legitimate shared originals with identical source checksums", () => {
    expect(validateWorkspaceMedia(stateFor(HASH_A, HASH_A), manifest(HASH_A))).toHaveLength(1);
  });
});
