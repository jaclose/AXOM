import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { prefersReducedMotion } from "../../lib/motion";
import {
  clearTourProgress,
  readTourStep,
  writeTourStep,
} from "../../lib/onboardingProgress";
import { ICON_SIZE } from "../../lib/iconSize";

export interface TourStep {
  route: string;
  target?: string;
  title: string;
  body: string;
}

export type TourExitReason = "complete" | "skip" | "escape";

export const GUIDED_TOUR_STEPS: readonly TourStep[] = [
  {
    route: "dashboard",
    target: "command-brief",
    title: "Up next",
    body: "Up next suggests one step from your real work, with a smaller option beside it. It appears once you have added something, and nothing starts until you press Start.",
  },
  {
    route: "tracker",
    target: "import",
    title: "Course Tracker",
    body: "Map courses, modules, and study passes here. Import a list or add work manually, then keep the map current as you study.",
  },
  {
    route: "questions",
    target: "question-bank-entry",
    title: "Question Bank",
    body: "Import → Review → Practice → Understand. Bring in a source, verify uncertain mappings, practise the finalized set, and let the results surface what needs work.",
  },
  {
    route: "dashboard",
    target: "recommendation-provenance",
    title: "Why AXOM suggested this",
    body: "Press Why? on Up next to see what led to a suggestion: the items, signals and how much each counted, plus the override you can change. AXOM calculations remain separate from optional AI wording.",
  },
  {
    route: "reports",
    target: "reports-top",
    title: "Reports",
    body: "Use reports to review today, the week, course distribution, and longer trends from the work you recorded.",
  },
  {
    route: "dashboard",
    target: "control-surface-menu",
    title: "Customize",
    body: "Use Customize to keep current workflows visible and return unused sections to the library. You can restore them at any time.",
  },
  {
    route: "dashboard",
    title: "Data safety",
    body: "Your workspace stays on this device. Open Settings → Data and Backup to review storage health, local recovery snapshots, or export a portable backup.",
  },
] as const;

const PAD = 8;

export function GuidedTour({
  onExit, onNavigate, currentRoute,
  steps = GUIDED_TOUR_STEPS,
  persistProgress = true,
  targetAttribute = "data-tour",
  skipLabel = "Skip guided tour",
  progressLabel = "Guided tour progress",
  restoreScrollOnExit = false,
}: {
  onExit: (reason: TourExitReason) => void;
  onNavigate: (route: string) => void;
  currentRoute: string;
  steps?: readonly TourStep[];
  persistProgress?: boolean;
  targetAttribute?: "data-tour" | "data-module-tour";
  skipLabel?: string;
  progressLabel?: string;
  restoreScrollOnExit?: boolean;
}) {
  const [index, setIndex] = useState(() => persistProgress ? readTourStep(steps.length) : 0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef(onExit);
  const navigateRef = useRef(onNavigate);
  const scrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = steps[index] ?? steps[0];

  useEffect(() => { exitRef.current = onExit; }, [onExit]);
  useEffect(() => { navigateRef.current = onNavigate; }, [onNavigate]);
  useLayoutEffect(() => {
    if (!restoreScrollOnExit) return;
    const snapshot = captureScrollSnapshot();
    scrollSnapshotRef.current = snapshot;
    return () => {
      restoreScrollSnapshot(snapshot);
      if (scrollSnapshotRef.current === snapshot) scrollSnapshotRef.current = null;
    };
  }, [restoreScrollOnExit]);
  useEffect(() => {
    if (persistProgress) writeTourStep(index);
  }, [index, persistProgress]);

  const exitTour = useCallback((reason: TourExitReason) => {
    if (persistProgress) clearTourProgress();
    if (restoreScrollOnExit && scrollSnapshotRef.current) {
      restoreScrollSnapshot(scrollSnapshotRef.current);
    }
    exitRef.current(reason);
  }, [persistProgress, restoreScrollOnExit]);

  useEffect(() => {
    if (currentRoute !== step.route) {
      navigateRef.current(step.route);
      return;
    }

    setReady(false);
    setRect(null);
    if (!step.target) {
      setReady(true);
      return;
    }

    let cancelled = false;
    let scrolled = false;
    const tick = () => {
      if (cancelled) return;
      const element = document.querySelector(`[${targetAttribute}="${step.target}"]`) as HTMLElement | null;
      if (!element) return;
      if (!scrolled) {
        revealTarget(
          element,
          prefersReducedMotion() ? "auto" : "smooth",
          restoreScrollOnExit ? scrollSnapshotRef.current : null,
        );
        scrolled = true;
      }
      const nextRect = element.getBoundingClientRect();
      if (nextRect.height > 0) {
        setRect(nextRect);
        setReady(true);
      }
    };

    tick();
    const start = Date.now();
    const interval = window.setInterval(() => {
      tick();
      if (Date.now() - start > 2000) window.clearInterval(interval);
    }, 90);
    const grace = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 750);
    const onMove = () => tick();
    window.addEventListener("resize", onMove, true);
    window.addEventListener("scroll", onMove, true);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(grace);
      window.removeEventListener("resize", onMove, true);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [currentRoute, index, restoreScrollOnExit, step.route, step.target, targetAttribute]);

  useEffect(() => {
    tipRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (event.key === "Escape") {
        event.preventDefault();
        exitTour("escape");
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(tip);
      if (focusable.length === 0) {
        event.preventDefault();
        tip.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !tip.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [exitTour]);

  function next() {
    if (index < steps.length - 1) setIndex(index + 1);
    else exitTour("complete");
  }

  function back() {
    if (index > 0) setIndex(index - 1);
  }

  const onScreen = !!rect && rect.bottom > 48 && rect.top < window.innerHeight - 48 && rect.height > 0;
  const hasSpotlight = ready && onScreen;
  const tooltip = tooltipStyle(rect);

  const overlay = (
    <div className="tour-overlay">
      {hasSpotlight ? <Spotlight rect={rect!} /> : <div className="tour-haze" aria-hidden="true" />}
      {hasSpotlight && <div className="tour-ring" style={ringStyle(rect!)} aria-hidden="true" />}

      <div
        ref={tipRef}
        className={`tour-tip ${hasSpotlight ? "" : "centered"}`}
        style={tooltip}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <div className="tour-tip-head">
          <span className="tour-step-badge"><Sparkles size={ICON_SIZE.microInline} aria-hidden="true" /> {index + 1} / {steps.length}</span>
          <button type="button" className="tour-skip" onClick={() => exitTour("skip")} aria-label={skipLabel}>
            Skip <X size={ICON_SIZE.body} aria-hidden="true" />
          </button>
        </div>
        <div className="tour-tip-title" id={titleId}>{step.title}</div>
        <div className="tour-tip-body" id={bodyId}>{step.body}</div>
        <div className="tour-tip-actions">
          {index > 0
            ? <button type="button" className="gbtn sm" onClick={back}><ArrowLeft size={ICON_SIZE.body} /> Back</button>
            : <span aria-hidden="true" />}
          <button type="button" className="gbtn sm primary" onClick={next}>
            {index === steps.length - 1 ? "Finish" : "Next"} <ArrowRight size={ICON_SIZE.body} />
          </button>
        </div>
        <div
          className="tour-progress"
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
        >
          <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );

  // Module tours are rendered from inside a scrolling page. Portalling the
  // fixed overlay keeps it rooted to the viewport instead of any transformed
  // or clipped page ancestor, and React removes the portal on every exit path.
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}

function Spotlight({ rect }: { rect: DOMRect }) {
  const top = clamp(rect.top - PAD, 0, window.innerHeight);
  const left = clamp(rect.left - PAD, 0, window.innerWidth);
  const right = clamp(rect.right + PAD, left, window.innerWidth);
  const bottom = clamp(rect.bottom + PAD, top, window.innerHeight);
  return (
    <>
      <div className="tour-panel" style={{ top: 0, left: 0, right: 0, height: top }} aria-hidden="true" />
      <div className="tour-panel" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} aria-hidden="true" />
      <div className="tour-panel" style={{ top, left: 0, width: left, height: bottom - top }} aria-hidden="true" />
      <div className="tour-panel" style={{ top, left: right, right: 0, height: bottom - top }} aria-hidden="true" />
    </>
  );
}

function ringStyle(rect: DOMRect): React.CSSProperties {
  const top = clamp(rect.top - PAD, 0, window.innerHeight);
  const left = clamp(rect.left - PAD, 0, window.innerWidth);
  const right = clamp(rect.right + PAD, left, window.innerWidth);
  const bottom = clamp(rect.bottom + PAD, top, window.innerHeight);
  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function tooltipStyle(rect: DOMRect | null): React.CSSProperties {
  const onScreen = !!rect && rect.bottom > 48 && rect.top < window.innerHeight - 48;
  if (!rect || !onScreen) return {};
  const tipWidth = 340;
  const tipHeight = 230;
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - tipWidth - 12);
  const roomBelow = window.innerHeight - rect.bottom > tipHeight + 24;
  let top = roomBelow ? rect.bottom + 14 : rect.top - 14 - tipHeight;
  top = Math.min(Math.max(12, top), window.innerHeight - tipHeight - 12);
  return { top, left };
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

interface ScrollPosition {
  left: number;
  top: number;
}

interface ScrollSnapshot {
  elements: Map<Element, ScrollPosition>;
  window: ScrollPosition;
}

function captureScrollSnapshot(): ScrollSnapshot {
  const elements = new Map<Element, ScrollPosition>();
  const remember = (element: Element | null) => {
    if (!element || elements.has(element)) return;
    elements.set(element, {
      left: (element as HTMLElement).scrollLeft,
      top: (element as HTMLElement).scrollTop,
    });
  };
  remember(document.scrollingElement);
  document.querySelectorAll(".surface-scroll").forEach(remember);
  return {
    elements,
    window: { left: window.scrollX, top: window.scrollY },
  };
}

function rememberScrollableAncestors(element: HTMLElement, snapshot: ScrollSnapshot | null) {
  if (!snapshot) return;
  let ancestor = element.parentElement;
  while (ancestor) {
    if (isScrollContainer(ancestor) && !snapshot.elements.has(ancestor)) {
      snapshot.elements.set(ancestor, { left: ancestor.scrollLeft, top: ancestor.scrollTop });
    }
    ancestor = ancestor.parentElement;
  }
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot) {
  snapshot.elements.forEach((position, element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return;
    // Assigning the offsets cancels any pending smooth scroll before restoring
    // the exact position, without introducing body/document style mutations.
    element.scrollLeft = position.left;
    element.scrollTop = position.top;
  });
  if (window.scrollX !== snapshot.window.left || window.scrollY !== snapshot.window.top) {
    window.scrollTo({ left: snapshot.window.left, top: snapshot.window.top, behavior: "auto" });
  }
}

function revealTarget(element: HTMLElement, behavior: ScrollBehavior, snapshot: ScrollSnapshot | null) {
  rememberScrollableAncestors(element, snapshot);
  const owner = nearestScrollContainer(element);
  if (!owner) {
    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior });
    return;
  }

  const ownerRect = owner.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  const centeredTop = owner.scrollTop
    + targetRect.top - ownerRect.top
    - Math.max(0, (owner.clientHeight - targetRect.height) / 2);
  const maxTop = Math.max(0, owner.scrollHeight - owner.clientHeight);
  owner.scrollTo({
    top: clamp(centeredTop, 0, maxTop),
    left: owner.scrollLeft,
    behavior,
  });
}

function nearestScrollContainer(element: HTMLElement): HTMLElement | null {
  let ancestor = element.parentElement;
  while (ancestor) {
    if (isScrollContainer(ancestor)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function isScrollContainer(element: HTMLElement): boolean {
  if (element.classList.contains("surface-scroll")) return true;
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
