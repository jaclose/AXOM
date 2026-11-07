import { describe, expect, it } from "vitest";
import { canvasPixelRatio, shouldReleaseImmersiveCanvas } from "./canvasQuality";

describe("Soundscapes canvas resolution", () => {
  it("renders native 8K UHD pixels on an 8K display, without supersampling beyond 8K", () => {
    expect(canvasPixelRatio(7680, 4320, 1, true)).toBe(1);
    expect(canvasPixelRatio(3840, 2160, 2, true)).toBe(2);
    expect(canvasPixelRatio(1920, 1080, 4, true)).toBe(4); // Retina 8K physical output
    expect(canvasPixelRatio(7680, 4320, 2, true)).toBe(1);
  });

  it("keeps the lightweight preview quality and adapts to the actual display", () => {
    expect(canvasPixelRatio(1440, 900, 2, false)).toBe(1.25);
    expect(canvasPixelRatio(1920, 1080, 2, true)).toBe(2);
    expect(canvasPixelRatio(1440, 900, 1, true)).toBe(1);
  });

  it("keeps the shared high-resolution WebGL backing while immersive, but releases it on exit", () => {
    expect(shouldReleaseImmersiveCanvas(7680, 4320, 1280, 720, true)).toBe(false);
    expect(shouldReleaseImmersiveCanvas(7680, 4320, 1280, 720, false)).toBe(true);
    expect(shouldReleaseImmersiveCanvas(1920, 1080, 1280, 720, false)).toBe(false);
    expect(shouldReleaseImmersiveCanvas(7680, 4320, 7000, 3900, false)).toBe(false);
  });

  it("clamps excessive pixel density, invalid sizes, and portrait displays", () => {
    const ratio = canvasPixelRatio(4000, 6000, 4, true);
    expect(ratio * 4000 * ratio * 6000).toBeLessThanOrEqual(7680 * 4320 + 1);
    expect(ratio * 6000).toBeLessThanOrEqual(7680);
    expect(Number.isFinite(canvasPixelRatio(0, 0, Number.NaN, true))).toBe(true);
    expect(canvasPixelRatio(1000, 500, 0, true)).toBe(1);
  });
});
