// True while something else has the learner's attention: a dialog, the tour,
// the guide offer, the Promise, or a text field they are typing in. Optional
// nudges (coach marks, game check-ins) wait for this to clear.
const BUSY_SELECTOR = ".modal-scrim, [aria-modal=\"true\"], .guide-offer, .save-progress, .tour-spot, .tour-tip, .promise-stage, .coach-bubble, .coach-overwhelmed-word, .game-checkin, .focus-checkin, .rest-overlay";

export function shellBusy(except?: Element | null): boolean {
  const layer = [...document.querySelectorAll(BUSY_SELECTOR)].find((node) => !except?.contains(node));
  if (layer) return true;
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}
