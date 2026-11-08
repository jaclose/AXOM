// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { validateWorkspaceMedia, workspaceMedia } from "./cloudMedia";

/**
 * A cloud manifest is keyed by blobKey, whereas a workspace can reference the
 * same key from multiple questions. Identical references may share an object,
 * but contradictory source identities must not be silently overwritten by a
 * Map.set and then marked protected.
 *
 * Synthetic workspace only: no account, network or production storage.
 */
const AT = "2026-11-02T00:00:00.000Z";
const LATER = "2026-11-02T00:01:00.000Z";
const SHARED = "synthetic-shared-question-image";

function question(id: string, byteSize: number, updatedAt = AT) {
  return {
    id, stem: "Source figure", options: [{ key: "A", text: "A" }],
    source: "manual" as const, correctKey: "A", status: "unseen" as const,
    tags: [], attempts: [], notes: "",
    attachments: [{
      id: `attachment-${id}`, blobKey: SHARED, fileName: `${id}.png`,
      mimeType: "image/png" as const, byteSize, altText: "Source figure",
      createdAt: AT, updatedAt,
    }],
    createdAt: AT, updatedAt: AT,
  };
}

function syntheticState(firstSize: number, secondSize: number, secondAt = AT): NoctyriumState {
  const state = makeSeed();
  state.questions = [question("q-first", firstSize), question("q-second", secondSize, secondAt)];
  state.documents = [];
  return state;
}

function manifest(byteSize: number, updatedAt = AT) {
  return [{ blobKey: SHARED, hash: "a".repeat(64), byteSize, updatedAt }];
}

describe("account image manifest shared-key collision integrity", () => {
  it("rejects conflicting byte sizes across question references instead of certifying only the last one", () => {
    const state = syntheticState(5, 7);
    // The current Map.set implementation collapses both sources to one row;
    // matching the last attachment is insufficient evidence of completeness.
    expect(() => validateWorkspaceMedia(state, manifest(7))).toThrow();
  });

  it("rejects conflicting modification timestamps for one shared blobKey", () => {
    const state = syntheticState(5, 5, LATER);
    expect(() => validateWorkspaceMedia(state, manifest(5, LATER))).toThrow();
  });

  it("still permits identical metadata for an intentionally shared image", () => {
    const state = syntheticState(5, 5);
    expect(workspaceMedia(state).size).toBe(1);
    expect(validateWorkspaceMedia(state, manifest(5))).toHaveLength(1);
  });
});
