// ===========================================================================
// Shared motion system (directive §2). Centralized tokens + hooks so motion is
// purposeful and consistent: progress feels like filling, streaks feel like
// embers, strong/missed days read at a glance. Everything here respects
// `prefers-reduced-motion` and degrades to instant, static output.
//
// Pure helpers (clamp01, pct, resolveDuration, scrollProgressFor) are unit
// tested; the hooks are SSR-safe and matchMedia/ResizeObserver-tolerant.
// ===========================================================================
import { useEffect, useRef, useState } from "react";
import { MOTION_PREFERENCE_EVENT, motionOverrideReduces } from "./motionPreference";

export const MOTION_TOKENS = {
  // Durations (ms)
  durationInstant: 0,
  durationFast: 160,
  durationBase: 280,
  durationSlow: 520,
  durationAmbient: 2400,
  // Easings
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  easeSpring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  // Glow intensity (box-shadow blur radii)
  glowSoft: 12,
  glowStrong: 22,
} as const;

export type MotionLevel = "full" | "reduced";
export function motionLevel(reduced: boolean): MotionLevel {
  return reduced ? "reduced" : "full";
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Percent (0–100) of value against max, clamped. */
export function pct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp01(value / max) * 100;
}

/** A transition duration that collapses to 0 under reduced motion. */
export function resolveDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : Math.max(0, ms);
}

/**
 * Scroll progress (0–1) of an element through the viewport:
 * 0 ≈ just entering from the bottom, 1 ≈ leaving past the top.
 */
export function scrollProgressFor(rect: { top: number; height: number }, viewportH: number): number {
  if (viewportH <= 0) return 0;
  const total = rect.height + viewportH;
  if (total <= 0) return 0;
  const seen = viewportH - rect.top;
  return clamp01(seen / total);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (motionOverrideReduces()) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Live reduced-motion state: the OS `prefers-reduced-motion` setting OR the
 * AXOM-level "Reduce motion" override from Settings → Personalization.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setReduced(prefersReducedMotion());
    handler();
    window.addEventListener(MOTION_PREFERENCE_EVENT, handler);
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_QUERY) : undefined;
    if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", handler);
    else if (mq && typeof mq.addListener === "function") mq.addListener(handler);
    return () => {
      window.removeEventListener(MOTION_PREFERENCE_EVENT, handler);
      if (mq && typeof mq.removeEventListener === "function") mq.removeEventListener("change", handler);
      else if (mq && typeof mq.removeListener === "function") mq.removeListener(handler);
    };
  }, []);
  return reduced;
}

/**
 * Track an element's scroll progress (0–1) through the viewport, throttled to
 * animation frames. Returns 0 and never attaches listeners under reduced motion.
 */
export function useScrollProgress<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || typeof window === "undefined") {
      setProgress(0);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setProgress(scrollProgressFor({ top: rect.top, height: rect.height }, window.innerHeight));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  return { ref, progress, reduced } as const;
}
