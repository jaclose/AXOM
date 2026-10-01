import { describe, expect, it } from "vitest";
import { hslToRgb, mixRgb, paletteFromPixels, type Rgb } from "./sceneColors";

/** A width x height frame painted by `colour(x, y)`. */
function frame(width: number, height: number, colour: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return data;
}

const hueOf = ([r, g, b]: Rgb) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const lightOf = ([r, g, b]: Rgb) => (Math.max(r, g, b) + Math.min(r, g, b)) / 510;

describe("scene colours for the orb", () => {
  it("leads with the scene's main hue and finds its second colour", () => {
    // A dark blue scene with orange streaks (a light-streak tunnel).
    const palette = paletteFromPixels(frame(24, 14, (x, y) => ((x + y) % 5 === 0 ? [240, 130, 30] : [12, 40, 120])), 24, 14)!;
    expect(palette.neutral).toBe(false);
    expect(hueOf(palette.primary)).toBeGreaterThan(200);
    expect(hueOf(palette.primary)).toBeLessThan(250);
    expect(hueOf(palette.secondary)).toBeGreaterThan(15);
    expect(hueOf(palette.secondary)).toBeLessThan(45);
  });

  it("draws light on a dark scene and dark on a bright one", () => {
    const dark = paletteFromPixels(frame(12, 12, () => [10, 60, 40]), 12, 12)!;
    const bright = paletteFromPixels(frame(12, 12, () => [190, 240, 215]), 12, 12)!;
    expect(lightOf(dark.primary)).toBeGreaterThan(0.6);
    expect(lightOf(bright.primary)).toBeLessThan(0.4);
    expect(bright.centerLight).toBeGreaterThan(0.62);
  });

  it("goes silver when the scene has no colour to speak of", () => {
    const grey = paletteFromPixels(frame(12, 12, (x) => [60 + x * 4, 62 + x * 4, 64 + x * 4]), 12, 12)!;
    expect(grey.neutral).toBe(true);
    const [r, g, b] = grey.primary;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
  });

  it("keeps a nearly grey scene nearly grey instead of inventing a vivid colour", () => {
    // Slate water: mostly grey, with a few faintly blue pixels.
    const slate = paletteFromPixels(frame(24, 14, (x, y) => ((x * 7 + y * 3) % 11 === 0 ? [70, 96, 150] : [100, 104, 110])), 24, 14)!;
    const [r, g, b] = slate.primary;
    const spread = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    expect(spread).toBeLessThan(0.25);
    const vivid = paletteFromPixels(frame(24, 14, () => [20, 60, 200]), 24, 14)!;
    expect((Math.max(...vivid.primary) - Math.min(...vivid.primary)) / 255).toBeGreaterThan(spread);
  });

  it("stays close to the first hue when there is only one", () => {
    const palette = paletteFromPixels(frame(12, 12, () => [20, 150, 90]), 12, 12)!;
    const gap = Math.abs(hueOf(palette.secondary) - hueOf(palette.primary));
    expect(Math.min(gap, 360 - gap)).toBeLessThan(45);
  });

  it("reports the scene's own hue, not the middle of a colour bucket", () => {
    // Steel blue sits at 207 degrees; the 15-degree bucket it falls in is centred on 202.5.
    const palette = paletteFromPixels(frame(12, 12, () => [40, 110, 170]), 12, 12)!;
    expect(hueOf(palette.primary)).toBeGreaterThan(205);
    expect(hueOf(palette.primary)).toBeLessThan(210);
  });

  it("judges light and dark where the orb sits", () => {
    // Bright sky on top, dark ground below.
    const split = frame(12, 12, (_, y) => (y < 6 ? [200, 225, 250] : [10, 20, 40]));
    const high = paletteFromPixels(split, 12, 12, { x: 0.5, y: 0.15 })!;
    const low = paletteFromPixels(split, 12, 12, { x: 0.5, y: 0.85 })!;
    expect(high.centerLight).toBeGreaterThan(0.62);
    expect(lightOf(high.primary)).toBeLessThan(0.4);
    expect(low.centerLight).toBeLessThan(0.2);
    expect(lightOf(low.primary)).toBeGreaterThan(0.6);
  });

  it("returns nothing for an empty or unloaded frame", () => {
    expect(paletteFromPixels(new Uint8ClampedArray(12 * 12 * 4), 12, 12)).toBeNull();
    expect(paletteFromPixels(frame(12, 12, () => [1, 1, 1]), 12, 12)).toBeNull();
  });

  it("converts and mixes colours", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(mixRgb([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });
});
