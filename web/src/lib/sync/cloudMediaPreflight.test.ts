// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import { findMissingWorkspaceMedia, type CloudMediaReference } from "./cloudMedia";

const owner = "preflight-owner";
const at = "2026-11-09T00:00:00.000Z";
const hash = "a".repeat(64);
const guard = async () => {};

function fixture() {
  const state = makeSeed();
  const attachment = {
    id: "image", blobKey: crypto.randomUUID(), fileName: "renal-figure.png", mimeType: "image/png" as const,
    byteSize: 5, altText: "Source figure", createdAt: at, updatedAt: at,
  };
  state.questions = [{ id: "source-question", stem: "Identify the structure in this source figure.", options: [{ key: "A", text: "A" }],
    source: "manual", correctKey: "A", status: "unseen", tags: [], attempts: [], notes: "", attachments: [attachment], createdAt: at, updatedAt: at }];
  state.documents = [];
  const receipt: CloudMediaReference = { blobKey: attachment.blobKey, hash, byteSize: 5, updatedAt: at };
  return { state, attachment, receipt };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  setQuestionAttachmentAccount(owner);
});

describe("question image availability before content upload", () => {
  it("identifies an absent source without modifying questions, references, or saved receipts", async () => {
    const { state, attachment } = fixture();
    const before = JSON.stringify(state);
    expect(await findMissingWorkspaceMedia(owner, state, guard)).toEqual([{
      questionId: "source-question", questionLabel: state.questions[0].stem, fileName: attachment.fileName,
    }]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("accepts an available account-owned original", async () => {
    const { state, attachment } = fixture();
    await putQuestionAttachmentBlob(attachment.blobKey, {
      questionId: "source-question", blob: new Blob(["image"]), byteSize: 5, mimeType: "image/png", updatedAt: at,
    });
    expect(await findMissingWorkspaceMedia(owner, state, guard)).toEqual([]);
  });

  it("keeps exact prior receipts eligible for later remote recovery but rejects a stale receipt", async () => {
    const { state, receipt } = fixture();
    expect(await findMissingWorkspaceMedia(owner, state, guard, [receipt])).toEqual([]);
    expect(await findMissingWorkspaceMedia(owner, state, guard, [{ ...receipt, updatedAt: "2026-11-08T00:00:00.000Z" }])).toHaveLength(1);
  });

  it("does not let a prior receipt hide a present but incomplete local original", async () => {
    const { state, attachment, receipt } = fixture();
    await putQuestionAttachmentBlob(attachment.blobKey, {
      questionId: "source-question", blob: new Blob(["bad"]), byteSize: 3, mimeType: "image/png", updatedAt: at,
    });
    expect(await findMissingWorkspaceMedia(owner, state, guard, [receipt])).toHaveLength(1);
  });

  it("preserves academic revision identity rather than accepting a different same-hash binding", async () => {
    const { state, receipt } = fixture();
    const academic = { revisionId: "11111111-1111-4111-8111-111111111111", path: "figures/source.png", sha256: hash };
    state.documents = [{ id: "bindings", fileType: "axom-academic-reference", rawText: JSON.stringify({
      bindings: { sources: [], assets: [academic] },
    }) }] as unknown as typeof state.documents;
    expect(await findMissingWorkspaceMedia(owner, state, guard, [{ ...receipt, academic }])).toEqual([]);
    expect(await findMissingWorkspaceMedia(owner, state, guard, [{ ...receipt,
      academic: { ...academic, revisionId: "22222222-2222-4222-8222-222222222222" },
    }])).toHaveLength(1);
  });

  it("stops if the account changes while checking an original", async () => {
    const { state } = fixture();
    let checks = 0;
    await expect(findMissingWorkspaceMedia(owner, state, async () => {
      if (++checks === 3) throw new Error("Account changed");
    })).rejects.toThrow("Account changed");
  });
});
