// ===========================================================================
// Images named by an import ("Attachment: ecg-12.png"). The learner adds the
// image files next to the text; each file is matched to the questions that
// name it and saved as that question's exhibit, so it shows with the stem.
// Match exact source-relative paths first, then unique basenames, and then
// unique extension-free basenames. Duplicated names never pick the first
// anatomy/ECG image silently.
// ===========================================================================
import { sha256Hex } from "./checksum";
import type { QuestionAsset } from "./question-content/package";
import {
  createQuestionAttachment,
  getQuestionAttachmentBlob,
  normalizeAttachmentFileName,
  probeImageDimensions,
  validateQuestionAttachmentFile,
  type AttachmentCreationResult,
  type QuestionAttachmentMimeType,
  type QuestionImageAttachment,
} from "./questionAttachments";

/** "Figures/ECG-12.PNG" → "ecg-12.png" */
export function imageNameKey(name: string): string {
  return (name.trim().split(/[\\/]/).pop() ?? "").toLowerCase();
}

const withoutExtension = (key: string) => key.replace(/\.[a-z0-9]{2,5}$/, "");

/** Retain source-relative path when present, while matching case and slashes. */
export function imageReferenceKey(name: string): string {
  return name.trim().replace(/\\/g, "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
}

export interface NamedImageMatch<F extends { name: string }> { name: string; file?: F }

/** Never attach an arbitrary one of several same-named medical images. */
export function matchNamedImages<F extends { name: string }>(names: readonly string[], files: readonly F[]): NamedImageMatch<F>[] {
  const exact = new Map<string, F[]>();
  const loose = new Map<string, F[]>();
  for (const file of files) {
    const base = imageNameKey(file.name);
    exact.set(base, [...(exact.get(base) ?? []), file]);
    const stem = withoutExtension(base);
    loose.set(stem, [...(loose.get(stem) ?? []), file]);
  }
  return names.map((name) => {
    const path = imageReferenceKey(name);
    const key = imageNameKey(name);
    // An explicit path wins over basename when it names one and only one
    // asset. It may still be enclosed by a top-level imported course folder.
    const paths = files.filter(file => {
      const candidate = imageReferenceKey(file.name);
      return candidate === path || candidate.endsWith("/" + path);
    });
    if (paths.length === 1) return { name, file: paths[0] };
    if (paths.length > 1) return { name, file: undefined };
    const matches = exact.get(key) ?? [];
    if (matches.length === 1) return { name, file: matches[0] };
    if (matches.length > 1) return { name, file: undefined };
    const fallback = loose.get(withoutExtension(key)) ?? [];
    return { name, file: fallback.length === 1 ? fallback[0] : undefined };
  });
}

/** Every distinct source-relative reference across drafts, in source order. */
export function namedImages(drafts: ReadonlyArray<{ attachmentNames?: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const draft of drafts) {
    for (const name of draft.attachmentNames ?? []) {
      const key = imageReferenceKey(name);
      if (key && !seen.has(key)) seen.set(key, name.trim());
    }
  }
  return [...seen.values()];
}

const PRIVATE_LIBRARY_SHA_KEY = /^private-library:(sha256:[a-f0-9]{64})$/;

function attachmentId(): string {
  return `attachment-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function resolveContentAsset(
  name: string,
  file: File,
  assets: readonly QuestionAsset[],
): { asset?: QuestionAsset; problem?: string } {
  const referenced = imageNameKey(name);
  const supplied = imageNameKey(file.name);
  const matches = assets.filter((asset) => {
    const key = imageNameKey(asset.filename);
    return key === referenced || key === supplied;
  });
  if (!matches.length) return {};
  const conflicts = <T>(values: Array<T | undefined>): boolean => new Set(values.filter((value) => value !== undefined)).size > 1;
  if (conflicts(matches.map((asset) => asset.checksum?.toLowerCase()))
    || conflicts(matches.map((asset) => asset.mimeType))
    || conflicts(matches.map((asset) => asset.byteSize))
    || conflicts(matches.map((asset) => asset.width))
    || conflicts(matches.map((asset) => asset.height))) {
    return { problem: `"${file.name}" has conflicting reviewed image identities. Review the package before attaching any bytes.` };
  }
  // Prefer the most fully described reference so a duplicate placement with
  // sparse metadata cannot weaken an available checksum or size assertion.
  const asset = [...matches].sort((left, right) => (
    Number(Boolean(right.checksum)) + Number(right.byteSize !== undefined) + Number(right.width !== undefined) + Number(right.height !== undefined)
    - Number(Boolean(left.checksum)) - Number(left.byteSize !== undefined) - Number(left.width !== undefined) - Number(left.height !== undefined)
  ))[0];
  return { asset };
}

async function declaredAssetProblem(file: File, asset: QuestionAsset | undefined): Promise<string | undefined> {
  if (!asset) return undefined;
  if (asset.mimeType !== file.type) {
    return `"${file.name}" is ${file.type || "an unknown type"}, but the reviewed package declares ${asset.mimeType}. Re-export or review the source image.`;
  }
  if (asset.byteSize !== undefined && asset.byteSize !== file.size) {
    return `"${file.name}" is ${file.size} bytes, but the reviewed package declares ${asset.byteSize}. Re-export or review the source image.`;
  }
  if (asset.checksum !== undefined) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.checksum)) {
      return `"${file.name}" has an invalid reviewed SHA-256 identity. Re-export or review the source image.`;
    }
    const actual = await sha256Hex(await file.arrayBuffer());
    if (!actual) return `"${file.name}" could not be integrity-checked on this device, so AXOM did not attach it.`;
    if (actual.toLowerCase() !== asset.checksum.slice(7).toLowerCase()) {
      return `"${file.name}" does not match the reviewed package checksum. AXOM did not attach different image bytes to this question.`;
    }
  }
  return undefined;
}

/**
 * Reuse a verified private-library blob without sharing question metadata.
 *
 * Package metadata is only a candidate. The supplied file and the stored
 * canonical blob must both independently match its SHA, MIME, byte size and
 * declared dimensions. Ordinary imports therefore cannot claim a private
 * blob merely by reusing its filename or writing an untrusted checksum.
 */
async function linkVerifiedPrivateLibraryImage(input: {
  file: File;
  name: string;
  existing: readonly QuestionImageAttachment[];
  contentAssets: readonly QuestionAsset[];
}): Promise<AttachmentCreationResult | undefined> {
  const asset = resolveContentAsset(input.name, input.file, input.contentAssets).asset;
  const checksum = asset?.checksum?.toLowerCase();
  if (!checksum || !/^sha256:[a-f0-9]{64}$/.test(checksum)) return undefined;
  const blobKey = `private-library:${checksum}`;
  const identity = PRIVATE_LIBRARY_SHA_KEY.exec(blobKey)?.[1];
  if (!identity) return undefined;

  const validation = validateQuestionAttachmentFile(input.file, input.existing);
  if (!validation.ok) return { status: "rejected", message: validation.message };
  const mimeType = input.file.type as QuestionAttachmentMimeType;
  if (asset!.mimeType !== mimeType || (asset!.byteSize !== undefined && asset!.byteSize !== input.file.size)) return undefined;

  let stored;
  try {
    stored = await getQuestionAttachmentBlob(blobKey, { localOnly: true });
  } catch {
    return undefined;
  }
  if (!stored || stored.mimeType !== mimeType || stored.byteSize !== input.file.size
    || (stored.blob.type && stored.blob.type !== mimeType)) return undefined;

  const expected = identity.slice("sha256:".length);
  let fileHash: string | undefined;
  let storedHash: string | undefined;
  try {
    [fileHash, storedHash] = await Promise.all([
      input.file.arrayBuffer().then(sha256Hex),
      stored.blob.arrayBuffer().then(sha256Hex),
    ]);
  } catch {
    return undefined;
  }
  if (fileHash !== expected || storedHash !== expected) return undefined;

  let dimensions: { width: number; height: number } | undefined;
  try {
    dimensions = await probeImageDimensions(input.file);
  } catch {
    return { status: "rejected", message: `"${input.file.name}" could not be decoded as an image.` };
  }
  if ((asset!.width !== undefined && asset!.width !== dimensions?.width)
    || (asset!.height !== undefined && asset!.height !== dimensions?.height)) return undefined;

  const now = new Date().toISOString();
  return {
    status: "created",
    attachment: {
      id: attachmentId(),
      fileName: normalizeAttachmentFileName(input.file.name, mimeType),
      mimeType,
      byteSize: input.file.size,
      width: dimensions?.width,
      height: dimensions?.height,
      altText: "",
      createdAt: now,
      updatedAt: now,
      blobKey,
    },
  };
}

/**
 * Save a question's named images as its exhibits. Returns what was attached
 * and, in plain words, anything that could not be (wrong type, too large).
 */
export async function attachNamedImages(input: {
  names: readonly string[];
  files: readonly File[];
  questionId: string;
  /** Content-addressed candidates; bytes are reverified before any reuse. */
  contentAssets?: readonly QuestionAsset[];
}): Promise<{ attachments: QuestionImageAttachment[]; problems: string[] }> {
  const attachments: QuestionImageAttachment[] = [];
  const problems: string[] = [];
  for (const match of matchNamedImages(input.names, input.files)) {
    if (!match.file) continue;
    const resolved = input.contentAssets?.length
      ? resolveContentAsset(match.name, match.file, input.contentAssets)
      : {};
    if (resolved.problem) {
      problems.push(resolved.problem);
      continue;
    }
    const asset = resolved.asset;
    const integrityProblem = await declaredAssetProblem(match.file, asset);
    if (integrityProblem) {
      problems.push(integrityProblem);
      continue;
    }
    const linked = input.contentAssets?.length
      ? await linkVerifiedPrivateLibraryImage({
          file: match.file,
          name: match.name,
          existing: attachments,
          contentAssets: asset ? [asset] : input.contentAssets,
        })
      : undefined;
    const created = linked ?? await createQuestionAttachment({ file: match.file, questionId: input.questionId, existing: attachments });
    if (created.status === "created") attachments.push({ ...created.attachment, role: "exhibit" });
    else problems.push(`${match.file.name}: ${created.message}`);
  }
  return { attachments, problems };
}
