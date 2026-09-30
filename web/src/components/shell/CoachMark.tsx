// F4 coach-mark primitive: a ripple on one real element and a small bubble
// that points at it. Never modal, never steals focus, never covers the thing
// it points at. Dismissed by its buttons, Escape, using the target, or time.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeBubble, type BubblePlacement } from "./coachPlacement";
import "../../styles/coach.css";

export type CoachDismissReason = "done" | "primary" | "off" | "escape" | "target" | "timeout" | "gone";

export interface CoachMarkProps {
  target: Element;
  title: string;
  body: string;
  primaryLabel?: string;
  doneLabel?: string;
  /** Shows a quiet "No more hints" action. */
  offerOff?: boolean;
  /** Auto-dismiss after this long without hover or focus. */
  autoHideMs?: number;
  /** Delay before the bubble appears (the ripple starts at once). */
  enterDelayMs?: number;
  /** "right" keeps a sidebar target's bubble out of the nav. */
  prefer?: "vertical" | "right";
  onDismiss: (reason: CoachDismissReason) => void;
}

interface Box { top: number; left: number; width: number; height: number; radius: string }

function measure(target: Element): Box | null {
  if (!target.isConnected) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, radius: getComputedStyle(target).borderRadius || "12px" };
}

export function CoachMark({
  target, title, body, primaryLabel, doneLabel = "Got it", offerOff = false,
  autoHideMs = 9_000, enterDelayMs = 0, prefer = "vertical", onDismiss,
}: CoachMarkProps) {
  const [box, setBox] = useState<Box | null>(() => measure(target));
  const [placement, setPlacement] = useState<BubblePlacement | null>(null);
  const [bubbleIn, setBubbleIn] = useState(enterDelayMs === 0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef(false);
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => { dismissRef.current = onDismiss; });
  const titleId = useId();
  const bodyId = useId();

  // Follow the target through scrolling, resizing and layout shifts.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(target);
        if (!next) { dismissRef.current("gone"); return; }
        setBox((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next));
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [target]);

  useEffect(() => {
    if (bubbleIn) return;
    const timer = window.setTimeout(() => setBubbleIn(true), enterDelayMs);
    return () => window.clearTimeout(timer);
  }, [bubbleIn, enterDelayMs]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!box || !bubble) return;
    const surface = prefer === "vertical" ? target.closest(".surface")?.getBoundingClientRect() : undefined;
    const bounds = surface && surface.width > 0 ? { left: surface.left, right: surface.right } : undefined;
    setPlacement(placeBubble(box, { width: bubble.offsetWidth, height: bubble.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, prefer, bounds));
  }, [box, bubbleIn, prefer, target]);

  // Using the target is the best possible outcome: get out of the way.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => { if (event.target instanceof Node && target.contains(event.target)) dismissRef.current("target"); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismissRef.current("escape"); };
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [target]);

  useEffect(() => {
    if (!bubbleIn) return;
    let left = autoHideMs;
    const step = 250;
    const timer = window.setInterval(() => {
      if (holdRef.current || document.visibilityState !== "visible") return;
      left -= step;
      if (left <= 0) dismissRef.current("timeout");
    }, step);
    return () => window.clearInterval(timer);
  }, [autoHideMs, bubbleIn]);

  if (!box) return null;
  return createPortal(
    <>
      <div
        className="coach-ripple"
        aria-hidden="true"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height, borderRadius: box.radius }}
      />
      {bubbleIn && (
        <div
          ref={bubbleRef}
          className={`coach-bubble ${placement ? `is-${placement.side}` : "is-measuring"}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          style={placement ? { top: placement.top, left: placement.left, ["--arrow-x" as string]: `${placement.arrowX}px`, ["--arrow-y" as string]: `${placement.arrowY}px` } : undefined}
          onPointerEnter={() => { holdRef.current = true; }}
          onPointerLeave={() => { holdRef.current = false; }}
          onFocus={() => { holdRef.current = true; }}
          onBlur={() => { holdRef.current = false; }}
        >
          <b id={titleId}>{title}</b>
          <p id={bodyId}>{body}</p>
          <div className="coach-actions">
            {offerOff && <button type="button" className="coach-off" onClick={() => onDismiss("off")}>No more hints</button>}
            {primaryLabel && <button type="button" className="gbtn sm primary" onClick={() => onDismiss("primary")}>{primaryLabel}</button>}
            <button type="button" className={`gbtn sm ${primaryLabel ? "" : "primary"}`} onClick={() => onDismiss("done")}>{doneLabel}</button>
          </div>
        </div>
      )}
      {bubbleIn && <Announce text={`${title}. ${body}`} />}
    </>,
    document.body,
  );
}

/** Fills a polite live region a beat after it mounts, so screen readers hear it. */
function Announce({ text }: { text: string }) {
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSpoken(text), 150);
    return () => window.clearTimeout(timer);
  }, [text]);
  return <div className="sr-only" role="status">{spoken}</div>;
}
