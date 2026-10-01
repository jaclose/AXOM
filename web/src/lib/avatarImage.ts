import { useEffect } from "react";
import { useStore } from "./store";

/**
 * Profile photos are shown at 76 px and 32 px, but were stored as the file the
 * learner picked. One 2.5 MB PNG then rode along in every local save, every
 * backup file and every account upload (a quarter of a 9.6 MB snapshot). A
 * large photo is now stored at display size instead; small files are kept
 * exactly as they were chosen.
 */

/** Short side of a stored photo: 76 px shown, times three for dense screens, rounded up. */
export const AVATAR_SHORT_SIDE = 256;
/** A photo is cropped to a square when shown, so a very long side is only weight. */
const AVATAR_LONG_SIDE = 1024;
/** Data URLs up to this many characters (about 90 KB of image) are left alone. */
export const AVATAR_COMPACT_ABOVE = 120_000;

/** The size to store a photo at: never enlarged, short side at most 256 px. */
export function avatarTargetSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, AVATAR_SHORT_SIDE / Math.min(width, height), AVATAR_LONG_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Re-encode a large photo at display size. Returns the input when it is
 * already small, cannot be read, or would not get smaller.
 */
export async function compactAvatarDataUrl(dataUrl: string): Promise<string> {
  if (dataUrl.length <= AVATAR_COMPACT_ABOVE || typeof document === "undefined") return dataUrl;
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();
    const target = avatarTargetSize(image.naturalWidth, image.naturalHeight);
    if (!target.width) return dataUrl;

    // Halve in steps: one large jump skips most source pixels and looks rough.
    let source: CanvasImageSource = image;
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    let canvas: HTMLCanvasElement | undefined;
    do {
      width = Math.max(target.width, Math.ceil(width / 2));
      height = Math.max(target.height, Math.ceil(height / 2));
      const step = document.createElement("canvas");
      step.width = width;
      step.height = height;
      const context = step.getContext("2d");
      if (!context) return dataUrl;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, height);
      source = step;
      canvas = step;
    } while (width > target.width || height > target.height);

    // WebP is smallest and keeps transparency. Safari's canvas cannot write it
    // and answers with PNG; a photo with no transparency is then better as JPEG.
    let compact = canvas.toDataURL("image/webp", 0.86);
    if (!compact.startsWith("data:image/webp") && isOpaque(canvas)) compact = canvas.toDataURL("image/jpeg", 0.86);
    return compact.length < dataUrl.length ? compact : dataUrl;
  } catch {
    return dataUrl;
  }
}

function isOpaque(canvas: HTMLCanvasElement): boolean {
  const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!pixels) return false;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return false;
  return true;
}

/** Photos that could not be made smaller, so each is only tried once per visit. */
const settled = new Set<string>();

/**
 * Keeps the stored photo at display size wherever it came from: an older
 * version of AXOM, a backup file, or a protected version from another device.
 */
export function useCompactAvatar(): void {
  const avatar = useStore((state) => state.profile.avatarDataUrl);
  useEffect(() => {
    if (!avatar || avatar.length <= AVATAR_COMPACT_ABOVE || settled.has(avatar)) return;
    let current = true;
    void compactAvatarDataUrl(avatar).then((compact) => {
      if (compact === avatar) {
        settled.add(avatar);
        return;
      }
      // Only replace the photo that was measured; the learner may have picked another meanwhile.
      if (current && useStore.getState().profile.avatarDataUrl === avatar) useStore.getState().updateProfile({ avatarDataUrl: compact });
    });
    return () => { current = false; };
  }, [avatar]);
}
