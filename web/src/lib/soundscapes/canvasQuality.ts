/** Limit generative Soundscapes canvases to native 8K UHD backing pixels.
 * Preview panels are deliberately cheaper. On a high-density fullscreen
 * display, use its real physical resolution rather than an upscaled image.
 * The display and source footage still determine actual sharpness.
 */
export const MAX_IMMERSIVE_CANVAS_PIXELS = 7680 * 4320;
export function canvasPixelRatio(width: number, height: number, deviceRatio: number, immersive = false): number {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const native = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const requested = Math.min(native, immersive ? 3 : 1.25);
  if (!immersive) return requested;
  return Math.min(requested, 7680 / Math.max(w, h), Math.sqrt(MAX_IMMERSIVE_CANVAS_PIXELS / (w * h)));
}

/** The shared WebGL surface may grow for fullscreen but must not hold an 8K
 * allocation after leaving it. Ignore small renders while fullscreen remains
 * active, since card previews share the same renderer.
 */
export function shouldReleaseImmersiveCanvas(
  backingWidth: number, backingHeight: number,
  requestedWidth: number, requestedHeight: number,
  fullscreenActive: boolean,
): boolean {
  const previous = backingWidth * backingHeight;
  const next = requestedWidth * requestedHeight;
  return !fullscreenActive && previous > 3840 * 2160 && next < previous / 3;
}
