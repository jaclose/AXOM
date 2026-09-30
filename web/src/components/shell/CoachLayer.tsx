// Runs the coach marks (lib/coach.ts): "Overwhelmed?" once, after the guide
// and the Promise, then at most one first-visit hint per page. It waits for
// every other first-run layer, any dialog, a running focus sprint and an
// active text field, so it never talks over the learner.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COACH_RESET_EVENT, CUSTOMIZE_SIDEBAR_EVENT, HINT_DWELL_MS, HINT_PAGE_SETTLE_MS, OVERWHELMED_AFTER_MS, OVERWHELMED_ID,
  eligiblePageHint, markCoachShown, overwhelmedDue, readCoachLedger, writeCoachLedger,
  type CoachLedger, type PageHint,
} from "../../lib/coach";
import { readGuideOffer } from "../../lib/guideOffer";
import { shellBusy } from "../../lib/shellBusy";
import { usePomodoro } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { CoachMark, type CoachDismissReason } from "./CoachMark";


function onScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight;
}

type Active = { kind: "overwhelmed" } | { kind: "hint"; hint: PageHint; target: Element; route: string };

export function CoachLayer({ route, suspended }: { route: string; suspended: boolean }) {
  const onboarded = useStore((s) => s.profile.onboarded);
  const tourDone = useStore((s) => s.profile.tourDone);
  const [ledger, setLedger] = useState<CoachLedger>(readCoachLedger);
  const [active, setActive] = useState<Active | null>(null);
  const elapsedRef = useRef(0);
  const routeEnteredRef = useRef(Date.now());
  const shownOnRouteRef = useRef(false);
  const ready = Boolean(onboarded && tourDone) && !suspended;

  const commit = useCallback((next: CoachLedger) => { writeCoachLedger(next); setLedger(next); }, []);

  useEffect(() => {
    const onReset = () => setLedger(readCoachLedger());
    window.addEventListener(COACH_RESET_EVENT, onReset);
    return () => window.removeEventListener(COACH_RESET_EVENT, onReset);
  }, []);

  useEffect(() => {
    routeEnteredRef.current = Date.now();
    shownOnRouteRef.current = false;
  }, [route]);

  // "Overwhelmed?": 90 s of unobstructed, visible time after everything else settles.
  useEffect(() => {
    if (!ready || active || !overwhelmedDue(ledger, Date.now())) return;
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible" || readGuideOffer() === "pending" || usePomodoro.getState().running || shellBusy()) return;
      elapsedRef.current += 1_000;
      if (elapsedRef.current < OVERWHELMED_AFTER_MS) return;
      commit(markCoachShown(readCoachLedger(), OVERWHELMED_ID, Date.now()));
      setActive({ kind: "overwhelmed" });
    }, 1_000);
    return () => window.clearInterval(tick);
  }, [ready, active, ledger, commit]);

  // One first-visit hint per page, once its target has been on screen a moment.
  useEffect(() => {
    if (!ready || active || typeof IntersectionObserver === "undefined") return;
    const hint = eligiblePageHint(route, ledger, Date.now());
    if (!hint) return;
    let target: Element | null = null;
    let visibleSince: number | null = null;
    let observer: IntersectionObserver | null = null;
    const tick = window.setInterval(() => {
      const found = document.querySelector(hint.target);
      if (found !== target) {
        observer?.disconnect();
        target = found;
        visibleSince = null;
        if (found) {
          observer = new IntersectionObserver(([entry]) => {
            visibleSince = entry.intersectionRatio >= 0.6 ? (visibleSince ?? Date.now()) : null;
          }, { threshold: [0, 0.6, 1] });
          observer.observe(found);
        }
      }
      const now = Date.now();
      if (!target || visibleSince === null || shownOnRouteRef.current) return;
      if (now - routeEnteredRef.current < HINT_PAGE_SETTLE_MS || now - visibleSince < HINT_DWELL_MS) return;
      if (document.visibilityState !== "visible" || shellBusy() || !onScreen(target) || hint.done?.()) return;
      shownOnRouteRef.current = true;
      commit(markCoachShown(readCoachLedger(), hint.id, Date.now()));
      setActive({ kind: "hint", hint, target, route });
    }, 250);
    return () => { window.clearInterval(tick); observer?.disconnect(); };
  }, [route, ready, active, ledger, commit]);

  // A hint belongs to its page; so does a dialog that covers it.
  const activeRoute = active?.kind === "hint" ? active.route : null;
  useEffect(() => {
    if (activeRoute && (activeRoute !== route || suspended)) setActive(null);
  }, [activeRoute, route, suspended]);

  if (!active) return null;
  if (active.kind === "overwhelmed") return <OverwhelmedMoment onDone={() => setActive(null)} />;
  return (
    <CoachMark
      key={active.hint.id}
      target={active.target}
      title={active.hint.title}
      body={active.hint.body}
      offerOff
      onDismiss={(reason: CoachDismissReason) => {
        if (reason === "off") commit({ ...readCoachLedger(), off: true });
        setActive(null);
      }}
    />
  );
}

function customizeTarget(): { element: Element; inDrawer: boolean } | null {
  const customize = document.querySelector(".nav-manage-btn");
  if (customize && onScreen(customize)) return { element: customize, inDrawer: false };
  const menu = document.querySelector(".menu-btn");
  return menu && onScreen(menu) ? { element: menu, inDrawer: true } : null;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "word" | "leaving" | "mark";

/**
 * JD (Ideas 1): "say Overwhelmed? in the middle of the screen, then it
 * disappears and point an arrow at Customize in the top left with a ripple."
 */
const ARROW_DRAW_MS = 700;

function OverwhelmedMoment({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("word");
  const [arrowGone, setArrowGone] = useState(false);
  const [target] = useState(customizeTarget);
  const [still] = useState(reducedMotion);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });
  const arrowLifeMs = still ? 1_200 : ARROW_DRAW_MS + 900;

  useEffect(() => {
    if (!target) { doneRef.current(); return; }
    const hold = still ? 1_600 : 2_000;
    const draw = still ? 0 : ARROW_DRAW_MS;
    const timers = [
      window.setTimeout(() => setPhase("leaving"), hold),
      window.setTimeout(() => setPhase("mark"), hold + draw),
      window.setTimeout(() => setArrowGone(true), hold + arrowLifeMs),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [target, still, arrowLifeMs]);

  if (!target) return null;
  const openCustomize = () => {
    if (target.inDrawer) (target.element as HTMLElement).click();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(CUSTOMIZE_SIDEBAR_EVENT)), target.inDrawer ? 320 : 0);
  };
  return (
    <>
      {phase !== "mark" && createPortal(
        <>
          <div className={`coach-overwhelmed-haze ${phase === "leaving" ? "is-leaving" : ""}`} aria-hidden="true" />
          <p className={`coach-overwhelmed-word ${phase === "leaving" ? "is-leaving" : ""}`} aria-hidden="true">Overwhelmed?</p>
        </>,
        document.body,
      )}
      {phase !== "word" && !arrowGone && <CoachArrow to={target.element} fadeAtMs={arrowLifeMs - 500} />}
      {phase === "mark" && (
        <CoachMark
          target={target.element}
          title="Make AXOM yours"
          body={target.inDrawer
            ? "Open the menu and tap Customize. Hide what you don't use; nothing is deleted."
            : "Hide what you don't use and drag the rest into your order. Nothing is deleted."}
          primaryLabel="Show me"
          doneLabel="I'm good"
          autoHideMs={14_000}
          prefer={target.inDrawer ? "vertical" : "right"}
          enterDelayMs={still ? 700 : arrowLifeMs - ARROW_DRAW_MS}
          onDismiss={(reason) => {
            if (reason === "primary") openCustomize();
            doneRef.current();
          }}
        />
      )}
    </>
  );
}

/** A hand-drawn swoop from the middle of the screen to the target's right edge. */
function CoachArrow({ to, fadeAtMs }: { to: Element; fadeAtMs: number }) {
  const [geometry] = useState(() => {
    const rect = to.getBoundingClientRect();
    const sx = window.innerWidth / 2;
    const sy = window.innerHeight / 2 + 44;
    const ex = rect.right + 12;
    const ey = rect.top + rect.height / 2;
    const c1 = [sx, sy - (sy - ey) * 0.55];
    const c2 = [ex + (sx - ex) * 0.45, ey];
    // Arrowhead aimed along the curve's final direction (c2 -> end).
    const angle = Math.atan2(ey - c2[1], ex - c2[0]);
    const back = (dist: number, spread: number) => [
      ex - Math.cos(angle) * dist - Math.sin(angle) * spread,
      ey - Math.sin(angle) * dist + Math.cos(angle) * spread,
    ].map((n) => n.toFixed(1)).join(",");
    return {
      d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1.map((n) => n.toFixed(1)).join(" ")} ${c2.map((n) => n.toFixed(1)).join(" ")} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      head: `${ex.toFixed(1)},${ey.toFixed(1)} ${back(11, 5.5)} ${back(11, -5.5)}`,
    };
  });
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLeaving(true), fadeAtMs);
    return () => window.clearTimeout(timer);
  }, [fadeAtMs]);
  return createPortal(
    <svg className={`coach-arrow ${leaving ? "is-leaving" : ""}`} aria-hidden="true">
      <path d={geometry.d} pathLength={1} />
      <polygon className="coach-arrow-head" points={geometry.head} />
    </svg>,
    document.body,
  );
}
