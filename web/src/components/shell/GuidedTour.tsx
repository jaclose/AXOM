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

// Eight stops, most-used first (JD, Ideas 1: "no more than 8 guide items").
// Everything else has a small help button where it lives.
export const GUIDED_TOUR_STEPS: readonly TourStep[] = [
  {
    route: "dashboard",
    target: "command-brief",
    title: "Your day starts here",
    body: "Up next picks one next step from your real work, with a smaller option beside it. Nothing starts until you press Start.",
  },
  {
    route: "productivity",
    target: "pomodoro",
    title: "Focus timer",
    body: "Start a focus block here. Focused minutes are logged for you, and the timer follows you to every page in the dock at the bottom.",
  },
  {
    route: "dashboard",
    target: "nav-soundscapes",
    title: "Soundscapes",
    body: "Background sound for deep work: focus frequencies, nature, or your own files. It keeps playing while you move around AXOM.",
  },
  {
    route: "tracker",
    target: "import",
    title: "Course Tracker",
    body: "Your courses, modules and study passes in one map. Import a list or add items, then mark each pass as you study.",
  },
  {
    route: "questions",
    target: "question-bank-entry",
    title: "Question Bank",
    body: "Import → Review → Practice → Understand. Bring in question sets, practise them in tutor or exam mode, and let the results show you what needs work.",
  },
  {
    route: "dashboard",
    target: "requirements",
    title: "Today's targets",
    body: "Decide what makes today count. Timer minutes, questions and cards fill it in as you go.",
  },
  {
    route: "dashboard",
    target: "nav-journal",
    title: "Journal",
    body: "A few calm minutes at the end of the day. Over time it shows you how you are really doing, not just what you did.",
  },
  {
    route: "dashboard",
    target: "control-surface-menu",
    title: "Make AXOM yours",
    body: "Customize hides what you don't use. Anything hidden can come back later, so keep only what helps.",
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
  // Above/below is decided once per stop so the tip never flips while the
  // page settles from its smooth scroll.
  const [side, setSide] = useState<{ index: number; below: boolean } | null>(null);
  const routeRef = useRef<string | null>(null);
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

    // On the same page the previous rect is kept so the spotlight glides to
    // the next stop. Across pages it irises closed to the centre first, and
    // waits longer for the lazily loaded screen before giving up on a target.
    const changedPage = routeRef.current !== null && routeRef.current !== step.route;
    routeRef.current = step.route;
    setReady(false);
    if (!step.target || changedPage) setRect(null);
    if (!step.target) {
      setReady(true);
      return;
    }

    let cancelled = false;
    let scrolled = false;
    let found = false;
    let frame = 0;
    const measure = () => {
      frame = 0;
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
        if (!found) setSide({ index, below: window.innerHeight - nextRect.bottom > TIP_HEIGHT + 24 });
        found = true;
        setRect((current) => (current && sameRect(current, nextRect) ? current : nextRect));
        setReady(true);
      }
    };
    // Scroll and resize can fire many times per frame; measure once per frame.
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };

    measure();
    const start = Date.now();
    const interval = window.setInterval(() => {
      schedule();
      if (Date.now() - start > 2000) window.clearInterval(interval);
    }, 120);
    const grace = window.setTimeout(() => {
      if (cancelled) return;
      if (!found) setRect(null);
      setReady(true);
    }, changedPage ? 1800 : 750);
    window.addEventListener("resize", schedule, true);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.clearTimeout(grace);
      window.removeEventListener("resize", schedule, true);
      window.removeEventListener("scroll", schedule, true);
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
  // Always positioned by top/left (never a transform) so centre-to-target is
  // one continuous glide.
  const tooltip = hasSpotlight ? tooltipStyle(rect!, side?.index === index ? side.below : true) : centeredTip();

  const overlay = (
    <div className="tour-overlay">
      <div className={`tour-spot ${hasSpotlight ? "" : "is-center"}`} style={hasSpotlight ? spotStyle(rect!) : centerSpot()} aria-hidden="true" />

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

const TIP_WIDTH = 340;
const TIP_HEIGHT = 230;

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1
    && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/** One cut-out whose box-shadow dims the page; it glides between stops. */
function spotStyle(rect: DOMRect): React.CSSProperties {
  const top = clamp(rect.top - PAD, 0, window.innerHeight);
  const left = clamp(rect.left - PAD, 0, window.innerWidth);
  const right = clamp(rect.right + PAD, left, window.innerWidth);
  const bottom = clamp(rect.bottom + PAD, top, window.innerHeight);
  return { top, left, width: right - left, height: bottom - top };
}

/** No target: the cut-out closes to the centre, leaving an even dim. */
function centerSpot(): React.CSSProperties {
  return { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };
}

function centeredTip(): React.CSSProperties {
  const width = Math.min(TIP_WIDTH, window.innerWidth - 24);
  return { top: Math.max(12, (window.innerHeight - TIP_HEIGHT) / 2), left: Math.max(12, (window.innerWidth - width) / 2) };
}

function tooltipStyle(rect: DOMRect, below: boolean): React.CSSProperties {
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - TIP_WIDTH - 12);
  let top = below ? rect.bottom + 14 : rect.top - 14 - TIP_HEIGHT;
  top = Math.min(Math.max(12, top), window.innerHeight - TIP_HEIGHT - 12);
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
