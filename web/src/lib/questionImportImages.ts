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

function matchingContentAsset(
  name: string,
  file: File,
  assets: readonly QuestionAsset[],
): QuestionAsset | undefined {
  const referenced = imageNameKey(name);
  const supplied = imageNameKey(file.name);
  const matches = assets.filter((asset) => {
    const key = imageNameKey(asset.filename);
    return key === referenced || key === supplied;
  });
  if (!matches.length) return undefined;
  const identities = new Set(matches.map((asset) => asset.checksum).filter(Boolean));
  return identities.size === 1 && matches.every((asset) => asset.checksum === matches[0].checksum)
    ? matches[0]
    : undefined;
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
  const asset = matchingContentAsset(input.name, input.file, input.contentAssets);
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
    const linked = input.contentAssets?.length
      ? await linkVerifiedPrivateLibraryImage({
          file: match.file,
          name: match.name,
          existing: attachments,
          contentAssets: input.contentAssets,
        })
      : undefined;
    const created = linked ?? await createQuestionAttachment({ file: match.file, questionId: input.questionId, existing: attachments });
    if (created.status === "created") attachments.push({ ...created.attachment, role: "exhibit" });
    else problems.push(`${match.file.name}: ${created.message}`);
  }
  return { attachments, problems };
}
