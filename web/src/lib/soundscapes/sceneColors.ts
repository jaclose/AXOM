// ===========================================================================
// Colours for whatever sits on top of a soundscape scene (the orb and ring).
// A scene frame, scaled down to a few hundred pixels, is reduced to the two
// hues that carry it, tuned so a thin line of that colour stays readable on
// the scene: light on a dark scene, dark on a bright one, silver on a grey one.
// Pure functions; the component decides when to sample.
// ===========================================================================

export type Rgb = [number, number, number];

export interface ScenePalette {
  /** The scene's leading colour, for the ring and its glow. */
  primary: Rgb;
  /** A second colour from the scene (or a near neighbour of the first). */
  secondary: Rgb;
  /** 0..1 brightness of the frame around the orb. */
  centerLight: number;
  /** True when the frame had too little colour to name a hue. */
  neutral: boolean;
}

const HUE_BINS = 24;

function hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const light = (max + min) / 2;
  const delta = max - min;
  if (delta < 1e-4) return [0, 0, light];
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  let hue = max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [hue, Math.min(1, saturation), light];
}

export function hslToRgb(hue: number, saturation: number, light: number): Rgb {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x]
    : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const lift = light - chroma / 2;
  return [Math.round((r + lift) * 255), Math.round((g + lift) * 255), Math.round((b + lift) * 255)];
}

/** Move `from` a fraction of the way to `to` (per channel). */
export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
}

/**
 * Reduce RGBA pixels (row-major, `width` wide) to a palette. `focus` is where
 * the orb sits in the frame (0..1 each way; the middle by default): the
 * brightness there decides whether the line is drawn light or dark. Returns
 * null for a frame with nothing in it (not loaded yet, or fully black), so the
 * caller keeps what it had.
 */
export function paletteFromPixels(data: ArrayLike<number>, width: number, height: number, focus: { x: number; y: number } = { x: 0.5, y: 0.5 }): ScenePalette | null {
  const weight = new Float32Array(HUE_BINS);
  const saturationSum = new Float32Array(HUE_BINS);
  // Each bin keeps the true mean of its hues (as a vector), so the result is
  // the scene's colour and not the middle of whichever bin it fell in.
  const hueX = new Float32Array(HUE_BINS);
  const hueY = new Float32Array(HUE_BINS);
  const focusX = Math.min(1, Math.max(0, focus.x)) * width;
  const focusY = Math.min(1, Math.max(0, focus.y)) * height;
  let colour = 0;
  let seen = 0;
  let lightSum = 0;
  let centerLight = 0;
  let centerCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 128) continue;
      const [hue, saturation, light] = hsl(data[index], data[index + 1], data[index + 2]);
      seen += 1;
      lightSum += light;
      // A third of the frame around the orb.
      if (Math.abs(x + 0.5 - focusX) <= width / 6 && Math.abs(y + 0.5 - focusY) <= height / 6) {
        centerLight += light;
        centerCount += 1;
      }
      if (saturation < 0.14 || light < 0.06 || light > 0.96) continue;
      // Vivid mid-tones say most about a scene; near-black and near-white say little.
      const w = saturation ** 1.2 * Math.max(0.05, 1 - Math.abs(light - 0.5) * 1.5);
      const bin = Math.min(HUE_BINS - 1, Math.floor((hue / 360) * HUE_BINS));
      weight[bin] += w;
      saturationSum[bin] += saturation * w;
      hueX[bin] += Math.cos((hue * Math.PI) / 180) * w;
      hueY[bin] += Math.sin((hue * Math.PI) / 180) * w;
      colour += w;
    }
  }
  if (seen === 0 || lightSum / seen < 0.012) return null;
  const middle = centerCount ? centerLight / centerCount : lightSum / seen;
  // Light line on a dark middle, dark line on a bright one.
  const lineLight = middle > 0.62 ? 0.3 : 0.76;
  // How much of the frame carries colour. A scene that is nearly grey gets a
  // nearly grey line with only a breath of its hue, never an invented vivid one.
  const share = colour / seen;
  const confidence = Math.min(1, Math.max(0, (share - 0.012) / 0.07));
  if (share < 0.012) {
    const silver = hslToRgb(218, 0.16, middle > 0.62 ? 0.26 : 0.82);
    return { primary: silver, secondary: hslToRgb(218, 0.12, middle > 0.62 ? 0.36 : 0.66), centerLight: middle, neutral: true };
  }
  const smooth = (bin: number) => weight[bin] + 0.5 * (weight[(bin + HUE_BINS - 1) % HUE_BINS] + weight[(bin + 1) % HUE_BINS]);
  let first = 0;
  for (let bin = 1; bin < HUE_BINS; bin += 1) if (smooth(bin) > smooth(first)) first = bin;
  let second = -1;
  for (let bin = 0; bin < HUE_BINS; bin += 1) {
    const distance = Math.min(Math.abs(bin - first), HUE_BINS - Math.abs(bin - first));
    if (distance < 3 || smooth(bin) < smooth(first) * 0.22) continue;
    if (second < 0 || smooth(bin) > smooth(second)) second = bin;
  }
  const hueOf = (bin: number) => (weight[bin] ? ((Math.atan2(hueY[bin], hueX[bin]) * 180) / Math.PI + 360) % 360 : ((bin + 0.5) / HUE_BINS) * 360);
  const saturationOf = (bin: number) => {
    const vivid = Math.min(0.9, Math.max(0.46, weight[bin] ? saturationSum[bin] / weight[bin] : 0.6));
    return 0.14 + (vivid - 0.14) * confidence;
  };
  const primary = hslToRgb(hueOf(first), saturationOf(first), lineLight);
  const secondary = second >= 0
    ? hslToRgb(hueOf(second), saturationOf(second), lineLight - 0.06)
    // No second colour in the scene: a close neighbour of the first, never a new hue.
    : hslToRgb(hueOf(first) + 16, saturationOf(first) * 0.8, lineLight - 0.05);
  return { primary, secondary, centerLight: middle, neutral: false };
}
