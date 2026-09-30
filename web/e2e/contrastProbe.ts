/**
 * Gradient-aware text contrast probe. axe-core marks text over gradients as
 * "incomplete", and that is exactly where AXOM regressed three times (tour tip,
 * Promise prompt, Daily Word kicker): a surface with a fixed dark gradient kept
 * the theme's ink, which turns dark in light mode. This walks visible text,
 * resolves the first opaque background layer behind it (colour or gradient
 * stops), and returns the worst ratio per element.
 *
 * Runs inside the page (page.evaluate), so it must stay self-contained.
 */
export interface ContrastFinding {
  text: string;
  selector: string;
  ratio: number;
  fg: string;
  bg: string;
  fontSize: number;
}

export function probeContrast({ minRatio, root }: { minRatio: number; root?: string }): ContrastFinding[] {
  type RGBA = [number, number, number, number];
  const parse = (value: string): RGBA | null => {
    // color-mix() and other CSS Color 4 results serialize as color(srgb r g b [/ a]) with 0-1 channels.
    const srgb = value.match(/color\(srgb\s+([^)]+)\)/);
    if (srgb) {
      const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts[3] ?? 1];
    }
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    }
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    return null;
  };
  const colorsIn = (image: string): RGBA[] => {
    const found = image.match(/color\(srgb[^)]+\)|rgba?\([^)]+\)|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? [];
    return found.map(parse).filter((c): c is RGBA => c !== null);
  };
  const luminance = ([r, g, b]: RGBA) => {
    const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: RGBA, b: RGBA) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const blend = (top: RGBA, under: RGBA): RGBA => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const describe = (element: Element) => {
    const parts: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const cls = [...node.classList].slice(0, 2).join(".");
      parts.unshift(`${node.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
    }
    return parts.join(" > ");
  };

  /** Backgrounds behind an element: the first layer that is opaque enough to read against. */
  const backgroundsFor = (element: Element): RGBA[] => {
    const canvas = [document.body, document.documentElement]
      .map((node) => parse(getComputedStyle(node).backgroundColor))
      .find((color): color is RGBA => color !== null && color[3] >= 0.6);
    const page: RGBA = canvas ?? [255, 255, 255, 1];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const stops = style.backgroundImage.includes("gradient") ? colorsIn(style.backgroundImage).filter((c) => c[3] >= 0.6) : [];
      if (stops.length) return stops.map((c) => (c[3] < 1 ? blend(c, page) : c));
      const color = parse(style.backgroundColor);
      if (color && color[3] >= 0.6) return [color[3] < 1 ? blend(color, page) : color];
    }
    return [page];
  };

  const findings: ContrastFinding[] = [];
  // With a modal open, only the dialog is the reading surface; the page behind is scrimmed on purpose.
  const scope = (root ? document.querySelector(root) : null)
    ?? [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].pop()
    ?? document.body;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const content = text.textContent?.trim() ?? "";
    const element = text.parentElement;
    if (!content || !element || seen.has(element)) continue;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
    let opacity = 1;
    let hidden = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= Number(style.opacity);
      if (style.visibility === "hidden" || style.display === "none" || node.closest(".sr-only")) hidden = true;
    }
    if (hidden || opacity < 0.35) continue;
    const style = getComputedStyle(element);
    const fg = parse(style.color);
    if (!fg || fg[3] === 0) continue;
    const worst = Math.min(...backgroundsFor(element).map((bg) => ratio(fg[3] < 1 ? blend(fg, bg) : fg, bg)));
    if (worst < minRatio) {
      findings.push({
        text: content.slice(0, 60),
        selector: describe(element),
        ratio: Math.round(worst * 100) / 100,
        fg: style.color,
        bg: backgroundsFor(element).map((c) => `rgb(${c.slice(0, 3).map(Math.round).join(",")})`).join(" / "),
        fontSize: parseFloat(style.fontSize),
      });
    }
  }
  return findings;
}
