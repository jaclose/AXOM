import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../compressedText";
import { privateReviewMedia } from "../privateLibrary/media";
import { getQuestionAttachmentBlob, MAX_QUESTION_ATTACHMENT_BYTES, QUESTION_ATTACHMENT_TYPES, type QuestionImageAttachment } from "../questionAttachments";
import type { NoctyriumState } from "../types";

export const MEDIA_BUCKET = "workspace-media";
export const MAX_CLOUD_MEDIA_FILES = 20_000;
export const MAX_CLOUD_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
export interface CloudMediaReference {
  blobKey: string;
  hash: string;
  byteSize: number;
  updatedAt: string;
}

type Reference = { questionId: string; attachment: QuestionImageAttachment };
export function workspaceMedia(state: NoctyriumState): Map<string, Reference> {
  const refs = new Map<string, Reference>();
  for (const question of [...state.questions, ...privateReviewMedia(state.documents)]) {
    for (const attachment of question.attachments ?? []) refs.set(attachment.blobKey, { questionId: question.id, attachment });
  }
  return refs;
}

export function readMediaManifest(value: unknown): CloudMediaReference[] {
  if (!Array.isArray(value) || value.length > MAX_CLOUD_MEDIA_FILES) throw new Error("The account image list is invalid.");
  const keys = new Set<string>();
  const objects = new Map<string, number>();
  let total = 0;
  return value.map((row: CloudMediaReference) => {
    if (!row || typeof row.blobKey !== "string" || !row.blobKey || keys.has(row.blobKey) || !/^[a-f0-9]{64}$/.test(row.hash)
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
  const refs = workspaceMedia(state);
  if (refs.size > MAX_CLOUD_MEDIA_FILES) throw new Error("This image library has too many files for one protected version.");
  const prior = new Map(previous.map((entry) => [entry.blobKey, entry]));
  const manifest: CloudMediaReference[] = [];
  const uploaded = new Set<string>();
  for (const [blobKey, { attachment }] of refs) {
    await assertCurrent();
    const known = prior.get(blobKey);
    if (known && known.byteSize === attachment.byteSize && known.updatedAt === attachment.updatedAt) {
      manifest.push(known);
      continue;
    }
    const record = await getQuestionAttachmentBlob(blobKey);
    if (!record || record.blob.size !== attachment.byteSize) throw new Error("Some question images are missing on this device. Restore a complete backup before protecting this version.");
    if (record.blob.size > MAX_QUESTION_ATTACHMENT_BYTES || !QUESTION_ATTACHMENT_TYPES.includes(attachment.mimeType)) throw new Error("A question image is not supported for account storage.");
    const hash = await sha256(new Uint8Array(await record.blob.arrayBuffer()));
    const path = `${userId}/${hash}`;
    if (!uploaded.has(hash)) {
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
    manifest.push({ blobKey, hash, byteSize: record.blob.size, updatedAt: attachment.updatedAt });
  }
  await assertCurrent();
  return readMediaManifest(manifest);
}

