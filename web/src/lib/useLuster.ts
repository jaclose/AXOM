import { useCallback, type PointerEvent } from "react";
import { prefersReducedMotion } from "./motion";

/** Max tilt in degrees — enough to feel physical, never enough to distract. */
const MAX_TILT = 1.6;

/**
 * Pointer-follow luster for dashboard cards: a soft glare that tracks the
 * cursor, a sheen sweep the first time a card is hovered (quieter after), and
 * a very small 3D lift. Attach
 * the returned handlers to a container; any descendant with `data-luster`
 * reacts. Touch/pen input and reduced motion (OS or AXOM setting) opt out.
 */
export function useLuster() {
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || prefersReducedMotion()) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-luster]");
    const container = event.currentTarget;
    container.querySelectorAll<HTMLElement>("[data-luster].is-lustering").forEach((element) => {
      if (element !== target) reset(element);
    });
    if (!target || !container.contains(target)) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    target.style.setProperty("--lx", `${(x * 100).toFixed(1)}%`);
    target.style.setProperty("--ly", `${(y * 100).toFixed(1)}%`);
    target.style.setProperty("--ry", `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
    target.style.setProperty("--rx", `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`);
    target.classList.add("is-lustering");
  }, []);

  const onPointerLeave = useCallback((event: PointerEvent<HTMLElement>) => {
    event.currentTarget.querySelectorAll<HTMLElement>("[data-luster].is-lustering").forEach(reset);
  }, []);

  return { onPointerMove, onPointerLeave };
}

function reset(element: HTMLElement) {
  // I1-15: the first hover gets the full sweep; after that the card answers
  // with a quieter glare (motion.css keys off data-luster-seen).
  if (element.classList.contains("is-lustering")) element.dataset.lusterSeen = "";
  element.classList.remove("is-lustering");
  element.style.setProperty("--rx", "0deg");
  element.style.setProperty("--ry", "0deg");
}
