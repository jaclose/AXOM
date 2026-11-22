// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { workspaceMedia, validateWorkspaceMedia } from "./cloudMedia";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const KEY = `private-library:sha256:${HASH}`;
const FIRST = "2026-11-10T01:00:00.000Z";
const SECOND = "2026-11-12T02:00:00.000Z";
// Keep the older persisted timestamp; no incompatible cloud-media index migration.
const CANONICAL = FIRST;

function question(id: string, updatedAt: string, bytes = 12, hash = HASH): QuestionRecord {
  const assetId = `asset-${id}`;
  return {
    id, source: "manual", stem: "Which original figure is shown?",
    options: [{ key: "A", text: "Image A" }, { key: "B", text: "Image B" }],
    correctKey: "A", status: "unseen", attempts: [], tags: [], notes: "",
    attachments: [{
      id: `attachment-${id}`, blobKey: KEY, assetId, fileName: "figure.png",
      mimeType: "image/png", byteSize: bytes, altText: "Source",
      createdAt: updatedAt, updatedAt,
    }],
    content: {
      id, source: { filename: "source.pdf" },
      stem: [{ type: "image", assetId }], choices: [],
      assets: [{
        id: assetId, filename: "figure.png", mimeType: "image/png",
        role: "stem", questionId: id, checksum: `sha256:${hash}`,
      }],
      provenance: { method: "manual-transcription" },
    },
    createdAt: FIRST, updatedAt,
  };
}

function stateFor(...questions: QuestionRecord[]): NoctyriumState {
  const state = makeSeed();
  state.documents = [];
  state.questions = questions;
  return state;
}

function manifest(): Array<{ blobKey: string; hash: string; byteSize: number; updatedAt: string }> {
  return [{ blobKey: KEY, hash: HASH, byteSize: 12, updatedAt: CANONICAL }];
}

describe("immutable private-library media across staged imports and saved reviews", () => {
  it("allows one verified image digest referenced by questions imported on different dates", () => {
    const state = stateFor(question("first", FIRST), question("second", SECOND));
    expect(workspaceMedia(state).size).toBe(1);
    expect(workspaceMedia(state).get(KEY)?.attachment.updatedAt).toBe(CANONICAL);
    expect(validateWorkspaceMedia(state, manifest())).toHaveLength(1);
  });

  it("retains stable cloud metadata when source-question iteration order reverses", () => {
    const first = stateFor(question("first", FIRST), question("second", SECOND));
    const second = stateFor(question("second", SECOND), question("first", FIRST));
    expect(workspaceMedia(first).get(KEY)?.attachment.updatedAt).toBe(CANONICAL);
    expect(workspaceMedia(second).get(KEY)?.attachment.updatedAt).toBe(CANONICAL);
  });

  it("rejects changed bytes, a conflicting declared SHA-256, and mismatched formats", () => {
    expect(() => workspaceMedia(stateFor(question("first", FIRST, 12), question("second", SECOND, 13)))).toThrow();
    expect(() => workspaceMedia(stateFor(question("first", FIRST), question("second", SECOND, 12, OTHER)))).toThrow();
    const alternate = question("second", SECOND);
    alternate.attachments![0].mimeType = "image/jpeg";
    expect(() => workspaceMedia(stateFor(question("first", FIRST), alternate))).toThrow();
  });

  it("does not relax timestamp collisions for a non-content-addressed image", () => {
    const original = question("first", FIRST), altered = question("second", SECOND);
    original.attachments![0].blobKey = "not-content-addressed";
    altered.attachments![0].blobKey = "not-content-addressed";
    expect(() => workspaceMedia(stateFor(original, altered))).toThrow();
  });
});
