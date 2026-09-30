// ===========================================================================
// Presentation — how AXOM resolves into view. One place owns:
//   • app readiness (the first real frame of the workspace has rendered),
//   • the reveal after the opening film ("intro") or on a plain open ("open"),
//   • first visits to each tab, which get a lighter entrance,
//   • reduced motion (no reveal at all).
// Motion itself is CSS (styles/presentation.css), keyed on
// :root[data-reveal] and .page[data-enter], and applied to whole regions:
// sidebar zones, the top bar, page sections and dashboard widgets. No widget
// knows about any of this.
// ===========================================================================
import { useLayoutEffect, useRef } from "react";

/** "promise": after signing, a slower top-to-bottom slot-in (JD, Ideas 3). */
export type RevealKind = "intro" | "open" | "promise";

/** Timings shared by the film player and the CSS (keep them in step). */
export const PRESENTATION_TIMING = {
  /** A film that holds its last frame fades to the film's black first. */
  toBlackMs: 380,
  /** The black layer fades away while the shell resolves beneath it. */
  overlayFadeMs: 560,
  /** Skip, Escape or a media error: a short, still graceful fade. */
  quickFadeMs: 240,
  /** Longest wait on black for the workspace's first frame before revealing anyway. */
  readyHoldMs: 2500,
  /** Longest reveal: last region delay plus its duration, with margin. */
  settleMs: 1000,
  /** The slower reveal after the Promise (see presentation.css). */
  promiseSettleMs: 2300,
} as const;

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export function prefersReducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.motion === "reduce") return true;
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return true;
  }
}

// --- app readiness -----------------------------------------------------------

let ready = false;
const readyWaiters = new Set<() => void>();

/** Called once the workspace (or setup) has rendered real content. */
export function markAppReady(): void {
  if (ready) return;
  ready = true;
  for (const resolve of readyWaiters) resolve();
  readyWaiters.clear();
}

/** Runs `callback` once the app is ready (now, if it already is). Returns an unsubscribe. */
export function onAppReady(callback: () => void): () => void {
  if (ready) {
    callback();
    return () => {};
  }
  readyWaiters.add(callback);
  return () => { readyWaiters.delete(callback); };
}

/** Resolves when the app is ready, or after `timeoutMs` so nothing can hang on it. */
export function whenAppReady(timeoutMs: number): Promise<void> {
  if (ready || timeoutMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); readyWaiters.delete(done); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    readyWaiters.add(done);
  });
}

// --- the reveal --------------------------------------------------------------

type Phase = "idle" | "covered" | "revealing";
let phase: Phase = "idle";
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** The opening film is covering the app; the reveal waits for it. */
export function coverForIntro(): void {
  phase = "covered";
}

/**
 * Resolve the interface: regions settle in with a small stagger, then the
 * attribute is removed so nothing stays animated. Idempotent per call.
 */
export function revealApp(kind: RevealKind): void {
  const element = root();
  clearTimeout(settleTimer);
  if (!element || prefersReducedMotion()) {
    phase = "idle";
    return;
  }
  phase = "revealing";
  element.dataset.reveal = kind;
  const settle = () => {
    settleTimer = setTimeout(() => {
      delete element.dataset.reveal;
      phase = "idle";
    }, kind === "promise" ? PRESENTATION_TIMING.promiseSettleMs : PRESENTATION_TIMING.settleMs);
  };
  // Settle only once content exists: a plain open (or an early skip) starts
  // before React mounts, and late regions must still finish their entrance.
  if (!ready) void whenAppReady(PRESENTATION_TIMING.readyHoldMs).then(settle);
  else settle();
}

/** Ends any covering or reveal immediately (film dismissed without a fade). */
export function endPresentation(): void {
  clearTimeout(settleTimer);
  delete root()?.dataset.reveal;
  phase = "idle";
}

/** True while the first screen is still covered or resolving (tabs skip their own entrance then). */
export function initialRevealInProgress(): boolean {
  return phase !== "idle";
}

// --- first visits to each tab ------------------------------------------------

const visited = new Set<string>();

/**
 * Whether this route's page should play its entrance: only on the first visit
 * this session, and not while the initial reveal already brings it in.
 * The decision is fixed for the whole visit (StrictMode-safe: pure reads during
 * render, the visit is recorded in a layout effect).
 */
export function usePageEntrance(route: string): boolean {
  const decision = useRef<{ route: string; enter: boolean } | null>(null);
  if (decision.current?.route !== route) {
    decision.current = { route, enter: !visited.has(route) && !initialRevealInProgress() && !prefersReducedMotion() };
  }
  useLayoutEffect(() => { visited.add(route); }, [route]);
  return decision.current.enter;
}

/** Test seam. */
export function resetPresentationForTests(): void {
  ready = false;
  readyWaiters.clear();
  visited.clear();
  endPresentation();
}
