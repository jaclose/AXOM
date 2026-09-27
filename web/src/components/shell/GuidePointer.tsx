// ===========================================================================
// The Guide's pointer: rings the real control and explains it, without the
// guided tour's modal veil, so the learner clicks the control itself and the
// guide moves on (a tab switch can reveal the next step's target). It opens
// each step's page once; if the learner navigates away, the guide ends.
// ===========================================================================
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Compass, X } from "lucide-react";
import type { GuideStep } from "../../lib/guide/topics";
import { prefersReducedMotion } from "../../lib/motion";
import { ICON_SIZE } from "../../lib/iconSize";

const FIND_TIMEOUT_MS = 2500;
const PAD = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The anchor for a step (data-guide, or an existing data-tour), preferring a visible one. */
export function findGuideTarget(target: string): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-guide="${target}"], [data-tour="${target}"]`)];
  return candidates.find((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }) ?? candidates[0] ?? null;
}

function focusable(element: HTMLElement): boolean {
  return element.matches('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
}

export function GuidePointer({ steps, currentRoute, onNavigate, onExit }: {
  steps: readonly GuideStep[];
  currentRoute: string;
  onNavigate: (route: string) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const titleId = useId();
  const step = steps[index] ?? steps[0];
  const last = index >= steps.length - 1;
  const onRoute = currentRoute.split("?")[0] === step.route;

  const exitRef = useRef(onExit);
  const navigateRef = useRef(onNavigate);
  useEffect(() => { exitRef.current = onExit; }, [onExit]);
  useEffect(() => { navigateRef.current = onNavigate; }, [onNavigate]);

  const advance = useCallback(() => {
    if (last) exitRef.current();
    else setIndex(index + 1);
  }, [index, last]);
  const advanceRef = useRef(advance);
  useEffect(() => { advanceRef.current = advance; }, [advance]);

  // Open the step's page once. Leaving it afterwards means the learner chose
  // to go elsewhere, so the guide gets out of the way instead of pulling back.
  const arrivedRef = useRef(false);
  useEffect(() => {
    arrivedRef.current = false;
  }, [index]);
  useEffect(() => {
    if (onRoute) {
      arrivedRef.current = true;
      return;
    }
    if (arrivedRef.current) exitRef.current();
    else navigateRef.current(step.route);
  }, [index, onRoute, step.route]);

  // Follow the target while it scrolls, re-renders or appears late.
  useEffect(() => {
    setBox(null);
    setMissing(false);
    if (!onRoute || !step.target) return;
    const target = step.target;
    const started = Date.now();
    let element: HTMLElement | null = null;
    let revealed = false;
    const measure = () => {
      if (!element?.isConnected) element = findGuideTarget(target);
      if (!element) {
        if (Date.now() - started > FIND_TIMEOUT_MS) setMissing(true);
        return;
      }
      setMissing(false);
      if (!revealed) {
        revealed = true;
        element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        // Keyboard users can press Enter on the control the guide names.
        if (focusable(element)) element.focus({ preventScroll: true });
      }
      const rect = element.getBoundingClientRect();
      setBox((previous) => previous && previous.top === rect.top && previous.left === rect.left && previous.width === rect.width && previous.height === rect.height
        ? previous
        : { top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    measure();
    const interval = window.setInterval(measure, 120);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, onRoute, step.target]);

  // Clicking the highlighted control continues, after the control handles it.
  useEffect(() => {
    if (!onRoute || !step.target) return;
    const target = step.target;
    const onClick = (event: MouseEvent) => {
      const element = findGuideTarget(target);
      if (element && event.target instanceof Node && element.contains(event.target)) {
        window.setTimeout(() => advanceRef.current(), 0);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [index, onRoute, step.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An open modal owns Escape; the guide ends only when none is open.
      if (event.key !== "Escape" || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      exitRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pointing = Boolean(box && step.target && !missing);
  const pointer = (
    <div className="guide-pointer">
      {pointing && <div className="guide-ring" style={ringStyle(box!)} aria-hidden="true" />}
      <div
        className={`guide-callout ${pointing ? "" : "floating"}`}
        style={pointing ? calloutStyle(box!) : undefined}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
      >
        <div className="guide-callout-head">
          <span className="guide-callout-step">
            <Compass size={ICON_SIZE.microInline} aria-hidden="true" /> Guide{steps.length > 1 ? ` · ${index + 1} of ${steps.length}` : ""}
          </span>
          <button type="button" className="guide-callout-close" onClick={() => exitRef.current()} aria-label="Stop the guide">
            <X size={ICON_SIZE.body} aria-hidden="true" />
          </button>
        </div>
        <div aria-live="polite">
          <div className="guide-callout-title" id={titleId}>{step.title}</div>
          <div className="guide-callout-body">
            {missing ? `This isn't on screen right now. ${step.body}` : step.body}
          </div>
        </div>
        <div className="guide-callout-actions">
          {pointing && <span className="guide-callout-hint">Click the highlighted control to continue.</span>}
          <button type="button" className="gbtn sm primary" onClick={() => advanceRef.current()}>
            {last ? "Done" : <>Next <ArrowRight size={ICON_SIZE.body} aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(pointer, document.body);
}

function ringStyle(box: Box): React.CSSProperties {
  return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
}

function calloutStyle(box: Box): React.CSSProperties {
  const width = Math.min(320, window.innerWidth - 24);
  const height = 190;
  const left = Math.min(Math.max(12, box.left), window.innerWidth - width - 12);
  const below = box.top + box.height + PAD + 12;
  const preferred = below + height < window.innerHeight ? below : box.top - PAD - 12 - height;
  const top = Math.min(Math.max(12, preferred), Math.max(12, window.innerHeight - height - 12));
  return { top, left, width };
}
