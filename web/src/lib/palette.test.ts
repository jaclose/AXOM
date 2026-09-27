// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PALETTES,
  applyPalettePreference,
  contrastRatio,
  customPaletteDefinition,
  derivePaletteVars,
  hexToRgb,
  normalizePalettePreference,
  paletteCss,
  paletteThemeColor,
  paletteVars,
  readPalettePreference,
  rgbToHex,
  setPalettePreference,
} from "./palette";
import { STORAGE_KEYS } from "./brand";

// jsdom rewrites import.meta.url; vitest runs from the web/ package root.
const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "src/styles/theme.css"), "utf8");

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
  document.head.innerHTML = '<meta name="theme-color" content="#0d0d0e">';
  document.documentElement.dataset.theme = "dark";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.palette;
  document.getElementById("axom-palette")?.remove();
});

describe("palette catalog", () => {
  it("keeps readable accent ink in both modes for every curated palette", () => {
    for (const palette of PALETTES) {
      expect(contrastRatio(hexToRgb(palette.dark.ink), hexToRgb(palette.dark.bg[1])), `${palette.id} dark ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hexToRgb(palette.light.ink), hexToRgb(palette.light.bg[1])), `${palette.id} light ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hexToRgb(palette.light.cool), hexToRgb(palette.light.bg[1])), `${palette.id} light cool`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("emits the same variable set for both modes so light always overrides dark", () => {
    for (const palette of PALETTES) {
      expect(Object.keys(derivePaletteVars(palette.dark, "dark"))).toEqual(Object.keys(derivePaletteVars(palette.light, "light")));
    }
  });

  it("defines every palette channel for AXOM Classic in theme.css", () => {
    const names = Object.keys(derivePaletteVars(PALETTES[0].dark, "dark"));
    for (const name of names) expect(themeCss, name).toContain(`${name}:`);
  });

  it("derives a legible custom palette from any pick — even pale yellow or near black", () => {
    for (const hex of ["#fff7a8", "#050505", "#7c6cf0", "#00ff00"]) {
      const custom = customPaletteDefinition(hex);
      expect(contrastRatio(hexToRgb(custom.dark.ink), [16, 16, 19])).toBeGreaterThanOrEqual(6.4);
      expect(contrastRatio(hexToRgb(custom.light.ink), [250, 250, 250])).toBeGreaterThanOrEqual(5.9);
    }
  });
});

describe("palette persistence and application", () => {
  it("normalizes unknown input to Classic and keeps a valid custom accent", () => {
    expect(normalizePalettePreference({ id: "neon" })).toEqual({ id: "classic" });
    expect(normalizePalettePreference({ id: "custom", customAccent: "#ABCDEF" })).toEqual({ id: "custom", customAccent: "#abcdef" });
    expect(normalizePalettePreference({ id: "custom", customAccent: "red" }).customAccent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("applies, persists, and removes a palette without touching workspace storage", () => {
    setPalettePreference({ id: "sapphire" });
    expect(document.documentElement.dataset.palette).toBe("sapphire");
    expect(document.getElementById("axom-palette")?.textContent).toContain(':root[data-palette="sapphire"][data-theme="light"]');
    expect(readPalettePreference()).toEqual({ id: "sapphire" });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(paletteThemeColor({ id: "sapphire" }, "dark"));
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();

    applyPalettePreference({ id: "classic" });
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.getElementById("axom-palette")).toBeNull();
  });

  it("allow-lists CSS so a tampered stored entry cannot escape its block", () => {
    const vars = paletteVars({ id: "amethyst" })!;
    const hostile = { dark: { ...vars.dark, "--evil": "red; } body { display: none" , "--x}y": "1" }, light: vars.light };
    const css = paletteCss("amethyst", hostile);
    expect(css).not.toContain("display: none");
    expect(css).not.toContain("--x}y");
    expect(css.split("{").length).toBe(3);
  });

  it("keeps the pre-paint script in sync with the palette ids and storage key", () => {
    expect(indexHtml).toContain(`"${STORAGE_KEYS.palettePreference}"`);
    for (const palette of PALETTES.filter((item) => item.id !== "classic")) expect(indexHtml).toContain(`"${palette.id}"`);
    expect(indexHtml).toContain('"custom"');
    expect(indexHtml).toContain(`"${STORAGE_KEYS.motionPreference}"`);
  });
});

describe("OKLCH color math", () => {
  it("round-trips sRGB through OKLCH", async () => {
    const { rgbToOklch, oklchToRgb } = await import("./palette");
    for (const hex of ["#c8a96a", "#7c6cf0", "#1f4f8f", "#ffffff", "#000000", "#e0566b"]) {
      expect(rgbToHex(oklchToRgb(rgbToOklch(hexToRgb(hex))))).toBe(hex);
    }
  });

  it("fixes contrast by lightness while keeping the hue", async () => {
    const { rgbToOklch, ensureContrast } = await import("./palette");
    for (const hex of ["#3b2fb0", "#fff7a8", "#e0566b", "#2fb6c9"]) {
      const base = hexToRgb(hex);
      for (const [surface, minimum] of [[[16, 16, 19], 6.5], [[250, 250, 250], 6]] as const) {
        const fixed = ensureContrast(base, surface as unknown as [number, number, number], minimum);
        expect(contrastRatio(fixed, surface as unknown as [number, number, number])).toBeGreaterThanOrEqual(minimum - 0.01);
        const before = rgbToOklch(base);
        const after = rgbToOklch(fixed);
        if (before.c > 0.04 && after.c > 0.04) {
          const drift = Math.abs(((after.h - before.h + 540) % 360) - 180);
          expect(drift, `${hex} hue drift`).toBeLessThan(6);
        }
      }
    }
  });
});
