import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceDocument } from "../library";
import type { NoctyriumState } from "../types";
import { sha256Hex } from "../checksum";
import { SyncPushError } from "./syncFailure";
import { readSourceOriginal, saveSourceOriginal } from "../decode/sources";
import { readOriginalFile } from "../sourceOriginal";
import { contentMetadata } from "./deferredContent";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent } from "../questionAttachmentScope";
import { RESUMABLE_CHUNK_BYTES, uploadResumableObject, type ResumableStorageConfig } from "./resumableObject";

export const ORIGINALS_BUCKET = "workspace-originals";
export type ResumableOriginalUpload = ResumableStorageConfig;
const ORIGINAL_UPLOAD_CONCURRENCY = 3;
const verifiedOriginalUploads = new Map<string, Set<string>>();
export function clearCloudOriginalUploadCache(): void { verifiedOriginalUploads.clear(); }
const originalIdentityKey = (identity: NonNullable<ReturnType<typeof readOriginalFile>>) => `${identity.sha256}:${identity.byteSize}:${identity.mimeType}`;

/** Source identity is part of the normal document metadata. Files live once per
 * account/hash, outside checkpoints, and are acknowledged before the revision. */
export async function uploadCloudOriginals(client: SupabaseClient, userId: string, state: NoctyriumState, previous: string | undefined, assertCurrent: () => Promise<void>, resumable?: ResumableOriginalUpload, signal?: AbortSignal) {
  const scope = getQuestionAttachmentScope();
  const prior = previous?.startsWith("{") ? JSON.parse(previous) as Pick<NoctyriumState, "documents"> : undefined;
  const known = new Map((prior?.documents ?? []).flatMap(document => {
    const file = readOriginalFile(document);
    return file ? [[file.sha256, file] as const] : [];
  }));
  const bucket = client.storage.from(ORIGINALS_BUCKET);
  const verified = verifiedOriginalUploads.get(userId) ?? new Set<string>();
  verifiedOriginalUploads.set(userId, verified);
  const ensureCurrent = async () => {
    if (scope.accountId !== userId || !isQuestionAttachmentScopeCurrent(scope)) throw new Error("The account changed while protecting original files. Retry from the current account.");
    if (signal?.aborted) throw new DOMException("The original upload was cancelled. The local file is unchanged.", "AbortError");
    await assertCurrent();
    if (signal?.aborted) throw new DOMException("The original upload was cancelled. The local file is unchanged.", "AbortError");
  };
  const pending = new Map<string, { document: SourceDocument; identity: NonNullable<ReturnType<typeof readOriginalFile>> }>();
  for (const document of contentMetadata(state).documents) {
    const identity = readOriginalFile(document);
    if (!identity) continue; // Legacy text-only records make no original-file claim.
    const previousFile = known.get(identity.sha256);
    if (previousFile?.byteSize === identity.byteSize && previousFile.mimeType === identity.mimeType) continue;
    const key = originalIdentityKey(identity);
    if (verified.has(key)) continue;
    if (!pending.has(key)) pending.set(key, { document, identity });
  }
  const entries = [...pending.values()];
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  async function worker(): Promise<void> {
    while (cursor < entries.length && !failed) {
      const { document, identity } = entries[cursor++];
      try {
        await uploadOne(document, identity);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  async function uploadOne(document: SourceDocument, identity: NonNullable<ReturnType<typeof readOriginalFile>>): Promise<void> {
    await ensureCurrent();
    const original = await readSourceOriginal(document.id, identity.sha256, { scope, accountId: userId });
    if (!original || original.size !== identity.byteSize) throw new SyncPushError(
      { kind: "rejected", rejection: "missing-original", status: 0 },
      "An original source file is missing on this device. Attach the exact file or restore a complete backup before protecting this version.",
    );
    const blob = original.slice(0, original.size, identity.mimeType);
    const path = `${userId}/${identity.sha256}`;
    let uploadFailure: unknown;
    try {
      if (blob.size > RESUMABLE_CHUNK_BYTES) {
        if (!resumable) throw new Error("Resumable original-file storage is unavailable. Keep the local file and retry after signing in.");
        await uploadResumableObject(blob, ORIGINALS_BUCKET, path, identity.sha256, resumable, ensureCurrent, signal);
      } else {
        const { error } = await bucket.upload(path, blob, { contentType: identity.mimeType, upsert: false, cacheControl: "31536000" });
        if (error) throw error;
      }
    } catch (error) {
      uploadFailure = error;
    }
    // A successful SDK/tus callback is not proof of persisted bytes. Read back
    // the complete immutable object, and also recover from lost acknowledgements
    // or 409 duplicate responses only when its SHA-256 matches.
    await ensureCurrent();
    const existing = await bucket.download(path);
    if (existing.error || !existing.data || existing.data.size !== identity.byteSize
      || await sha256Hex(await existing.data.arrayBuffer()) !== identity.sha256) {
      // Surface recoverable transport faults as-is, but never expose a bare
      // 409 collision as a successful upload or a meaningless SDK object.
      if (uploadFailure && (!((typeof uploadFailure === "object" && uploadFailure !== null && "statusCode" in uploadFailure))
        || String(uploadFailure.statusCode) !== "409")) throw uploadFailure;
      throw new Error("The original-file upload could not be verified on the server. Your local copy is safe; reconnect and retry.");
    }
    await ensureCurrent();
    verified.add(originalIdentityKey(identity));
  }
  await Promise.all(Array.from({ length: Math.min(ORIGINAL_UPLOAD_CONCURRENCY, entries.length) }, worker));
  if (failed) throw failure;
  await ensureCurrent();
}

/** Repair a vanished previously acknowledged original without downloading all
 * originals on every ordinary workspace save. Invoked ONLY after the backend
 * rejects a revision for missing originals. Storage owns authoritative bytes.
 * A size-matched object is left untouched; a wrong-size immutable object is
 * an integrity failure, not permission to overwrite it. */
export async function repairMissingCloudOriginals(
  client: SupabaseClient, userId: string, state: NoctyriumState,
  assertCurrent: () => Promise<void>, resumable?: ResumableOriginalUpload,
): Promise<number> {
  const scope = getQuestionAttachmentScope();
  const grouped = new Map<string, SourceDocument[]>();
  for (const document of contentMetadata(state).documents) {
    const identity = readOriginalFile(document);
    if (!identity) continue;
    const documents = grouped.get(identity.sha256) ?? [];
    documents.push(document);
    grouped.set(identity.sha256, documents);
  }
  const bucket = client.storage.from(ORIGINALS_BUCKET);
  let repaired = 0;
  for (const [hash, documents] of grouped) {
    const identity = readOriginalFile(documents[0])!;
    const path = `${userId}/${hash}`;
    await assertCurrent();
    const info = await bucket.info(path);
    await assertCurrent();
    if (!info.error && info.data?.size === identity.byteSize) continue;
    if (!info.error) {
      throw new Error("An immutable original source has inconsistent server metadata. Do not overwrite it; preserve the local file and investigate.");
    }
    // Do not confuse an authentication/network outage with an absent object.
    const status = String(info.error.statusCode ?? info.error.status ?? "");
    if (status !== "404") throw info.error;
    // Reconcile mirrors safely: one document ID may no longer have a local
    // blob, while another identical source still has the verified bytes.
    let local: SourceDocument | undefined;
    for (const document of documents) {
      await assertCurrent();
      const copy = await readSourceOriginal(document.id, hash, { scope, accountId: userId });
      if (copy && copy.size === identity.byteSize) { local = document; break; }
    }
    if (!local) {
      throw new SyncPushError(
        { kind: "rejected", rejection: "missing-original", status: 0 },
        "A previously protected original is missing from cloud Storage and this device. Restore the exact source from a verified backup before retrying cloud protection.",
      );
    }
    verifiedOriginalUploads.get(userId)?.delete(originalIdentityKey(identity));
    await uploadCloudOriginals(client, userId, { ...state, documents: [local] }, undefined, assertCurrent, resumable);
    repaired += 1;
  }
  return repaired;
}

export async function downloadCloudOriginal(client: SupabaseClient, userId: string, document: SourceDocument, assertCurrent: () => Promise<void>): Promise<void> {
  const scope = getQuestionAttachmentScope();
  const identity = readOriginalFile(document);
  if (!identity || await readSourceOriginal(document.id, identity.sha256, { scope, accountId: userId })) return;
  await assertCurrent();
  const { data, error } = await client.storage.from(ORIGINALS_BUCKET).download(`${userId}/${identity.sha256}`);
  if (error || !data) throw new Error("This original file is not available offline yet. Reconnect to its original account and retry.");
  if (data.size !== identity.byteSize || await sha256Hex(await data.arrayBuffer()) !== identity.sha256) throw new Error("The original file failed its integrity check. Your saved work is unchanged.");
  await assertCurrent();
  await saveSourceOriginal(document, data, { scope, accountId: userId });
}
