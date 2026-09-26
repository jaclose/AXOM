import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Palette channel tokens (--accent-rgb, --cool-rgb, …) hold comma-separated
 * channels ("200,169,106"). `rgb(var(--accent-rgb) / 0.2)` is therefore
 * invalid CSS and the browser silently drops the whole declaration — use
 * `rgba(var(--accent-rgb), 0.2)`.
 */
const dir = fileURLToPath(new URL(".", import.meta.url));
const sheets = readdirSync(dir).filter((name) => name.endsWith(".css"));

describe("CSS palette token syntax", () => {
  it.each(sheets)("%s never mixes comma tokens with slash alpha", (name) => {
    const css = readFileSync(dir + name, "utf8");
    expect(css.match(/rgba?\(\s*var\(--[\w-]+(?:,\s*var\(--[\w-]+\))?\)\s*\/[^)]*\)/g) ?? []).toEqual([]);
  });
});
