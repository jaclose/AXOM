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
      const declared = content?.assets.find(asset => asset.id === attachment.assetId)?.checksum;
      const checksum = declared?.replace(/^sha256:/, "");
      if (checksum !== undefined && !/^[a-f0-9]{64}$/.test(checksum)) {
        throw new Error("A source image has an invalid declared checksum. The workspace has not been marked protected.");
      }
      const prior = refs.get(attachment.blobKey);
      if (prior) {
        // Several questions may share one original, but every reference must
        // agree on its identity. Do not let Map.set discard conflicting evidence.
        if (prior.attachment.byteSize !== attachment.byteSize
          || prior.attachment.updatedAt !== attachment.updatedAt
          || prior.attachment.mimeType !== attachment.mimeType
          || (prior.checksum && checksum && prior.checksum !== checksum)) {
          throw new Error("Questions reference conflicting image originals. The workspace has not been marked protected.");
        }
        // Keep the last referencing question for cloud-cache reconstruction,
        // while retaining a source checksum declared by any earlier reference.
        refs.set(attachment.blobKey, { questionId: question.id, attachment, checksum: checksum ?? prior.checksum });
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

/** Images remain lossless originals. Identical bytes share one immutable object
 * within an account; filenames and local paths never become public URLs. */
export async function uploadCloudMedia(client: SupabaseClient, userId: string, state: NoctyriumState, assertCurrent: () => Promise<void>, previous: CloudMediaReference[] = []): Promise<CloudMediaReference[]> {
  const bucket = client.storage.from(MEDIA_BUCKET);
  const shared = storedAcademicBindings(state).assets;
  const academicByHash = new Map<string, AcademicAssetReference>();
  for (const asset of shared) if (!academicByHash.has(asset.sha256)) academicByHash.set(asset.sha256, asset);
  const refs = workspaceMedia(state);
  if (refs.size > MAX_CLOUD_MEDIA_FILES) throw new SyncPushError(
    { kind: "rejected", rejection: "too-many-images", status: 0 },
    "This image library has too many files for one protected version.",
  );
  const prior = new Map(previous.map((entry) => [entry.blobKey, entry]));
  // Deferred review documents can contain image references. Keep their acknowledged
  // index until the source is downloaded; cache removal cannot delete account media.
  const manifest: CloudMediaReference[] = [...(state.deferredContent?.media ?? []).filter(entry => !refs.has(entry.blobKey))];
  const entries = [...refs];
  const ordered = new Array<CloudMediaReference>(entries.length);
  const confirmed = confirmedMediaUploads.get(userId) ?? new Set<string>();
  confirmedMediaUploads.set(userId, confirmed);
  const inFlight = new Map<string, Promise<void>>();
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  async function ensureUploaded(hash: string, blob: Blob, mimeType: string): Promise<void> {
    if (confirmed.has(hash)) return;
    let work = inFlight.get(hash);
    if (!work) {
      work = (async () => {
        await assertCurrent();
        const { error } = await bucket.upload(`${userId}/${hash}`, blob, { contentType: mimeType, upsert: false, cacheControl: "31536000" });
        if (error) {
          if (!('statusCode' in error) || String(error.statusCode) !== "409") throw error;
          // A duplicate name alone cannot establish that the immutable object has these bytes.
          const existing = await bucket.download(`${userId}/${hash}`);
          if (existing.error || !existing.data || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== hash) throw new Error("An account image could not be verified. The workspace has not been marked protected.");
        }
        await assertCurrent();
        confirmed.add(hash);
      })().finally(() => inFlight.delete(hash));
      inFlight.set(hash, work);
    }
    await work;
  }
  // A previous manifest is a receipt, not evidence that its original still
  // exists. Recheck the account-scoped immutable object only on local cache
  // misses; dedupe shared hashes within this protection attempt, not across
  // accounts or revisions. Offline/missing/corrupt objects leave the push pending.
  const verifiedMissingLocalOriginals = new Map<string, Promise<void>>();
  async function verifyMissingLocalOriginal(known: CloudMediaReference, academic?: AcademicAssetReference): Promise<void> {
    const key = `${academic ? "academic" : "private"}:${known.hash}:${known.byteSize}`;
    let verification = verifiedMissingLocalOriginals.get(key);
    if (!verification) {
      verification = (async () => {
        await assertCurrent();
        let original: Blob | null = null;
        if (academic) {
          original = await downloadAcademicAsset(client, academic);
        } else {
          const result = await bucket.download(`${userId}/${known.hash}`);
          if (result.error) throw new Error("An acknowledged account image could not be verified. Reconnect or restore the original before cloud protection.");
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
      verifiedMissingLocalOriginals.set(key, verification);
    }
    await verification;
    await assertCurrent();
  }
  async function worker(): Promise<void> {
    while (cursor < entries.length && !failed) {
      const index = cursor++;
      const [blobKey, { attachment, checksum }] = entries[index];
      try {
        await assertCurrent();
        // A matching size/timestamp is not proof of unchanged bytes. Check
        // the device original even when reusing a previously protected index.
        const known = prior.get(blobKey);
        const knownAcademic = known ? academicByHash.get(known.hash) : undefined;
        const record = await getQuestionAttachmentBlob(blobKey);
        if (!record && known
          && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt
          && (checksum === undefined || checksum === known.hash)
          && (!known.academic || knownAcademic)) {
          // A previous index cannot certify a vanished/corrupted remote object
          // or an index accidentally received from another account. Verify the
          // actual current account original before reusing its receipt.
          await verifyMissingLocalOriginal(known, knownAcademic);
          ordered[index] = { ...(knownAcademic ? { academic: knownAcademic } : {}), blobKey,
            hash: known.hash, byteSize: known.byteSize, updatedAt: attachment.updatedAt };
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
        const academic = academicByHash.get(hash);
        // A former academic-only reference is not proof that a private
        // workspace-media object exists after its academic binding disappears.
        const safeReuse = known && known.hash === hash
          && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt
          && (!known.academic || academic);
        if (!safeReuse && !academic) await ensureUploaded(hash, record.blob, attachment.mimeType);
        ordered[index] = { ...(academic ? { academic } : {}), blobKey, hash, byteSize: record.blob.size, updatedAt: attachment.updatedAt };
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MEDIA_UPLOAD_CONCURRENCY, entries.length) }, worker));
  if (failed) throw failure;
  await assertCurrent();
  return readMediaManifest([...manifest, ...ordered]);
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
