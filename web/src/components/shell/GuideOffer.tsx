// Offers the 8-stop guide after the Promise flow settles (JD, Ideas 3: "the
// tutorial should be suggested after signing the contract ... after scrolling
// for a little bit the guide will be suggested"). "Later" re-offers once,
// after the learner has scrolled a while; a second "Later" leaves it in Help.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Compass, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { afterLater, GUIDE_REOFFER_SCROLL_PX, readGuideOffer, writeGuideOffer, type GuideOfferState } from "../../lib/guideOffer";

/** Pause after the Promise closes so the offer never stacks on its exit. */
const SETTLE_MS = 1400;

export function GuideOffer({ active, onStart }: { active: boolean; onStart: () => void }) {
  const [state, setState] = useState<GuideOfferState>(readGuideOffer);
  const [visible, setVisible] = useState(false);
  const titleId = useId();

  // First offer: shortly after the shell is free of other first-run layers.
  useEffect(() => {
    if (!active || state !== "pending") return;
    const timer = window.setTimeout(() => setVisible(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, state]);

  // Second offer: only after some real scrolling since "Later".
  useEffect(() => {
    if (!active || state !== "snoozed" || visible) return;
    let travelled = 0;
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const previous = last.get(target) ?? target.scrollTop;
      travelled += Math.abs(target.scrollTop - previous);
      last.set(target, target.scrollTop);
      if (travelled >= GUIDE_REOFFER_SCROLL_PX) setVisible(true);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [active, state, visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") later(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function later() {
    const next = afterLater(state);
    writeGuideOffer(next);
    setState(next);
    setVisible(false);
  }

  function start() {
    writeGuideOffer("taken");
    setState("taken");
    setVisible(false);
    onStart();
  }

  if (!visible || !active) return null;
  return createPortal(
    <div className="guide-offer" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <span className="guide-offer-icon" aria-hidden="true"><Compass size={ICON_SIZE.emphasis} /></span>
      <div className="guide-offer-copy">
        <b id={titleId}>Want a 60-second tour?</b>
        <span>Eight quick stops through the parts of AXOM you will use most.</span>
      </div>
      <div className="guide-offer-actions">
        <button type="button" className="gbtn sm primary" onClick={start}>Take the tour</button>
        <button type="button" className="gbtn sm" onClick={later}>Later</button>
      </div>
      <button type="button" className="guide-offer-close" onClick={later} aria-label="Not now">
        <X size={ICON_SIZE.body} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
