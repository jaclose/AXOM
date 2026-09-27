import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyThemePreference } from "./theme";

const componentCss = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

function declarations(selector: string): string {
  const start = componentCss.indexOf(`${selector} {`);
  expect(start, `${selector} is defined`).toBeGreaterThanOrEqual(0);
  const open = componentCss.indexOf("{", start);
  return componentCss.slice(open + 1, componentCss.indexOf("}", open));
}

function hexColors(css: string): string[] {
  return css.match(/#[0-9a-f]{6}\b/gi) ?? [];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("light-theme notification contrast", () => {
  const surfaces = hexColors(declarations(':root[data-theme="light"] .toast'));
  const color = (selector: string) => hexColors(declarations(selector))[0];

  it("replaces the dark toast surface with a light one", () => {
    expect(surfaces).toHaveLength(2);
    for (const surface of surfaces) expect(luminance(surface)).toBeGreaterThan(0.8);
  });

  it.each([
    [':root[data-theme="light"] .toast-body b', 4.5],
    [':root[data-theme="light"] .toast-body span', 4.5],
    [':root[data-theme="light"] .toast-action', 4.5],
    [':root[data-theme="light"] .toast-close', 3],
  ])("%s meets WCAG AA (>= %s:1) on every part of the surface", (selector, minimum) => {
    const foreground = color(selector);
    expect(foreground).toMatch(/^#/);
    for (const surface of surfaces) expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(minimum);
  });

  it("follows the system theme through the resolved data-theme attribute", () => {
    const dataset: Record<string, string> = {};
    const fakeDocument = {
      documentElement: { dataset, style: {} },
      querySelector: () => null,
    } as unknown as Document;
    expect(applyThemePreference("system", fakeDocument, false)).toBe("light");
    expect(dataset.theme).toBe("light");
  });
});

describe("notification actions", () => {
  it("renders button actions without browser button chrome in either theme", () => {
    const action = declarations(":root .toast-stack button.toast-action");
    expect(action).toContain("background: transparent");
    expect(action).toContain("border: 0");
  });
});

describe("notification placement", () => {
  const stack = declarations(":root .toast-stack");

  it("respects safe areas and never intercepts clicks outside a notice", () => {
    expect(stack).toContain("env(safe-area-inset-bottom)");
    expect(stack).toContain("env(safe-area-inset-right)");
    expect(stack).toContain("pointer-events: none");
    expect(stack).toMatch(/max-height:[^;]*100dvh/);
    expect(declarations(":root .toast-stack > .toast")).toContain("pointer-events: auto");
  });

  it("stays clear of the live-session bar and of phone dialog action bars", () => {
    expect(declarations(":root body:has(.focus-dock) .toast-stack")).toContain("--toast-lift");
    const phone = componentCss.slice(componentCss.indexOf(":root .toast-stack > .toast"));
    expect(phone).toMatch(/@media \(max-width: 520px\)[\s\S]*max-height: min\(42dvh/);
    expect(declarations(':root body:has([aria-modal="true"], .sidebar.open) .toast-stack')).toContain("bottom: auto");
  });
});
