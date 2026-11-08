// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { awaitReviewedImportReceipt } from "./ImportPanel";
import type { SavedReviewedImport } from "../../lib/questionImportSave";

const rejected: SavedReviewedImport = {
  ok: false,
  message: "The account changed while importing questions.",
  rollbackFailures: [],
};
const confirmed: SavedReviewedImport = {
  ok: true,
  reused: true,
  joined: false,
  setId: "source-confirmed-set",
  documentId: undefined,
  questionIds: ["source-confirmed-question"],
  reusedDocument: false,
  images: { attached: 0, missing: 0, problems: [] },
};
const newSet: SavedReviewedImport = {
  ...confirmed, reused: false,
};

function deferredReceipt() {
  let release!: (value: SavedReviewedImport) => void;
  const pending = new Promise<SavedReviewedImport>((resolve) => { release = resolve; });
  return { pending, release };
}

describe("Import Center duplicate-import receipt feedback", () => {
  it("holds success feedback until an equivalent import confirms durable reuse", async () => {
    const gate = deferredReceipt();
    let settled = false;
    const result = awaitReviewedImportReceipt(gate.pending, true);
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.release(confirmed);
    await expect(result).resolves.toEqual({
      saved: confirmed,
      reusedNotice: {
        title: "Import already finalized",
        body: expect.stringContaining("reused the existing set"),
        tone: "success",
      },
    });
  });

  it("never reports reused success after a typed account-change rejection", async () => {
    const gate = deferredReceipt();
    const result = awaitReviewedImportReceipt(gate.pending, true);
    gate.release(rejected);
    await expect(result).resolves.toEqual({ saved: rejected });
  });

  it("does not mislabel a newly created set or a non-equivalent join", async () => {
    await expect(awaitReviewedImportReceipt(Promise.resolve(newSet), true))
      .resolves.toEqual({ saved: newSet });
    await expect(awaitReviewedImportReceipt(Promise.resolve(confirmed), false))
      .resolves.toEqual({ saved: confirmed });
  });
});
