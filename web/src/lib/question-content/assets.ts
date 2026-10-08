// ===========================================================================
// What a picture file is, read from its own first bytes: its kind and its
// size in pixels. A file's name can lie; its header does not. Also the
// checksum an asset carries, and the step that fills an asset's facts in
// once its bytes are in hand.
// ===========================================================================
import type { PackageQuestion, QuestionAsset } from "./package";

export interface ImageInfo {
  mimeType: string;
  /** Absent for a kind AXOM recognises but cannot measure or show (EMF, WMF, TIFF, BMP). */
  width?: number;
  height?: number;
}

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) === 0x89504e47 && bytes.length >= 24) return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (ascii(bytes, 0, 3) === "GIF") return { mimeType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the segments to the frame header, which holds the size.
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return { mimeType: "image/jpeg" };
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at += 1;
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: "image/jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      } else if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        at += 2;
      } else at += 2 + view.getUint16(at + 2);
    }
    return { mimeType: "image/jpeg" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && bytes.length >= 30) {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8 ") return { mimeType: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      return { mimeType: "image/webp", width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)) };
    }
    if (kind === "VP8X") {
      return { mimeType: "image/webp", width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    }
    return { mimeType: "image/webp" };
  }
  if (bytes.length >= 44 && view.getUint32(0, true) === 1 && ascii(bytes, 40, 4) === " EMF") return { mimeType: "image/emf" };
  if (view.getUint32(0, true) === 0x9ac6cdd7) return { mimeType: "image/wmf" };
  if (ascii(bytes, 0, 2) === "BM") return { mimeType: "image/bmp" };
  if (ascii(bytes, 0, 4) === "II*\0" || ascii(bytes, 0, 4) === "MM\0*") return { mimeType: "image/tiff" };
  return undefined;
}

const EXTENSION_OF: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/emf": "emf", "image/wmf": "wmf", "image/bmp": "bmp", "image/tiff": "tiff",
};

/** The picture kinds AXOM stores and shows. */
export const SHOWABLE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Fills in what only the bytes can say: kind, pixel size, byte size and
 * checksum. Each asset's file is renamed after the asset, so two questions
 * can never claim one file name. Returns the files by their new names.
 */
export async function describeAssets(
  questions: readonly PackageQuestion[],
  bytesOf: (asset: QuestionAsset) => Uint8Array | undefined,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const question of questions) {
    for (const asset of question.assets) {
      const bytes = bytesOf(asset);
      if (!bytes) continue;
      const info = readImageInfo(bytes);
      const extension = (info && EXTENSION_OF[info.mimeType]) ?? asset.filename.split(".").pop()?.toLowerCase() ?? "bin";
      asset.filename = `${asset.id}.${extension}`;
      if (info) asset.mimeType = info.mimeType;
      // The stored picture's own size, not the size it was drawn at on the page.
      if (info?.width && info.height) {
        asset.width = info.width;
        asset.height = info.height;
      } else {
        delete asset.width;
        delete asset.height;
      }
      asset.byteSize = bytes.length;
      asset.checksum = await sha256(bytes);
      files.set(asset.filename, bytes);
    }
  }
  return files;
}
