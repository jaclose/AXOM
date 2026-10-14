import { storedAcademicBindings, validAcademicAsset, downloadAcademicAsset, type AcademicAssetReference } from "../academicLibrary/contentReferences";
import { contentMetadata } from "./deferredContent";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../compressedText";
import { privateReviewMedia } from "../privateLibrary/media";
import { getQuestionAttachmentBlob, MAX_QUESTION_ATTACHMENT_BYTES, QUESTION_ATTACHMENT_TYPES, type QuestionImageAttachment } from "../questionAttachments";
import type { NoctyriumState } from "../types";

export const MEDIA_BUCKET = "workspace-media";
export const MAX_CLOUD_MEDIA_FILES = 20_000;
export const MAX_CLOUD_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
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
    for (const attachment of question.attachments ?? []) refs.set(attachment.blobKey, { questionId: question.id, attachment, checksum: content?.assets.find(asset => asset.id === attachment.assetId)?.checksum?.replace(/^sha256:/, "") });
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
    const ref = expected.get(entry.blobKey)?.attachment;
    return !ref || ref.byteSize !== entry.byteSize || ref.updatedAt !== entry.updatedAt;
  })) throw new Error("This protected version has an incomplete image index. Your current workspace is unchanged.");
  return manifest;
}

/** Images remain lossless originals. Identical bytes share one immutable object
 * within an account; filenames and local paths never become public URLs. */
export async function uploadCloudMedia(client: SupabaseClient, userId: string, state: NoctyriumState, assertCurrent: () => Promise<void>, previous: CloudMediaReference[] = []): Promise<CloudMediaReference[]> {
  const bucket = client.storage.from(MEDIA_BUCKET);
  const shared = storedAcademicBindings(state).assets;
  const refs = workspaceMedia(state);
  if (refs.size > MAX_CLOUD_MEDIA_FILES) throw new Error("This image library has too many files for one protected version.");
  const prior = new Map(previous.map((entry) => [entry.blobKey, entry]));
  // Deferred review documents can contain image references. Keep their acknowledged
  // index until the source is downloaded; cache removal cannot delete account media.
  const manifest: CloudMediaReference[] = [...(state.deferredContent?.media ?? []).filter(entry => !refs.has(entry.blobKey))];
  const uploaded = new Set<string>();
  for (const [blobKey, { attachment }] of refs) {
    await assertCurrent();
    const known = prior.get(blobKey);
    if (known && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt) {
      const academic = shared.find(asset => asset.sha256 === known.hash);
      manifest.push(academic ? { ...known, academic } : known);
      continue;
    }
    const record = await getQuestionAttachmentBlob(blobKey);
    if (!record || record.blob.size !== attachment.byteSize) throw new Error("Some question images are missing on this device. Restore a complete backup before protecting this version.");
    if (record.blob.size > MAX_QUESTION_ATTACHMENT_BYTES || !QUESTION_ATTACHMENT_TYPES.includes(attachment.mimeType)) throw new Error("A question image is not supported for account storage.");
    const hash = await sha256(new Uint8Array(await record.blob.arrayBuffer()));
    const academic = shared.find(asset => asset.sha256 === hash);
    const path = `${userId}/${hash}`;
    if (!academic && !uploaded.has(hash)) {
      const { error } = await bucket.upload(path, record.blob, { contentType: attachment.mimeType, upsert: false, cacheControl: "31536000" });
      if (error) {
        if (!('statusCode' in error) || String(error.statusCode) !== "409") throw error;
        // A duplicate name alone is insufficient: verify the bytes before
        // allowing a revision to call that object protected.
        const existing = await bucket.download(path);
        if (existing.error || !existing.data || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== hash) throw new Error("An account image could not be verified. The workspace has not been marked protected.");
      }
      uploaded.add(hash);
    }
    manifest.push({ ...(academic ? { academic } : {}), blobKey, hash, byteSize: record.blob.size, updatedAt: attachment.updatedAt });
  }
  await assertCurrent();
  return readMediaManifest(manifest);
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
