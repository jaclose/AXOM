import { storedAcademicBindings, validAcademicAsset, downloadAcademicAsset, type AcademicAssetReference } from "../academicLibrary/contentReferences";
import { contentMetadata } from "./deferredContent";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../compressedText";
import { privateReviewMedia } from "../privateLibrary/media";
import { getQuestionAttachmentBlob, MAX_QUESTION_ATTACHMENT_BYTES, QUESTION_ATTACHMENT_TYPES, type QuestionImageAttachment } from "../questionAttachments";
import type { NoctyriumState } from "../types";
import { SyncPushError } from "./syncFailure";

export const MEDIA_BUCKET = "workspace-media";
export const MAX_CLOUD_MEDIA_FILES = 20_000;
export const MAX_CLOUD_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const MEDIA_UPLOAD_CONCURRENCY = 6;
const confirmedMediaUploads = new Map<string, Set<string>>();
export function clearCloudMediaUploadCache(): void { confirmedMediaUploads.clear(); }
export interface CloudMediaReference {
  academic?: AcademicAssetReference;
  blobKey: string;
  hash: string;
  byteSize: number;
  updatedAt: string;
}

type Reference = { questionId: string; attachment: QuestionImageAttachment; checksum?: string };
export function workspaceMedia(state: NoctyriumState): Map<string, Reference> {
  state = contentMetadata(state);
  const refs = new Map<string, Reference>();
  for (const question of [...state.questions, ...privateReviewMedia(state.documents)]) {
    const content = "content" in question ? question.content : undefined;
    for (const attachment of question.attachments ?? []) {
      // A source checksum attests image bytes, not academic ownership. It may
      // not authorize a revocable course binding for a new local attachment.
      const declared = content?.assets.find(asset => asset.id === attachment.assetId)?.checksum;
      const sourceChecksum = declared?.replace(/^sha256:/, "");
      if (sourceChecksum !== undefined && !/^[a-f0-9]{64}$/.test(sourceChecksum)) {
        throw new Error("A source image has an invalid declared checksum. The workspace has not been marked protected.");
      }
      // A private-library SHA key is an immutable byte identity, not a mutable
      // question attachment ID. A source declaration must agree with that key.
      const originalHash = /^private-library:sha256:([a-f0-9]{64})$/.exec(attachment.blobKey)?.[1];
      if (originalHash && sourceChecksum && originalHash !== sourceChecksum) {
        throw new Error("Questions reference conflicting image originals. The workspace has not been marked protected.");
      }
      const checksum = sourceChecksum ?? originalHash;
      const prior = refs.get(attachment.blobKey);
      if (prior) {
        // Content-identical originals may be referenced by reviews saved at
        // different times. Mutable keys retain strict timestamp comparisons.
        const priorTime = Date.parse(prior.attachment.updatedAt);
        const currentTime = Date.parse(attachment.updatedAt);
        if (prior.attachment.byteSize !== attachment.byteSize
          || (!originalHash && prior.attachment.updatedAt !== attachment.updatedAt)
          || prior.attachment.mimeType !== attachment.mimeType
          || (prior.checksum && checksum && prior.checksum !== checksum)
          || (originalHash && (!Number.isFinite(priorTime) || !Number.isFinite(currentTime)))) {
          throw new Error("Questions reference conflicting image originals. The workspace has not been marked protected.");
        }
        // Choose the oldest receipt deterministically, independent of source
        // iteration order, without changing either underlying original.
        const owner = originalHash && priorTime <= currentTime
          ? prior : { questionId: question.id, attachment, checksum };
        refs.set(attachment.blobKey, { questionId: owner.questionId, attachment: owner.attachment,
          checksum: checksum ?? prior.checksum });
      } else {
        refs.set(attachment.blobKey, { questionId: question.id, attachment, checksum });
      }
    }
  }
  return refs;
}

export function readMediaManifest(value: unknown): CloudMediaReference[] {
  if (!Array.isArray(value) || value.length > MAX_CLOUD_MEDIA_FILES) throw new Error("The account image list is invalid.");
  const keys = new Set<string>();
  const objects = new Map<string, number>();
  let total = 0;
  return value.map((row: CloudMediaReference) => {
    if (!row || (row.academic !== undefined && (!validAcademicAsset(row.academic) || row.academic.sha256 !== row.hash)) || typeof row.blobKey !== "string" || !row.blobKey || keys.has(row.blobKey) || !/^[a-f0-9]{64}$/.test(row.hash)
      || !Number.isSafeInteger(row.byteSize) || row.byteSize <= 0 || row.byteSize > MAX_QUESTION_ATTACHMENT_BYTES
      || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error("The account image list is invalid.");
    keys.add(row.blobKey);
    if (objects.has(row.hash) && objects.get(row.hash) !== row.byteSize) throw new Error("The account image list is inconsistent.");
    if (!objects.has(row.hash)) total += row.byteSize;
    objects.set(row.hash, row.byteSize);
    if (total > MAX_CLOUD_MEDIA_BYTES) throw new Error("The account image library exceeds the restore limit.");
    return row;
  });
}

/** A protected workspace cannot claim completeness while omitting a figure. */
export function validateWorkspaceMedia(state: NoctyriumState, value: unknown): CloudMediaReference[] {
  const manifest = readMediaManifest(value);
  const expected = workspaceMedia(state);
  if (manifest.length !== expected.size || manifest.some((entry) => {
    const source = expected.get(entry.blobKey);
    return !source || source.attachment.byteSize !== entry.byteSize
      || source.attachment.updatedAt !== entry.updatedAt
      || (source.checksum !== undefined && source.checksum !== entry.hash);
  })) throw new Error("This protected version has an incomplete image index. Your current workspace is unchanged.");
  return manifest;
}

export interface MissingWorkspaceMedia {
  questionId: string;
  questionLabel: string;
  fileName: string;
}

/** A local availability check, not a cloud receipt. Keep recoverable exact
 * receipts eligible for remote validation in the normal media upload stage. */
export async function findMissingWorkspaceMedia(
  userId: string,
  state: NoctyriumState,
  assertCurrent: () => Promise<void>,
  previous: CloudMediaReference[] = [],
): Promise<MissingWorkspaceMedia[]> {
  await assertCurrent();
  if (state.deferredContent && state.deferredContent.accountId !== userId) {
    throw new Error("Deferred account images belong to another account. Cloud protection remains pending.");
  }
  const refs = [...workspaceMedia(state)];
  const prior = new Map(previous.map(entry => [entry.blobKey, entry]));
  const academicBindings = new Set(storedAcademicBindings(state).assets.map(asset =>
    JSON.stringify([asset.revisionId, asset.path, asset.sha256])));
  const questions = new Map(contentMetadata(state).questions.map(question => [question.id, question]));
  const missing = new Array<MissingWorkspaceMedia | undefined>(refs.length);
  let cursor = 0;
  async function inspect(): Promise<void> {
    while (cursor < refs.length) {
      const index = cursor++;
      const [blobKey, { questionId, attachment, checksum }] = refs[index];
      await assertCurrent();
      const record = await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: userId });
      await assertCurrent();
      if (record?.blob.size === attachment.byteSize) continue;
      const known = prior.get(blobKey);
      if (!record && known && known.byteSize === attachment.byteSize
        && known.updatedAt === attachment.updatedAt && (checksum === undefined || checksum === known.hash)
        && (!known.academic || (known.academic.sha256 === known.hash && academicBindings.has(
          JSON.stringify([known.academic.revisionId, known.academic.path, known.academic.sha256]))))) continue;
      const stem = questions.get(questionId)?.stem;
      missing[index] = {
        questionId,
        questionLabel: typeof stem === "string" && stem.trim() ? stem.replace(/\s+/g, " ").trim().slice(0, 140) : `Question ${questionId}`,
        fileName: attachment.fileName.split(/[\\/]/).pop() || "Question image",
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(MEDIA_UPLOAD_CONCURRENCY, refs.length) }, inspect));
  await assertCurrent();
  return missing.filter((item): item is MissingWorkspaceMedia => item !== undefined);
}

/** Images remain lossless originals. Identical bytes share one immutable object
 * within an account; filenames and local paths never become public URLs. */
export async function uploadCloudMedia(client: SupabaseClient, userId: string, state: NoctyriumState, assertCurrent: () => Promise<void>, previous: CloudMediaReference[] = []): Promise<CloudMediaReference[]> {
  const bucket = client.storage.from(MEDIA_BUCKET);
  const shared = storedAcademicBindings(state).assets;
  // Installed academic assets can validate an EXACT prior revision/path
  // receipt, but a matching SHA-256 (even from an imported source package) is
  // not evidence that a new attachment belongs to that course. First protection
  // without a prior academic receipt must preserve account-private recovery.
  // Avoid an O(media × academic files) scan during large-library recovery.
  const academicBindingKeys = new Set(shared.map(asset =>
    JSON.stringify([asset.revisionId, asset.path, asset.sha256])));
  const hasAcademicBinding = (reference: AcademicAssetReference): boolean =>
    academicBindingKeys.has(JSON.stringify([reference.revisionId, reference.path, reference.sha256]));
  const refs = workspaceMedia(state);
  // Deferred content is a same-account recovery receipt, not a transferable
  // authorization for another learner's stored originals.
  if (state.deferredContent && state.deferredContent.accountId !== userId) {
    throw new Error("Deferred account images belong to another account. Cloud protection remains pending.");
  }
  // Deferred images not currently enumerated by question attachments must still
  // exist byte-for-byte on this account. They cannot bypass the normal media cap.
  const deferred = readMediaManifest((state.deferredContent?.media ?? []).filter(entry => !refs.has(entry.blobKey)));
  if (refs.size + deferred.length > MAX_CLOUD_MEDIA_FILES) throw new SyncPushError(
    { kind: "rejected", rejection: "too-many-images", status: 0 },
    "This image library has too many files for one protected version.",
  );
  const prior = new Map(previous.map((entry) => [entry.blobKey, entry]));
  const entries = [...refs];
  const totalJobs = deferred.length + entries.length;
  const ordered = new Array<CloudMediaReference>(entries.length);
  const confirmed = confirmedMediaUploads.get(userId) ?? new Set<string>();
  confirmedMediaUploads.set(userId, confirmed);
  const inFlight = new Map<string, Promise<void>>();
  // Each protection attempt must establish fresh remote-byte authority. Never
  // use the module-wide confirmed set as evidence for a later revision.
  const verifiedRemoteOriginals = new Map<string, Promise<void>>();
  // A deferred receipt can see 404 while a different local reference restores
  // the same immutable private object. Only an upload verified in this attempt
  // may authorize a fresh deferred readback; historical cache hits cannot.
  const restoredPrivateOriginals = new Set<string>();
  const pendingMissingPrivateOriginals: Array<{ reference: CloudMediaReference; error: Error; onVerified?: () => void }> = [];
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  class MissingPrivateOriginalError extends Error {}
  async function ensureUploaded(hash: string, blob: Blob, mimeType: string, forceUpload = false): Promise<void> {
    // Check the in-flight pool before the historical cache: a concurrent 404
    // repair must never be mistaken for an already verified upload.
    let work = inFlight.get(hash);
    if (work) { await work; return; }
    if (!forceUpload && confirmed.has(hash)) {
      await verifyOrRepairPrivateOriginal({ hash, byteSize: blob.size }, blob, mimeType);
      return;
    }
    if (!work) {
      work = (async () => {
        await assertCurrent();
        // A prior 404 memoizes a failed verification promise for this attempt.
        // Discard it only when retrying a missing PRIVATE immutable original.
        if (forceUpload) verifiedRemoteOriginals.delete(`private:${hash}:${blob.size}`);
        const { error } = await bucket.upload(`${userId}/${hash}`, blob, { contentType: mimeType, upsert: false, cacheControl: "31536000" });
        if (error && (!("statusCode" in error) || String(error.statusCode) !== "409")) throw error;
        // An upload acknowledgment or a 409 conflict is not a recovery receipt:
        // the current account must be able to read back identical original bytes.
        // Keep this check within the six-worker pool and shared per-hash attempt.
        await assertCurrent();
        // A concurrent retained-reference read may have memoized a missing
        // original before this immutable upload created it. A 2xx or 409
        // acknowledgment must not reuse that earlier verification (success or
        // failure): prove the post-upload object from current-account bytes.
        verifiedRemoteOriginals.delete(`private:${hash}:${blob.size}`);
        await verifyRemoteOriginal({ hash, byteSize: blob.size });
        await assertCurrent();
        // Record success only after verifying storage bytes and current identity.
        confirmed.add(hash);
        restoredPrivateOriginals.add(`${hash}:${blob.size}`);
      })().finally(() => inFlight.delete(hash));
      inFlight.set(hash, work);
    }
    await work;
  }
  // Every reused original needs a current account-scoped byte proof, whether
  // its local cache exists or not. Deduplicate by asset class/hash/size only
  // for this protection attempt. Prior manifests and module caches are receipts,
  // never current remote-integrity authority.
  async function verifyRemoteOriginal(known: Pick<CloudMediaReference, "hash" | "byteSize">, academic?: AcademicAssetReference): Promise<void> {
    // Only private originals may share a hash-only proof. Every academic
    // revision/path must independently satisfy its current RLS authorization.
    const key = academic
      ? JSON.stringify(["academic", academic.revisionId, academic.path, known.hash, known.byteSize])
      : `private:${known.hash}:${known.byteSize}`;
    let verification = verifiedRemoteOriginals.get(key);
    if (!verification) {
      verification = (async () => {
        await assertCurrent();
        let original: Blob | null;
        if (academic) {
          original = await downloadAcademicAsset(client, academic);
        } else {
          const result = await bucket.download(`${userId}/${known.hash}`);
          if (result.error) {
            // A definite 404 can be safely repaired from the intact local Blob.
            // 403/RLS, transient network errors and integrity failures MUST
            // remain fail-closed; do not turn them into a write attempt.
            if ("statusCode" in result.error && String(result.error.statusCode) === "404") {
              throw new MissingPrivateOriginalError("This account original is missing from cloud storage.");
            }
            throw new Error("An acknowledged account image could not be verified. Reconnect or restore the original before cloud protection.");
          }
          original = result.data;
        }
        await assertCurrent();
        if (!original || original.size !== known.byteSize) {
          throw new Error("An acknowledged account image is missing or has changed. Cloud protection remains pending.");
        }
        const bytes = new Uint8Array(await original.arrayBuffer());
        await assertCurrent();
        if (await sha256(bytes) !== known.hash) {
          throw new Error("An acknowledged account image failed its integrity check. Cloud protection remains pending.");
        }
        await assertCurrent();
      })();
      verifiedRemoteOriginals.set(key, verification);
    }
    await verification;
    await assertCurrent();
  }
  async function verifyOrRepairPrivateOriginal(
    known: Pick<CloudMediaReference, "hash" | "byteSize">,
    blob: Blob,
    mimeType: string,
  ): Promise<void> {
    try {
      await verifyRemoteOriginal(known);
    } catch (error) {
      if (!(error instanceof MissingPrivateOriginalError)) throw error;
      // A local byte hash was independently computed before arriving here.
      // Retry only a 404 at this same account's immutable path, never overwrite.
      await assertCurrent();
      confirmed.delete(known.hash);
      await ensureUploaded(known.hash, blob, mimeType, true);
    }
  }
  async function worker(): Promise<void> {
    while (cursor < totalJobs && !failed) {
      const job = cursor++;
      try {
        await assertCurrent();
        if (job < deferred.length) {
          // A deferred receipt has no local attachment to inspect. Verify the
          // exact remote bytes before certifying this protected workspace. Use
          // the same bounded worker pool and per-attempt dedup as active media.
          const reference = deferred[job];
          try {
            await verifyRemoteOriginal(reference, reference.academic);
          } catch (error) {
            // Preserve a definite missing-private result until all bounded
            // workers finish. The only eligible recovery is a same-attempt,
            // already integrity-verified upload to this account. Academic
            // failures, RLS denials and all other errors still fail immediately.
            if (reference.academic || !(error instanceof MissingPrivateOriginalError)) throw error;
            pendingMissingPrivateOriginals.push({ reference, error });
          }
          continue;
        }
        const index = job - deferred.length;
        const [blobKey, { attachment, checksum }] = entries[index];
        // A matching size/timestamp is not proof of unchanged bytes. Check
        // the device original even when reusing a previously protected index.
        const known = prior.get(blobKey);
        // Recovery must retain the *same* prior academic binding. Never
        // substitute the first accessible same-hash revision for another.
        const knownAcademic = known?.academic && known.academic.sha256 === known.hash
          && hasAcademicBinding(known.academic) ? known.academic : undefined;
        const record = await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: userId });
        if (!record && known
          && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt
          && (checksum === undefined || checksum === known.hash)
          && (!known.academic || knownAcademic)) {
          // contentMetadata includes metadata for deferred questions. They
          // can reach this no-local-Blob path rather than the deferred queue.
          // Verify a retained receipt now, or wait for a parallel verified
          // same-account immutable private upload before retrying its 404.
          const restored = { ...(knownAcademic ? { academic: knownAcademic } : {}), blobKey,
            hash: known.hash, byteSize: known.byteSize, updatedAt: attachment.updatedAt };
          try {
            await verifyRemoteOriginal(known, knownAcademic);
          } catch (error) {
            if (knownAcademic || !(error instanceof MissingPrivateOriginalError)) throw error;
            pendingMissingPrivateOriginals.push({
              reference: known, error,
              onVerified: () => { ordered[index] = restored; },
            });
            continue;
          }
          ordered[index] = restored;
          continue;
        }
        if (!record || record.blob.size !== attachment.byteSize) throw new SyncPushError(
          { kind: "rejected", rejection: "missing-image", status: 0 },
          "Some question images are missing on this device. Restore a complete backup before protecting this version.",
        );
        if (record.blob.size > MAX_QUESTION_ATTACHMENT_BYTES || !QUESTION_ATTACHMENT_TYPES.includes(attachment.mimeType)) throw new SyncPushError(
          { kind: "rejected", rejection: "unsupported-image", status: 0 },
          "A question image is not supported for account storage.",
        );
        const hash = await sha256(new Uint8Array(await record.blob.arrayBuffer()));
        if (checksum !== undefined && checksum !== hash) {
          throw new Error("A source image no longer matches its declared checksum. Restore the original before protecting this version.");
        }
        if (known?.academic && known.hash === hash && !knownAcademic) {
          throw new Error("The original academic image binding is no longer available. Cloud protection remains pending.");
        }
        // Only an exact previously protected academic revision/path receipt
        // may select academic recovery. Source-image checksum equality alone
        // cannot rebind first-save personal figures to unrelated course RLS.
        const academic = known && known.hash === hash ? knownAcademic : undefined;
        // A former academic-only reference is not proof that a private
        // workspace-media object exists after its academic binding disappears.
        const safeReuse = known && known.hash === hash
          && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt
          && (!known.academic || academic);
        if (academic || safeReuse) {
          // A retained local Blob only proves its own bytes. The remote
          // original might have changed since the previous cloud receipt.
          if (academic) await verifyRemoteOriginal({ hash, byteSize: record.blob.size }, academic);
          else await verifyOrRepairPrivateOriginal({ hash, byteSize: record.blob.size }, record.blob, attachment.mimeType);
        } else {
          await ensureUploaded(hash, record.blob, attachment.mimeType);
        }
        ordered[index] = { ...(academic ? { academic } : {}), blobKey, hash, byteSize: record.blob.size, updatedAt: attachment.updatedAt };
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MEDIA_UPLOAD_CONCURRENCY, totalJobs) }, worker));
  if (failed) throw failure;
  // The 404 may be older than a parallel successful immutable upload. Never
  // retry a missing deferred original unless this protection attempt proved
  // the matching private bytes with a fresh account-scoped SHA-256 readback.
  // Clear rejected memo once per object; duplicate receipts reuse that proof.
  const retriedDeferredPrivateOriginals = new Set<string>();
  for (const { reference, error, onVerified } of pendingMissingPrivateOriginals) {
    const key = `${reference.hash}:${reference.byteSize}`;
    if (!restoredPrivateOriginals.has(key)) throw error;
    if (!retriedDeferredPrivateOriginals.has(key)) {
      verifiedRemoteOriginals.delete(`private:${key}`);
      retriedDeferredPrivateOriginals.add(key);
    }
    await verifyRemoteOriginal(reference);
    onVerified?.();
  }
  await assertCurrent();
  return readMediaManifest([...deferred, ...ordered]);
}


export async function downloadCloudMediaAsset(client: SupabaseClient, userId: string, reference: CloudMediaReference): Promise<Blob> {
  let data: Blob | null;
  if (reference.academic) data = await downloadAcademicAsset(client, reference.academic);
  else {
    const result = await client.storage.from(MEDIA_BUCKET).download(`${userId}/${reference.hash}`);
    if (result.error) throw new Error("This image is not available offline yet. Reconnect and retry.");
    data = result.data;
  }
  if (!data || data.size !== reference.byteSize || await sha256(new Uint8Array(await data.arrayBuffer())) !== reference.hash) throw new Error("The downloaded image failed its integrity check.");
  return data;
}
