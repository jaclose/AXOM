import { STORAGE_KEYS } from "./brand";

/**
 * Accent palettes — a device-local personalization layer that sits on top of
 * the Light/Dark/System theme. The theme decides paper vs. graphite; the
 * palette decides the identity accent (gold, violet, sapphire…), the secondary
 * mineral accent, and a faint ambient tint in the backdrop.
 *
 * AXOM Classic is the canonical brand palette and lives in theme.css, so it
 * needs no injected CSS. Every other palette is derived from a small set of
 * hand-tuned inputs per mode and injected as one `<style>` element. The
 * pre-paint script in index.html replays the stored variables before the first
 * frame, so a palette never flashes gold on reload.
 */

export type PaletteId =
  | "classic"
  | "ivory"
  | "amethyst"
  | "sapphire"
  | "midnight"
  | "emerald"
  | "rose"
  | "platinum"
  | "custom";

export type PaletteMode = "dark" | "light";
type Rgb = readonly [number, number, number];

export interface PaletteModeInput {
  /** Luminous accent used for glows, washes, and framed edges. */
  accent: string;
  /** Solid accent for text, icons, and selected borders (contrast-safe). */
  ink: string;
  /** Lighter sheen used at the start of accent gradients. */
  hi: string;
  /** Deeper accent used at the end of accent gradients. */
  lo: string;
  /** Secondary mineral accent — the everyday interactive tone. */
  cool: string;
  coolStrong: string;
  /** Backdrop gradient stops. */
  bg: readonly [string, string, string];
  /** Faint ambient tint for the backdrop orbs. */
  tint: string;
  /** Glass fill tint for cards and the shell. */
  surface: string;
  /** Light mode only: warm/cool paper tone and structural ink. */
  paper?: string;
  structure?: string;
}

export interface PaletteDefinition {
  id: PaletteId;
  label: string;
  pairing: string;
  description: string;
  dark: PaletteModeInput;
  light: PaletteModeInput;
}

export interface PalettePreference {
  id: PaletteId;
  /** `#rrggbb`; only meaningful for the custom palette. */
  customAccent?: string;
}

export interface StoredPalette extends PalettePreference {
  version: 1;
  /** Pre-computed CSS variables so the pre-paint script can replay them. */
  vars?: { dark: Record<string, string>; light: Record<string, string> };
}

export const PALETTE_CHANGE_EVENT = "axom:palette-change";
export const PALETTE_STYLE_ID = "axom-palette";
export const DEFAULT_CUSTOM_ACCENT = "#7c6cf0";

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: "classic",
    label: "AXOM Classic",
    pairing: "Gold & graphite",
    description: "The signature muted gold on mineral graphite and warm paper.",
    dark: {
      accent: "#c8a96a", ink: "#c8a96a", hi: "#f7d99a", lo: "#a8894f",
      cool: "#aeb8c3", coolStrong: "#cbd1d7",
      bg: ["#08080a", "#0c0c0e", "#121214"], tint: "#e6e2d6", surface: "#161619",
    },
    light: {
      accent: "#c8a96a", ink: "#8a6429", hi: "#dcc38a", lo: "#6f4d1d",
      cool: "#526171", coolStrong: "#354453",
      bg: ["#eee7da", "#f7f3ec", "#e5dccd"], tint: "#c8a96a", surface: "#fffdf8",
      paper: "#e5dbcb", structure: "#43331f",
    },
  },
  {
    id: "ivory",
    label: "Ivory",
    pairing: "Gold & white",
    description: "Bright gallery white with polished gold; onyx and bone after dark.",
    dark: {
      accent: "#d4b26e", ink: "#d8b877", hi: "#fae4b0", lo: "#aa8a4e",
      cool: "#e9e5dc", coolStrong: "#f7f4ee",
      bg: ["#050505", "#09090a", "#0f0f10"], tint: "#ffffff", surface: "#151515",
    },
    light: {
      accent: "#c9a45c", ink: "#7f5a1f", hi: "#e2c588", lo: "#6e4e1a",
      cool: "#5c5f66", coolStrong: "#3a3d44",
      bg: ["#f7f6f2", "#ffffff", "#efece5"], tint: "#c9a45c", surface: "#ffffff",
      paper: "#efebe2", structure: "#3a3226",
    },
  },
  {
    id: "amethyst",
    label: "Amethyst",
    pairing: "Purple & black",
    description: "Royal violet over true black; lavender paper in light mode.",
    dark: {
      accent: "#a88be0", ink: "#b9a2ec", hi: "#d9c8fa", lo: "#7c60be",
      cool: "#beb5d6", coolStrong: "#d9d2ec",
      bg: ["#060409", "#0a070f", "#110c18"], tint: "#a88be0", surface: "#17131e",
    },
    light: {
      accent: "#8b6ad2", ink: "#5b3d91", hi: "#bea5eb", lo: "#462d78",
      cool: "#5a5270", coolStrong: "#3e3754",
      bg: ["#f1edf7", "#faf8fd", "#e7e0f1"], tint: "#8b6ad2", surface: "#fcfaff",
      paper: "#e4dcf0", structure: "#2d2146",
    },
  },
  {
    id: "sapphire",
    label: "Sapphire",
    pairing: "Blue & silver",
    description: "Cool sapphire accents with brushed-silver controls.",
    dark: {
      accent: "#7ea6e0", ink: "#94b7ea", hi: "#c4daf8", lo: "#4e76b4",
      cool: "#c9d1db", coolStrong: "#e3e8ee",
      bg: ["#04060a", "#070a10", "#0c1119"], tint: "#7ea6e0", surface: "#12161d",
    },
    light: {
      accent: "#4678c8", ink: "#1f4f8f", hi: "#96b9eb", lo: "#14376e",
      cool: "#56606e", coolStrong: "#384250",
      bg: ["#eef1f6", "#f8fafc", "#e2e7ef"], tint: "#4678c8", surface: "#fbfcfe",
      paper: "#dae2ee", structure: "#1c283e",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    pairing: "Navy & gold",
    description: "Deep navy night with warm gold — a classic academic pairing.",
    dark: {
      accent: "#d6b46e", ink: "#dcbc7c", hi: "#f8e0aa", lo: "#aa8a4e",
      cool: "#96aad2", coolStrong: "#c3d0ea",
      bg: ["#04060d", "#070a15", "#0c1222"], tint: "#5a78be", surface: "#11151f",
    },
    light: {
      accent: "#c8a45c", ink: "#7d5a1f", hi: "#e0c488", lo: "#1f2f55",
      cool: "#34466e", coolStrong: "#22335a",
      bg: ["#edf0f6", "#f8f9fc", "#e1e6f0"], tint: "#34466e", surface: "#fbfcfe",
      paper: "#dce3f0", structure: "#1a243e",
    },
  },
  {
    id: "emerald",
    label: "Emerald",
    pairing: "Green & onyx",
    description: "Calm emerald over onyx; soft sage paper in light mode.",
    dark: {
      accent: "#5ec496", ink: "#78d0a8", hi: "#b2ecce", lo: "#348c66",
      cool: "#c4d4cc", coolStrong: "#dfe9e3",
      bg: ["#040806", "#070c0a", "#0b1410"], tint: "#5ec496", surface: "#121815",
    },
    light: {
      accent: "#2e9669", ink: "#166646", hi: "#82cdaa", lo: "#0c462e",
      cool: "#4e6158", coolStrong: "#33443c",
      bg: ["#edf4f0", "#f8fbf9", "#e0ebe5"], tint: "#2e9669", surface: "#fbfdfc",
      paper: "#d8e8e0", structure: "#1a3428",
    },
  },
  {
    id: "rose",
    label: "Rosé",
    pairing: "Rose gold & charcoal",
    description: "Rose gold over warm charcoal; blush paper in light mode.",
    dark: {
      accent: "#dea096", ink: "#e6b2a8", hi: "#f8d6ce", lo: "#b07066",
      cool: "#d6c8c5", coolStrong: "#ece0dd",
      bg: ["#090607", "#0e0a0b", "#150f11"], tint: "#dea096", surface: "#1a1415",
    },
    light: {
      accent: "#c4766a", ink: "#96463c", hi: "#e8b0a6", lo: "#6e3028",
      cool: "#6b5754", coolStrong: "#4a3a38",
      bg: ["#f6efed", "#fdf9f8", "#ede1de"], tint: "#c4766a", surface: "#fffcfb",
      paper: "#eededa", structure: "#462824",
    },
  },
  {
    id: "platinum",
    label: "Platinum",
    pairing: "Silver & black",
    description: "Monochrome platinum on black — no color, only material.",
    dark: {
      accent: "#ced4dc", ink: "#d6dbe2", hi: "#f0f3f7", lo: "#969eaa",
      cool: "#aab2be", coolStrong: "#cfd5dd",
      bg: ["#060607", "#0a0a0b", "#101012"], tint: "#dce0e6", surface: "#151517",
    },
    light: {
      accent: "#78808c", ink: "#373c44", hi: "#bec4cd", lo: "#282c32",
      cool: "#5a616b", coolStrong: "#3b4048",
      bg: ["#f0f1f3", "#fafafb", "#e5e7ea"], tint: "#78808c", surface: "#ffffff",
      paper: "#e2e5e9", structure: "#1e2126",
    },
  },
];

const PALETTE_IDS = new Set<PaletteId>([
  "classic", "ivory", "amethyst", "sapphire", "midnight", "emerald", "rose", "platinum", "custom",
]);
const HEX = /^#[0-9a-f]{6}$/i;

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTE_IDS.has(value as PaletteId);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function paletteDefinition(id: PaletteId, customAccent?: string): PaletteDefinition {
  if (id === "custom") return customPaletteDefinition(isHexColor(customAccent) ? customAccent : DEFAULT_CUSTOM_ACCENT);
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

// ---------------------------------------------------------------------------
// Color math (sRGB, WCAG relative luminance). Kept local and dependency-free.
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): Rgb {
  const clean = HEX.test(hex) ? hex.slice(1) : "000000";
  return [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16)) as unknown as Rgb;
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Mix `a` toward `b`; amount 0 = a, 1 = b. */
export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [0, 1, 2].map((index) => clampChannel(a[index] + (b[index] - a[index]) * t)) as unknown as Rgb;
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------
// OKLCH (Björn Ottosson's OKLab in polar form). Perceptual lightness lets AXOM
// fix contrast by moving L alone while holding hue, reducing chroma only when
// a color would leave the sRGB gamut.
// ---------------------------------------------------------------------------

export interface Oklch { l: number; c: number; h: number }

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** Unclamped linear-light conversion; values outside 0–255 are out of gamut. */
function oklchToRawRgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const A = c * Math.cos(radians);
  const B = c * Math.sin(radians);
  const l1 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m1 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s1 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1;
  const g = -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1;
  const b = -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1;
  return [fromLinear(r), fromLinear(g), fromLinear(b)];
}

/** Convert to sRGB, lowering chroma (never hue) until the color fits the gamut. */
export function oklchToRgb(color: Oklch): Rgb {
  const l = Math.max(0, Math.min(1, color.l));
  let c = Math.max(0, color.c);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const raw = oklchToRawRgb({ l, c, h: color.h });
    if (raw.every((channel) => channel >= -0.5 && channel <= 255.5)) return raw.map(clampChannel) as unknown as Rgb;
    c *= 0.9;
  }
  return oklchToRawRgb({ l, c: 0, h: color.h }).map(clampChannel) as unknown as Rgb;
}

/** Shift perceptual lightness (and optionally scale chroma) while holding hue. */
export function adjustOklch(color: Rgb, deltaL: number, chromaScale = 1): Rgb {
  const lch = rgbToOklch(color);
  return oklchToRgb({ l: lch.l + deltaL, c: lch.c * chromaScale, h: lch.h });
}

/**
 * Reach a WCAG contrast ratio against a surface by moving only perceptual
 * lightness (binary search for the smallest change), so the hue survives.
 */
export function ensureContrast(color: Rgb, against: Rgb, minimum: number): Rgb {
  if (contrastRatio(color, against) >= minimum) return color;
  const lch = rgbToOklch(color);
  const lighten = relativeLuminance(against) <= 0.4;
  let low = lch.l;
  let high = lighten ? 1 : 0;
  let best: Rgb = lighten ? [255, 255, 255] : [0, 0, 0];
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = oklchToRgb({ l: mid, c: lch.c, h: lch.h });
    if (contrastRatio(candidate, against) >= minimum) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

function channels(hex: string): string {
  return hexToRgb(hex).join(", ");
}

function alpha(hex: string, value: number): string {
  return `rgba(${channels(hex)}, ${value})`;
}

// ---------------------------------------------------------------------------
// Token derivation
// ---------------------------------------------------------------------------

/** Every palette emits the same variable set in both modes, so a light block
 * always fully overrides its dark block by specificity alone. */
export function derivePaletteVars(input: PaletteModeInput, mode: PaletteMode): Record<string, string> {
  const onAccentDark = [26, 22, 14] as const;
  const onAccentLight = [250, 248, 244] as const;
  const accentMid = mixRgb(hexToRgb(input.hi), hexToRgb(input.accent), 0.5);
  const onAccent = contrastRatio(accentMid, onAccentDark) >= contrastRatio(accentMid, onAccentLight)
    ? onAccentDark
    : onAccentLight;
  const dark = mode === "dark";
  const surface = hexToRgb(input.surface);
  const paper = input.paper ?? (dark ? input.bg[2] : "#e5dbcb");
  const structure = input.structure ?? (dark ? "#e6e2d6" : "#43331f");
  return {
    "--accent-rgb": channels(input.accent),
    "--accent-ink-rgb": channels(input.ink),
    "--accent-hi-rgb": channels(input.hi),
    "--accent-lo-rgb": channels(input.lo),
    "--accent-hi": input.hi,
    "--accent-lo": input.lo,
    "--on-accent": rgbToHex(onAccent),
    "--gold": input.ink,
    "--gold-soft": alpha(input.ink, dark ? 0.14 : 0.12),
    "--gold-line": alpha(input.ink, dark ? 0.34 : 0.42),
    "--gold-glow": alpha(input.ink, dark ? 0.22 : 0.17),
    "--axom-gold": dark ? input.accent : input.ink,
    "--axom-gold-soft": dark ? input.hi : input.lo,
    "--shadow-gold": `0 0 0 1px ${alpha(input.ink, dark ? 0.28 : 0.25)}, 0 10px ${dark ? 28 : 24}px ${alpha(input.ink, dark ? 0.12 : 0.1)}`,
    "--frame-gold": dark
      ? `0 0 0 1px ${alpha(input.ink, 0.5)}, 0 0 0 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(230, 226, 214, 0.06)`
      : `0 0 0 1px ${alpha(input.ink, 0.45)}, 0 0 0 2px rgba(255, 255, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
    "--axom-focus-ring": `0 0 0 1px ${alpha(dark ? input.accent : input.ink, 0.72)}, 0 0 0 6px ${alpha(dark ? input.accent : input.ink, 0.12)}`,
    "--cool-accent": input.cool,
    "--cool-accent-strong": input.coolStrong,
    "--cool-accent-soft": alpha(input.cool, 0.1),
    "--cool-accent-line": alpha(input.cool, dark ? 0.24 : 0.25),
    "--bg-1": input.bg[0],
    "--bg-2": input.bg[1],
    "--bg-3": input.bg[2],
    "--axom-bg": input.bg[1],
    "--axom-bg-soft": input.bg[2],
    "--tint-rgb": channels(input.tint),
    "--orb-a-rgb": channels(dark ? input.cool : input.tint),
    "--orb-rgb": channels(input.accent),
    "--cool-rgb": channels(input.cool),
    "--on-cool": rgbToHex(contrastRatio(hexToRgb(input.cool), onAccentDark) >= contrastRatio(hexToRgb(input.cool), onAccentLight) ? onAccentDark : onAccentLight),
    "--ambient": dark ? "2.2" : "1.5",
    "--paper-rgb": channels(paper),
    "--ink-rgb": channels(structure),
    "--glass-card-fill": dark ? `rgba(${surface.join(", ")}, 0.6)` : `rgba(${surface.join(", ")}, 0.74)`,
    "--surface-1": dark ? `rgba(${mixRgb(surface, [36, 36, 40], 0.4).join(", ")}, 0.62)` : "rgba(255, 255, 255, 0.62)",
    "--surface-2": dark ? `rgba(${mixRgb(surface, [44, 44, 50], 0.4).join(", ")}, 0.72)` : "rgba(255, 255, 255, 0.78)",
    "--shell-fill": dark ? `rgba(${mixRgb(surface, [10, 10, 12], 0.35).join(", ")}, 0.66)` : `rgba(${channels(input.bg[1])}, 0.72)`,
  };
}

/**
 * Build a full palette from one learner-chosen color. Contrast is enforced so
 * a pale yellow or near-black pick still produces legible accents in both
 * modes; the chosen hue is preserved.
 */
export function customPaletteDefinition(accentHex: string): PaletteDefinition {
  const base = hexToRgb(isHexColor(accentHex) ? accentHex : DEFAULT_CUSTOM_ACCENT);
  const darkSurface: Rgb = [16, 16, 19];
  const lightSurface: Rgb = [250, 250, 250];
  // Every derived tone keeps the chosen hue; only lightness/chroma move.
  const darkAccent = ensureContrast(base, darkSurface, 4.5);
  const darkInk = ensureContrast(adjustOklch(base, 0.05), darkSurface, 6.5);
  const lightInk = ensureContrast(base, lightSurface, 6);
  const lightAccent = rgbToOklch(base).l > 0.78 ? adjustOklch(base, -0.18) : base;
  const darkCool = ensureContrast(adjustOklch(base, 0.1, 0.22), darkSurface, 7);
  const lightCool = ensureContrast(adjustOklch(base, -0.2, 0.3), lightSurface, 5.5);
  const tintedNeutral = (l: number, chroma: number): string => {
    const hue = rgbToOklch(base).h;
    return rgbToHex(oklchToRgb({ l, c: chroma, h: hue }));
  };
  return {
    id: "custom",
    label: "Custom",
    pairing: "Your color",
    description: "Your accent, with contrast tuned automatically for both modes.",
    dark: {
      accent: rgbToHex(darkAccent),
      ink: rgbToHex(darkInk),
      hi: rgbToHex(adjustOklch(darkAccent, 0.14, 0.85)),
      lo: rgbToHex(adjustOklch(darkAccent, -0.16)),
      cool: rgbToHex(darkCool),
      coolStrong: rgbToHex(adjustOklch(darkCool, 0.08)),
      bg: [tintedNeutral(0.13, 0.008), tintedNeutral(0.155, 0.01), tintedNeutral(0.19, 0.012)],
      tint: rgbToHex(darkAccent),
      surface: tintedNeutral(0.215, 0.01),
    },
    light: {
      accent: rgbToHex(lightAccent),
      ink: rgbToHex(lightInk),
      hi: rgbToHex(adjustOklch(lightAccent, 0.14, 0.8)),
      lo: rgbToHex(adjustOklch(lightInk, -0.12)),
      cool: rgbToHex(lightCool),
      coolStrong: rgbToHex(adjustOklch(lightCool, -0.1)),
      bg: [tintedNeutral(0.955, 0.008), tintedNeutral(0.985, 0.004), tintedNeutral(0.925, 0.011)],
      tint: rgbToHex(lightAccent),
      surface: tintedNeutral(0.995, 0.003),
      paper: tintedNeutral(0.91, 0.014),
      structure: tintedNeutral(0.25, 0.03),
    },
  };
}

export function paletteVars(preference: PalettePreference): StoredPalette["vars"] | undefined {
  if (preference.id === "classic") return undefined;
  const definition = paletteDefinition(preference.id, preference.customAccent);
  return {
    dark: derivePaletteVars(definition.dark, "dark"),
    light: derivePaletteVars(definition.light, "light"),
  };
}

const VAR_NAME = /^--[a-z0-9-]{1,40}$/;
const VAR_VALUE = /^[#0-9a-zA-Z(),.%\s-]{1,200}$/;

/** Serialize variables into CSS. Names and values are allow-listed so a
 * tampered storage entry can never escape the declaration block. */
export function paletteCss(id: PaletteId, vars: StoredPalette["vars"]): string {
  if (!vars || !isPaletteId(id) || id === "classic") return "";
  const block = (record: Record<string, string>) => Object.entries(record)
    .filter(([name, value]) => VAR_NAME.test(name) && VAR_VALUE.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return `:root[data-palette="${id}"] { ${block(vars.dark)} }\n`
    + `:root[data-palette="${id}"][data-theme="light"] { ${block(vars.light)} }`;
}

/** The browser chrome color for the current palette and resolved theme. */
export function paletteThemeColor(preference: PalettePreference, mode: PaletteMode): string {
  if (preference.id === "classic") return mode === "dark" ? "#0d0d0e" : "#f3eee3";
  const definition = paletteDefinition(preference.id, preference.customAccent);
  return (mode === "dark" ? definition.dark : definition.light).bg[1];
}

// ---------------------------------------------------------------------------
// Persistence + application
// ---------------------------------------------------------------------------

type PaletteStorage = Pick<Storage, "getItem" | "setItem">;
let volatilePreference: PalettePreference | undefined;

function browserStorage(): PaletteStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizePalettePreference(value: unknown): PalettePreference {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const id = isPaletteId(record.id) ? record.id : "classic";
  const customAccent = isHexColor(record.customAccent) ? record.customAccent.toLowerCase() : undefined;
  return id === "custom"
    ? { id, customAccent: customAccent ?? DEFAULT_CUSTOM_ACCENT }
    : { id, ...(customAccent ? { customAccent } : {}) };
}

export function readPalettePreference(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): PalettePreference {
  if (!storage) return volatilePreference ?? { id: "classic" };
  try {
    const raw = storage.getItem(STORAGE_KEYS.palettePreference);
    return raw ? normalizePalettePreference(JSON.parse(raw)) : { id: "classic" };
  } catch {
    return volatilePreference ?? { id: "classic" };
  }
}

function resolvedMode(targetDocument: Document | undefined): PaletteMode {
  return targetDocument?.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Apply a palette to the document: attribute, injected variables, chrome color. */
export function applyPalettePreference(
  preference: PalettePreference,
  targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!targetDocument) return;
  const safe = normalizePalettePreference(preference);
  const root = targetDocument.documentElement;
  const existing = targetDocument.getElementById(PALETTE_STYLE_ID);
  if (safe.id === "classic") {
    delete root.dataset.palette;
    existing?.remove();
  } else {
    root.dataset.palette = safe.id;
    const css = paletteCss(safe.id, paletteVars(safe));
    const style = existing ?? targetDocument.createElement("style");
    style.id = PALETTE_STYLE_ID;
    if (style.textContent !== css) style.textContent = css;
    if (!existing) targetDocument.head.appendChild(style);
  }
  syncPaletteThemeColor(safe, targetDocument);
}

export function syncPaletteThemeColor(
  preference: PalettePreference = readPalettePreference(),
  targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  const meta = targetDocument?.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  meta?.setAttribute("content", paletteThemeColor(preference, resolvedMode(targetDocument)));
}

export function setPalettePreference(
  preference: PalettePreference,
  options: { storage?: Pick<Storage, "setItem">; window?: Window; document?: Document } = {},
): PalettePreference {
  const safe = normalizePalettePreference(preference);
  const targetWindow = options.window ?? (typeof window === "undefined" ? undefined : window);
  const targetDocument = options.document ?? targetWindow?.document;
  const storage = options.storage ?? browserStorage();
  volatilePreference = safe;
  const stored: StoredPalette = { version: 1, ...safe, vars: paletteVars(safe) };
  try {
    storage?.setItem(STORAGE_KEYS.palettePreference, JSON.stringify(stored));
  } catch {
    // The palette still applies for this session when storage is blocked.
  }
  applyPalettePreference(safe, targetDocument);
  if (targetWindow && typeof CustomEvent !== "undefined") {
    targetWindow.dispatchEvent(new CustomEvent<PalettePreference>(PALETTE_CHANGE_EVENT, { detail: safe }));
  }
  return safe;
}

/** Keep the palette synchronized across tabs; the pre-paint script owns frame one. */
export function installPaletteSync(
  targetWindow: Window | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!targetWindow) return () => {};
  const storage = (() => {
    try { return targetWindow.localStorage; } catch { return undefined; }
  })();
  applyPalettePreference(readPalettePreference(storage), targetWindow.document);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.palettePreference) return;
    const preference = readPalettePreference(storage);
    applyPalettePreference(preference, targetWindow.document);
    targetWindow.dispatchEvent(new CustomEvent<PalettePreference>(PALETTE_CHANGE_EVENT, { detail: preference }));
  };
  targetWindow.addEventListener("storage", onStorage);
  return () => targetWindow.removeEventListener("storage", onStorage);
}
