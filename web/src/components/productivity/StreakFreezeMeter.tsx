import { Shield } from "lucide-react";
import { STARTER_STREAK_FREEZES } from "../../lib/streakFreeze";
import "../../styles/study-streaks.css";

/** Two quiet shield slots and a short earned-day path to the next refill. */
export function StreakFreezeMeter({ available, progress, label }: { available: number; progress: number; label: string }) {
  const left = Math.max(0, Math.min(STARTER_STREAK_FREEZES, available));
  const earned = Math.max(0, Math.min(1, progress));
  const refillCopy = left === STARTER_STREAK_FREEZES
    ? "Ready when needed"
    : earned === 1 ? "1 more earned day refills one" : "2 earned days refill one";
  return <div className="streak-freeze-meter" role="group" aria-label={`${label}: ${left} of ${STARTER_STREAK_FREEZES} freezes ready. ${refillCopy}.`}>
    <span className="streak-freeze-meter__shields" aria-hidden="true">
      {Array.from({ length: STARTER_STREAK_FREEZES }, (_, index) => <Shield key={index} className={index < left ? "is-ready" : ""} size={17} fill={index < left ? "currentColor" : "none"} />)}
    </span>
    <span className="streak-freeze-meter__copy"><b>{left}/{STARTER_STREAK_FREEZES} freezes</b><small>{refillCopy}</small></span>
    {left < STARTER_STREAK_FREEZES && <span className="streak-freeze-meter__progress" aria-hidden="true"><i className={earned ? "is-earned" : ""} /><i /></span>}
  </div>;
}
