// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import { MEDIA_BUCKET, clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

// Synthetic-only audit: the identity/revision token is deliberately checked
// after a blocked network read. An A -> B -> A return must not resurrect A's
// *previous* in-flight receipt merely because the final account ID matches.
const owner = "qa-media-epoch-owner";
const secondOwner = "qa-media-epoch-other";
const originals = new Map<string, Blob>();
const upload = vi.fn(async (path: string, bytes: Blob) => {
  if (originals.has(path)) return { error: { statusCode: "409" } };
  originals.set(path, bytes);
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  const data = originals.get(path);
  return data
    ? { data, error: null }
    : { data: null, error: { statusCode: "404" } };
});
const client = { storage: { from: (bucket: string) => {
  expect(bucket).toBe(MEDIA_BUCKET);
  return { upload, download };
} } } as unknown as SupabaseClient;

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  setQuestionAttachmentAccount(owner);
  clearCloudMediaUploadCache();
  originals.clear();
  upload.mockClear();
  download.mockClear();
});

async function fixture() {
  const at = "2026-11-10T00:00:00.000Z";
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 11, 22, 33])], { type: "image/png" });
  const blobKey = `qa-epoch-${crypto.randomUUID()}`;
  const attachment = {
    id: blobKey, blobKey, fileName: "exact.png", mimeType: "image/png" as const,
    byteSize: blob.size, altText: "Synthetic epoch probe", createdAt: at, updatedAt: at,
  };
  await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: "qa-epoch-question", blob }, { accountId: owner });
  const state = makeSeed();
  state.questions = [{
    id: "qa-epoch-question", stem: "Synthetic media", options: [{ key: "A", text: "A" }],
    source: "manual", correctKey: "A", status: "unseen", tags: [],
    attempts: [], notes: "", attachments: [attachment], createdAt: at, updatedAt: at,
  }];
  state.documents = [];
  const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
  return { state, blobKey, blob, path: `${owner}/${hash}` };
}

describe("current-main media integrity: in-flight epoch revocation", () => {
  it.each(["A -> B -> A", "same-account edit revision"])(
    "rejects stale protection after %s while a remote original is in flight",
    async (scenario) => {
      const { state, blobKey, blob, path } = await fixture();
      const before = await uploadCloudMedia(client, owner, state, async () => undefined);
      expect(before).toHaveLength(1);
      expect(originals.has(path)).toBe(true);

      // The old caller started under epoch 1; a matching account name alone
      // must never be sufficient to accept its eventual cloud readback.
      let epoch = 1;
      const captured = epoch;
      const guard = async () => {
        if (epoch !== captured) throw new Error("QA media epoch revoked");
      };

      let entered!: () => void;
      let release!: (value: { data: Blob; error: null }) => void;
      const networkEntered = new Promise<void>(resolve => { entered = resolve; });
      const blockedRead = new Promise<{ data: Blob; error: null }>(resolve => { release = resolve; });
      download.mockClear();
      upload.mockClear();
      download.mockImplementationOnce(async () => {
        entered();
        return blockedRead;
      });

      const staleAttempt = uploadCloudMedia(client, owner, state, guard, before);
      await networkEntered; // Hold at the actual remote read, not a fake timer.
      if (scenario === "A -> B -> A") {
        setQuestionAttachmentAccount(secondOwner);
        epoch += 1;
        expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: secondOwner }))
          .toBeUndefined();
        setQuestionAttachmentAccount(owner);
        epoch += 1;
      } else {
        epoch += 1; // A new workspace revision invalidates the earlier receipt.
      }
      release({ data: blob, error: null });

      await expect(staleAttempt).rejects.toThrow("QA media epoch revoked");
      expect(upload).not.toHaveBeenCalled();
      expect(originals.has(path)).toBe(true);
      expect([...originals.keys()].every(key => key.startsWith(`${owner}/`))).toBe(true);

      // The same account can still verify the authentic original on a fresh
      // epoch; failed stale approval must not delete or replace its bytes.
      const currentEpoch = epoch;
      const freshGuard = async () => {
        if (epoch !== currentEpoch) throw new Error("QA fresh epoch revoked");
      };
      expect(await uploadCloudMedia(client, owner, state, freshGuard, before)).toEqual(before);
      expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner }))
        .toBeDefined();
      const retainedRemote = originals.get(path);
      expect(retainedRemote).toBeDefined();
      expect(retainedRemote?.type).toBe(blob.type);
      expect(new Uint8Array(await retainedRemote!.arrayBuffer()))
        .toEqual(new Uint8Array(await blob.arrayBuffer()));
      expect(upload).not.toHaveBeenCalled();
    },
  );
});
