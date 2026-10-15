import { readImageInfo } from "../question-content/assets";
import {
  MAX_QUESTION_ATTACHMENT_BYTES,
  QUESTION_ATTACHMENT_TYPES,
  type QuestionAttachmentMimeType,
} from "../questionAttachments";

/**
 * Validate ALL GIF image frames, rather than trusting the 10-byte GIF header
 * accepted by readImageInfo(). The LZW reader checks the compressed code stream
 * and exact pixel count without constructing an unbounded RGBA frame buffer.
 *
 * Deliberately fail closed on truncated sub-blocks, missing trailer/EOI,
 * broken dictionary references, or excessive decompression work. This is a
 * pure byte check and runs in browsers as well as focused Node tests.
 */
/** Bound decoder work before any native/browser image decoder receives bytes. */
export const MAX_ACADEMIC_IMAGE_PIXELS = 64_000_000;
const MAX_FRAME_PIXELS = MAX_ACADEMIC_IMAGE_PIXELS;
const MAX_ANIMATION_PIXELS = MAX_ACADEMIC_IMAGE_PIXELS;
const MAX_FRAMES = 240;
const MAX_LZW_CODES = 4_000_000;
const CORRUPT = "The academic GIF is truncated or cannot be fully decoded. Replace or review the original figure before uploading.";

function invalid(): never { throw new Error(CORRUPT); }

function assertLzwPixels(data: Uint8Array, minimum: number, expectedPixels: number): void {
  if (minimum < 2 || minimum > 8 || !data.length) invalid();
  const clear = 1 << minimum;
  const end = clear + 1;
  const lengths = new Uint32Array(4096);
  lengths.fill(1, 0, clear);

  let width = minimum + 1;
  let next = end + 1;
  let prior = -1;
  let hasClear = false;
  let bits = 0;
  let emitted = 0;
  let codes = 0;
  while (bits + width <= data.length * 8) {
    if (++codes > MAX_LZW_CODES) invalid();
    const index = bits >> 3;
    const value = (data[index] ?? 0) | ((data[index + 1] ?? 0) << 8) | ((data[index + 2] ?? 0) << 16);
    const code = (value >> (bits & 7)) & ((1 << width) - 1);
    bits += width;

    if (code === clear) {
      width = minimum + 1;
      next = end + 1;
      prior = -1;
      hasClear = true;
      continue;
    }
    if (!hasClear) invalid();
    if (code === end) {
      if (emitted !== expectedPixels) invalid();
      return;
    }
    const run = code < clear ? 1
      : code < next && lengths[code] > 0 ? lengths[code]
      : code === next && prior >= 0 ? lengths[prior] + 1 : 0;
    if (!run || prior < 0 && code >= clear) invalid();
    emitted += run;
    if (emitted > expectedPixels) invalid();

    if (prior >= 0 && next < 4096) {
      lengths[next++] = lengths[prior] + 1;
      if (next === (1 << width) && width < 12) width++;
    }
    prior = code;
  }
  // Some tiny GIFs decoded successfully by Chrome omit the optional
  // end-of-information code after supplying every pixel. Accept that narrow
  // interoperability case ONLY after exact LZW pixel output plus a complete
  // frame/sub-block structure and trailing GIF terminator have been checked.
  if (emitted === expectedPixels) return;
  invalid();
}

export function assertCompleteAcademicGif(bytes: Uint8Array): { width: number; height: number; frames: number } {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") invalid();
  let position = 6;
  const need = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || position + length > bytes.length) invalid();
  };
  const word = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  need(7);
  const width = word(position);
  const height = word(position + 2);
  const packed = bytes[position + 4];
  position += 7;
  if (!width || !height || width * height > MAX_FRAME_PIXELS) invalid();
  const hasGlobalPalette = (packed & 0x80) !== 0;
  if (hasGlobalPalette) {
    const size = 3 * (1 << ((packed & 7) + 1));
    need(size); position += size;
  }

  const blocks = (): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      need(1);
      const count = bytes[position++];
      if (!count) break;
      need(count);
      chunks.push(bytes.subarray(position, position + count));
      position += count;
      total += count;
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
    return joined;
  };

  let frames = 0;
  let cumulativePixels = 0;
  while (position < bytes.length) {
    const marker = bytes[position++];
    if (marker === 0x3b) {
      if (frames < 1 || position !== bytes.length) invalid();
      return { width, height, frames };
    }
    if (marker === 0x21) {
      need(1);
      const label = bytes[position++];
      if (label === 0xf9) {
        need(6);
        if (bytes[position] !== 4 || bytes[position + 5] !== 0) invalid();
        position += 6;
      } else {
        blocks();
      }
      continue;
    }
    if (marker !== 0x2c) invalid();
    need(9);
    const left = word(position);
    const top = word(position + 2);
    const frameWidth = word(position + 4);
    const frameHeight = word(position + 6);
    const framePacked = bytes[position + 8];
    position += 9;
    const framePixels = frameWidth * frameHeight;
    cumulativePixels += framePixels;
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height
      || framePixels > MAX_FRAME_PIXELS || cumulativePixels > MAX_ANIMATION_PIXELS || ++frames > MAX_FRAMES) invalid();

    const localPalette = (framePacked & 0x80) !== 0;
    if (!hasGlobalPalette && !localPalette) invalid();
    if (localPalette) {
      const size = 3 * (1 << ((framePacked & 7) + 1));
      need(size); position += size;
    }
    need(1);
    const minLzw = bytes[position++];
    assertLzwPixels(blocks(), minLzw, framePixels);
  }
  invalid(); // The GIF trailer is mandatory, even when an image was decoded.
}

/** A successful MIME/header sniff is not a decoded image. Enforce the same
 * actual browser decode contract for PNG, JPEG, WebP and GIF. For GIF this is
 * additionally preceded by the strict all-frame LZW check above.
 *
 * A rejected createImageBitmap may be a browser implementation limitation:
 * retry via HTMLImageElement.decode before refusing the image. Decoded,
 * positive pixel dimensions must match the source header exactly.
 *
 * A structural parser is not a production receipt. Environments without a
 * usable real decoder (including pure Node) fail closed. */
export async function assertBrowserAcademicImageDecodable(
  bytes: Uint8Array, mime: string, expected: { width: number; height: number },
): Promise<void> {
  const pixels = expected.width * expected.height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAX_ACADEMIC_IMAGE_PIXELS)
    throw new Error("The academic image exceeds AXOM's 64,000,000 decoded-pixel limit.");
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const matches = (width: number, height: number) =>
    Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width === expected.width && height === expected.height;
  const decodeFailed = (): never => {
    throw new Error("The academic image cannot be fully decoded, or its dimensions disagree with the source header.");
  };

  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | undefined;
    try { bitmap = await createImageBitmap(blob); } catch { /* Try the HTML fallback below. */ }
    if (bitmap) {
      try {
        if (!matches(bitmap.width, bitmap.height)) decodeFailed();
        return;
      } finally { bitmap.close?.(); }
    }
  }

  if (typeof Image !== "undefined" && typeof Image.prototype?.decode === "function"
    && typeof URL.createObjectURL === "function" && typeof URL.revokeObjectURL === "function") {
    let candidateUrl: string | undefined;
    try { candidateUrl = URL.createObjectURL(blob); } catch { decodeFailed(); }
    const url = candidateUrl ?? decodeFailed();
    if (!url) decodeFailed();
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!matches(image.naturalWidth, image.naturalHeight)) decodeFailed();
      return;
    } catch { decodeFailed(); }
    finally { URL.revokeObjectURL(url); }
  }

  decodeFailed();
}

export interface InstallableAcademicImage {
  mimeType: QuestionAttachmentMimeType;
  byteSize: number;
  width: number;
  height: number;
}

/** The common byte-to-install boundary for academic images. Header sniffing
 * alone is never an installation receipt: the full image must decode in the
 * browser, GIF animation streams receive the stricter structural check, and
 * decoded dimensions must agree with the source header. */
export async function assertInstallableAcademicImageBytes(
  bytes: Uint8Array, mime: string,
): Promise<InstallableAcademicImage> {
  if (!bytes.length || bytes.length > MAX_QUESTION_ATTACHMENT_BYTES)
    throw new Error("An academic figure exceeds AXOM's 8 MiB per-image attachment limit.");
  const image = readImageInfo(bytes);
  if (!image || image.mimeType !== mime
    || !QUESTION_ATTACHMENT_TYPES.includes(mime as QuestionAttachmentMimeType))
    throw new Error("The academic image content does not match its declared image type.");
  const { width, height } = image;
  if (typeof width !== "number" || typeof height !== "number"
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0)
    throw new Error("An academic image is missing valid positive dimensions.");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_ACADEMIC_IMAGE_PIXELS)
    throw new Error("The academic image exceeds AXOM's 64,000,000 decoded-pixel limit.");
  if (mime === "image/gif") {
    const gif = assertCompleteAcademicGif(bytes);
    if (width !== gif.width || height !== gif.height)
      throw new Error("The GIF's declared dimensions do not match its image data.");
  }
  await assertBrowserAcademicImageDecodable(bytes, mime, { width, height });
  return { mimeType: mime as QuestionAttachmentMimeType, byteSize: bytes.length, width, height };
}
