// @vitest-environment node
// Synthetic identity receipts only; never upload student images or account data.
import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { validateWorkspaceMedia, workspaceMedia } from "./cloudMedia";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const KEY = `private-library:sha256:${HASH}`;
const FIRST = "2026-11-10T01:00:00.000Z";
const SECOND = "2026-11-12T02:00:00.000Z";

function question(id: string, updatedAt: string, byteSize = 12, digest = HASH): QuestionRecord {
  const assetId = `figure-${id}`;
  return {
    id, source: "manual", stem: "Identify the source figure.",
    options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
    correctKey: "A", status: "unseen", attempts: [], tags: [], notes: "",
    attachments: [{
      id: `attachment-${id}`, blobKey: KEY, assetId, fileName: "figure.png",
      mimeType: "image/png", byteSize, altText: "Figure",
      createdAt: updatedAt, updatedAt,
    }],
    content: {
      id, source: { filename: "synthetic.pdf" },
      stem: [{ type: "image", assetId }], choices: [],
      assets: [{
        id: assetId, filename: "figure.png", mimeType: "image/png",
        role: "stem", questionId: id, checksum: `sha256:${digest}`,
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

describe("content-addressed private-library images reused in review documents", () => {
  it("accepts the same immutable image across independently uploaded source reviews", () => {
    const state = stateFor(question("early", FIRST), question("late", SECOND));
    const refs = workspaceMedia(state);
    expect(refs.size).toBe(1);
    expect(refs.get(KEY)?.attachment.updatedAt).toBe(FIRST);
    expect(refs.get(KEY)?.checksum).toBe(HASH);
    expect(validateWorkspaceMedia(state, [
      { blobKey: KEY, hash: HASH, byteSize: 12, updatedAt: FIRST },
    ])).toHaveLength(1);
  });

  it("does not depend on the order in which source reviews are stored", () => {
    const forward = workspaceMedia(stateFor(question("early", FIRST), question("late", SECOND)));
    const reverse = workspaceMedia(stateFor(question("late", SECOND), question("early", FIRST)));
    expect(forward.get(KEY)?.attachment.updatedAt).toBe(FIRST);
    expect(reverse.get(KEY)?.attachment.updatedAt).toBe(FIRST);
  });

  it("still rejects different checksums, sizes and MIME types for the shared digest key", () => {
    expect(() => workspaceMedia(stateFor(question("a", FIRST), question("b", SECOND, 13)))).toThrow();
    expect(() => workspaceMedia(stateFor(question("a", FIRST), question("b", SECOND, 12, OTHER)))).toThrow();
    const alternate = question("b", SECOND);
    alternate.attachments![0].mimeType = "image/jpeg";
    expect(() => workspaceMedia(stateFor(question("a", FIRST), alternate))).toThrow();
  });

  it("preserves strict timestamp checks for regular mutable blob keys", () => {
    const a = question("a", FIRST), b = question("b", SECOND);
    a.attachments![0].blobKey = "mutable-example";
    b.attachments![0].blobKey = "mutable-example";
    expect(() => workspaceMedia(stateFor(a, b))).toThrow();
  });
});
