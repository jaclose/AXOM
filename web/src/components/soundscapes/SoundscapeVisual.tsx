import { useEffect, useRef } from "react";
import type { SoundscapeVisual as VisualKind } from "../../lib/soundscapes/presets";
import { soundscapeAnalyser } from "../../lib/soundscapes/store";
import { canvasPixelRatio } from "../../lib/soundscapes/canvasQuality";
import { useReducedMotion } from "../../lib/motion";
import { VISUAL_RENDERERS, type VisualColors } from "./visuals";
import { rgbChannels, shaderRenderer } from "./shaders";

function paletteColors(): VisualColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read("--accent-rgb", "200,169,106"),
    cool: read("--cool-rgb", "120,160,190"),
    hi: read("--accent-hi-rgb", "236,221,186"),
  };
}

/**
 * Live canvas for a soundscape. Animates only while visible and while
 * `animate` is true; reduced motion draws one still frame. Colors follow the
 * active palette (re-read when the theme or palette changes).
 */
export function SoundscapeVisual({ visual, overlay, overlayMix = 0.55, animate, reactive = false, immersive = false, className = "", label }: {
  visual: VisualKind;
  /** A second scene blended on top (screen), e.g. rain over the lattice. */
  overlay?: VisualKind;
  overlayMix?: number;
  animate: boolean;
  /** Follow the live audio level (only for the preset that is playing). */
  reactive?: boolean;
  /** Native display pixels, up to 8K UHD, in fullscreen only. */
  immersive?: boolean;
  className?: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep one timeline as fullscreen restarts the drawing effect. Freezing
  // it on pause/reduced motion also prevents a large delayed frame jump.
  const timelineRef = useRef({ seconds: 12, lastNow: 0 });
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let visible = true;
    let colors = paletteColors();
    let level = 0;
    let samples = new Uint8Array(0);
    let lastPaint = 0;
    const draw = VISUAL_RENDERERS[visual];

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = canvasPixelRatio(width, height, window.devicePixelRatio || 1, immersive);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const paint = (now: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      if (reactive) {
        const analyser = soundscapeAnalyser();
        let target = 0;
        if (analyser) {
          if (samples.length !== analyser.fftSize) samples = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          target = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        }
        // Heavy smoothing keeps brightness changes far below flash rates.
        level += (target - level) * 0.04;
      }
      const timeline = timelineRef.current;
      if (animate && !reduced && !document.hidden && visible) {
        if (timeline.lastNow > 0) timeline.seconds += Math.max(0, (now - timeline.lastNow) / 1000);
        timeline.lastNow = now;
      } else {
        timeline.lastNow = 0;
      }
      const t = timeline.seconds;
      const ratio = canvasPixelRatio(width, height, window.devicePixelRatio || 1, immersive);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      const drawn = shaderRenderer.draw(visual, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), {
        time: t, level, accent: rgbChannels(colors.accent), cool: rgbChannels(colors.cool), hi: rgbChannels(colors.hi),
      }, context);
      context.restore();
      if (!drawn) {
        context.clearRect(0, 0, width, height);
        draw({ ctx: context, width, height, t, level, colors });
      }
      if (overlay && overlay !== visual) {
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = Math.max(0, Math.min(1, overlayMix));
        context.setTransform(1, 0, 0, 1, 0, 0);
        const overlaid = shaderRenderer.draw(overlay, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), {
          time: t + 7, level, accent: rgbChannels(colors.accent), cool: rgbChannels(colors.cool), hi: rgbChannels(colors.hi),
        }, context);
        if (!overlaid) {
          const scale = ratio;
          context.setTransform(scale, 0, 0, scale, 0, 0);
          VISUAL_RENDERERS[overlay]({ ctx: context, width, height, t: t + 7, level, colors });
        }
        context.restore();
      }
    };
    const loop = (now: number) => {
      if (!animate || reduced || !visible || document.hidden) return;
      if (now - lastPaint >= 1000 / 30) { lastPaint = now; paint(now); }
      frame = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };

    resize();
    paint(performance.now());
    if (animate && !reduced) restart();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { resize(); paint(performance.now()); }) : null;
    resizeObserver?.observe(canvas);
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && animate && !reduced) restart();
      else { timelineRef.current.lastNow = 0; cancelAnimationFrame(frame); }
    }) : null;
    intersection?.observe(canvas);
    const onVisibility = () => {
      if (!document.hidden && animate && !reduced) restart();
      else { timelineRef.current.lastNow = 0; cancelAnimationFrame(frame); }
    };
    const onPalette = () => { colors = paletteColors(); paint(performance.now()); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("axom:palette-change", onPalette);
    window.addEventListener("axom:theme-change", onPalette);
    const themeObserver = new MutationObserver(onPalette);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "style"] });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("axom:palette-change", onPalette);
      window.removeEventListener("axom:theme-change", onPalette);
    };
  }, [visual, overlay, overlayMix, animate, reactive, immersive, reduced]);

  return <canvas ref={canvasRef} className={`soundscape-visual ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
