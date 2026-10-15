import { getQuestionAttachmentBlob, type QuestionAttachmentBlobRecord, type QuestionImageAttachment } from "../questionAttachments";
import type { AssetRole, QuestionBlock } from "../question-content/blocks";
import { effectiveRole, isAssetVisible } from "../question-content/visibility";
import type { QuestionAsset } from "../question-content/package";
import type { QuestionRecord } from "../questions";

/** A question's essential image; review-only/source-answer slides are excluded. */
export interface RequiredQuestionMedia {
  questionId: string;
  assetId: string;
  role: AssetRole | "exhibit";
  attachment?: QuestionImageAttachment;
  checksum?: string;
}
export type MediaIssueCode =
  | "missing-metadata" | "missing-bytes" | "size-mismatch" | "type-mismatch"
  | "wrong-question" | "checksum-mismatch" | "invalid-checksum"
  | "crypto-unavailable" | "decode-failed" | "timeout" | "lookup-failed";
export interface MediaIssue { questionId: string; assetId: string; code: MediaIssueCode }
export interface MediaProgress { total: number; checked: number; available: number; blocked: number }
export interface MediaPreflightResult {
  total: number; available: number; hashesVerified: number; decoded: number;
  issues: MediaIssue[]; blockedQuestionIds: string[]; cancelled: boolean;
}
export interface MediaPreflightOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MediaProgress) => void;
  concurrency?: number;
  timeoutMs?: number;
  load?: (blobKey: string) => Promise<QuestionAttachmentBlobRecord | undefined>;
  decode?: (blob: Blob) => Promise<boolean>;
  hash?: (blob: Blob) => Promise<string>;
}

/** Follows QuestionBlocks + QuestionSupportingContent + QuestionExhibits.
 * Do not infer required images from filenames or review-only media counts. */
export function requiredQuestionMedia(question: QuestionRecord): RequiredQuestionMedia[] {
  const attachments = question.attachments ?? [];
  const content = question.content;
  const assets = new Map((content?.assets ?? []).map((asset) => [asset.id, asset]));
  const byAssetId = new Map(attachments.filter((attachment) => attachment.assetId)
    .map((attachment) => [attachment.assetId!, attachment]));
  const needed = new Map<string, RequiredQuestionMedia>();
  const placed = new Set<string>();

  function add(assetId: string, role: AssetRole | "exhibit", asset?: QuestionAsset, attachment?: QuestionImageAttachment) {
    const key = assetId || attachment?.id || "missing-asset";
    if (needed.has(key)) return;
    needed.set(key, {
      questionId: question.id, assetId: key, role,
      attachment: attachment ?? byAssetId.get(assetId), checksum: asset?.checksum,
    });
  }

  function placedImages(blocks: readonly QuestionBlock[], section: AssetRole) {
    for (const block of blocks) {
      if (block.type !== "image") continue;
      placed.add(block.assetId);
      const asset = assets.get(block.assetId);
      const role = effectiveRole(block.role, asset?.role, section);
      if (isAssetVisible(role, "question")) add(block.assetId, role, asset);
    }
  }

  if (content) {
    placedImages(content.stem, "stem");
    for (const choice of content.choices) placedImages(choice.blocks, "choice");
    // An image embedded only in a post-answer explanation is not mandatory
    // clinical evidence for solving the question.
    for (const block of content.explanation ?? []) if (block.type === "image") placed.add(block.assetId);
    for (const asset of content.assets) {
      if (!placed.has(asset.id) && isAssetVisible(asset.role, "question")) add(asset.id, asset.role, asset);
    }
  }

  for (const attachment of attachments) {
    if (!attachment.role) continue;
    const manifestAsset = assets.get(attachment.assetId ?? "");
    // Attachment metadata must never weaken an authoritative restricted source
    // role, even if a converter mislabels an answer slide as "exhibit".
    const role = attachment.role === "exhibit" ? "question" : attachment.role;
    if (!isAssetVisible(effectiveRole(role, manifestAsset?.role, "question"), "question")) continue;
    if (attachment.assetId && needed.has(attachment.assetId)) continue;
    if (attachment.assetId && content && manifestAsset && placed.has(attachment.assetId)) continue;
    add(attachment.assetId ?? attachment.id, attachment.role, manifestAsset, attachment);
  }
  return [...needed.values()];
}

/** Identity changes if any clinically necessary asset/source association
 * changes. Learner notes and review-only media do not invalidate preflight. */
export function requiredMediaIdentity(questions: readonly QuestionRecord[]): string {
  return questions.flatMap(requiredQuestionMedia)
    .map((entry) => [entry.questionId, entry.assetId, entry.attachment?.blobKey,
      entry.attachment?.byteSize, entry.attachment?.mimeType, entry.attachment?.updatedAt,
      entry.checksum ?? ""].join(":")).join("|");
}

/** SubtleCrypto is broadly supported but needs a secure context; hashes apply
 * only when a canonical asset checksum exists. Each stored image is <=8 MiB. */
async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) throw new Error("Crypto unavailable");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function decodeImage(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try { return bitmap.width > 0 && bitmap.height > 0; }
    finally { bitmap.close(); }
  }
  // Older WebViews may lack createImageBitmap. Do not treat an unreadable
  // medical figure as decoded: validate with an HTMLImageElement instead.
  if (typeof Image === "undefined" || typeof Image.prototype.decode !== "function"
    || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  } finally { URL.revokeObjectURL(url); }
}

function issue(ref: RequiredQuestionMedia, code: MediaIssueCode): MediaIssue {
  return { questionId: ref.questionId, assetId: ref.assetId, code };
}

/** Validate only the images needed to answer a question. Timeout bounds slow
 * account downloads; the AbortSignal stops scheduling further work on exit. */
export async function preflightQuestionMedia(
  questions: readonly QuestionRecord[],
  options: MediaPreflightOptions = {},
): Promise<MediaPreflightResult> {
  const refs = questions.flatMap(requiredQuestionMedia);
  const issues: MediaIssue[] = [];
  const result: MediaPreflightResult = {
    total: refs.length, available: 0, hashesVerified: 0, decoded: 0,
    issues, blockedQuestionIds: [], cancelled: false,
  };
  const { signal, onProgress } = options;
  if (signal?.aborted) return { ...result, cancelled: true };
  if (!refs.length) return result;
  const load = options.load ?? getQuestionAttachmentBlob;
  const decode = options.decode ?? decodeImage;
  const hash = options.hash ?? sha256;
  const timeoutMs = Math.max(100, options.timeoutMs ?? 15000);
  let cursor = 0;
  let checked = 0;
  const blocked = new Set<string>();

  async function inspect(ref: RequiredQuestionMedia): Promise<{
    code?: MediaIssueCode; hashVerified?: boolean; decoded?: boolean;
  }> {
    const attachment = ref.attachment;
    if (!attachment?.blobKey || !attachment.byteSize) return { code: "missing-metadata" };
    let record: QuestionAttachmentBlobRecord | undefined;
    try { record = await load(attachment.blobKey); }
    catch { return { code: "lookup-failed" }; }
    if (!record?.blob) return { code: "missing-bytes" };
    if (record.questionId !== ref.questionId) return { code: "wrong-question" };
    if (record.byteSize !== attachment.byteSize || record.blob.size !== attachment.byteSize) return { code: "size-mismatch" };
    if (record.mimeType !== attachment.mimeType || (record.blob.type && record.blob.type !== attachment.mimeType)) return { code: "type-mismatch" };
    let hashVerified = false;
    if (ref.checksum !== undefined) {
      if (!/^sha256:[a-f0-9]{64}$/i.test(ref.checksum)) return { code: "invalid-checksum" };
      if (!globalThis.crypto?.subtle?.digest && !options.hash) return { code: "crypto-unavailable" };
      try {
        if ((await hash(record.blob)).toLowerCase() !== ref.checksum.slice(7).toLowerCase()) return { code: "checksum-mismatch" };
      } catch { return { code: "lookup-failed" }; }
      hashVerified = true;
    }
    try {
      if (!(await decode(record.blob))) return { code: "decode-failed" };
    } catch { return { code: "decode-failed" }; }
    return { hashVerified, decoded: true };
  }

  async function bounded(ref: RequiredQuestionMedia) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        inspect(ref),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("deadline")), timeoutMs); }),
      ]);
    } catch {
      return { code: "timeout" as const };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  const concurrency = Math.min(refs.length, Math.max(1, Math.floor(options.concurrency ?? 3)), 5);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!signal?.aborted) {
      const next = cursor++;
      if (next >= refs.length) break;
      const ref = refs[next];
      const status = await bounded(ref);
      if (signal?.aborted) break;
      checked++;
      if (status.code) {
        issues.push(issue(ref, status.code));
        blocked.add(ref.questionId);
      } else {
        result.available++;
        if (status.hashVerified) result.hashesVerified++;
        if (status.decoded) result.decoded++;
      }
      onProgress?.({ total: refs.length, checked, available: result.available, blocked: issues.length });
    }
  }));
  result.cancelled = Boolean(signal?.aborted);
  result.blockedQuestionIds = [...blocked];
  return result;
}
