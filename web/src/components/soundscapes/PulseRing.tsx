import type { CSSProperties } from "react";

/**
 * A glowing ring that draws itself in, breathes, drifts and fades, then
 * returns somewhere nearby (after the Sleeptube-style reference). One cycle
 * is ~12 s — far below flash rates — and reduced motion shows it still.
 */
export function PulseRing({ tint = "rgb(var(--accent-rgb))", active = true, size = 46, className = "" }: {
  tint?: string;
  active?: boolean;
  /** Diameter as a % of the stage's shorter side. */
  size?: number;
  className?: string;
}) {
  return (
    <div className={`pulse-ring ${active ? "active" : ""} ${className}`} style={{ "--ring-tint": tint, "--ring-size": `${size}` } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle className="pulse-ring-halo" cx="50" cy="50" r="40" />
        <circle className="pulse-ring-glow" cx="50" cy="50" r="40" />
        <circle className="pulse-ring-line" cx="50" cy="50" r="40" pathLength={100} />
      </svg>
    </div>
  );
}
