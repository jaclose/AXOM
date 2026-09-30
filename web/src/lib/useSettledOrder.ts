import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** JD (Ideas 3): "do not move until 10 seconds after the user has supplied the tracker with as many clicks as they needed". */
export const SETTLE_AFTER_TOUCH_MS = 10_000;

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * Shows `desired` (already sorted the way the list *should* read) but keeps
 * the on-screen order frozen while the learner is interacting, so a card
 * never slides out from under the next tap. Call `touch()` on pointer or
 * keyboard activity; `settleMs` after the last touch the list re-sorts,
 * gliding via the View Transitions API where the browser has it.
 */
export function useSettledOrder<T>(desired: T[], keyOf: (item: T) => string, settleMs = SETTLE_AFTER_TOUCH_MS) {
  const [order, setOrder] = useState<string[]>(() => desired.map(keyOf));
  const orderRef = useRef(order);
  const lastTouch = useRef(0);
  const [settleTick, setSettleTick] = useState(0);

  const touch = useCallback(() => { lastTouch.current = Date.now(); }, []);

  useEffect(() => { orderRef.current = order; }, [order]);

  useEffect(() => {
    const desiredKeys = desired.map(keyOf);
    const sinceTouch = Date.now() - lastTouch.current;
    if (sinceTouch >= settleMs) {
      if (sameKeys(orderRef.current, desiredKeys)) return;
      const doc = document as TransitionDocument;
      const glide = typeof doc.startViewTransition === "function"
        && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (glide) doc.startViewTransition!(() => flushSync(() => setOrder(desiredKeys)));
      else setOrder(desiredKeys);
      return;
    }
    // While busy: drop removed items and append new ones, but move nothing.
    const present = new Set(desiredKeys);
    const kept = orderRef.current.filter((key) => present.has(key));
    const known = new Set(kept);
    const next = [...kept, ...desiredKeys.filter((key) => !known.has(key))];
    if (!sameKeys(orderRef.current, next)) setOrder(next);
    const timer = window.setTimeout(() => setSettleTick((tick) => tick + 1), settleMs - sinceTouch);
    return () => window.clearTimeout(timer);
  }, [desired, keyOf, settleMs, settleTick]);

  const byKey = new Map(desired.map((item) => [keyOf(item), item]));
  const shown = new Set(order);
  const ordered = [
    ...order.map((key) => byKey.get(key)).filter((item): item is T => item !== undefined),
    ...desired.filter((item) => !shown.has(keyOf(item))),
  ];
  return { ordered, touch };
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
