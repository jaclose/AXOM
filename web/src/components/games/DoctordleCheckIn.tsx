// "Did you get it?" after the learner comes back from doctordle.org (JD,
// Ideas 3). Non-modal, top of the screen, one tap to answer; AXOM only knows
// what the learner tells it, so the copy never pretends otherwise.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Flame, Stethoscope, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { doctordleCaseNumber, doctordleStreak, shouldAskResult, useDoctordle, type DoctordleResult } from "../../lib/doctordle";
import { shellBusy } from "../../lib/shellBusy";
import { compactCountdown, msUntilDoctordle } from "../shell/DailyGameNavMeta";
import "../../styles/checkin.css";

const CHECK_EVERY_MS = 5_000;
const LATER_MS = 20 * 60_000;
const THANKS_MS = 2_600;

export function DoctordleCheckIn({ suspended }: { suspended: boolean }) {
  const [open, setOpen] = useState(false);
  const [answered, setAnswered] = useState<DoctordleResult | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (suspended || open) return;
    const check = () => {
      // The Doctordle page asks inline, so the floating card stays away from it.
      if (document.visibilityState !== "visible" || shellBusy() || location.hash === "#doctordle") return;
      const now = Date.now();
      if (shouldAskResult(useDoctordle.getState().log, doctordleCaseNumber(now), now)) setOpen(true);
    };
    const first = window.setTimeout(check, 800);
    const tick = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [suspended, open]);

  useEffect(() => {
    if (!answered) return;
    const timer = window.setTimeout(() => { setOpen(false); setAnswered(null); }, THANKS_MS);
    return () => window.clearTimeout(timer);
  }, [answered]);

  if (!open) return null;
  const now = Date.now();
  const caseNumber = doctordleCaseNumber(now);
  const answer = (result: DoctordleResult) => { useDoctordle.getState().recordResult(result); setAnswered(result); };
  const later = () => { useDoctordle.getState().snooze(LATER_MS); setOpen(false); };
  const streak = answered === "solved" ? doctordleStreak(useDoctordle.getState().log, caseNumber) : 0;

  return createPortal(
    <div className={`game-checkin ${answered ? "is-answered" : ""}`} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <span className="game-checkin-icon" aria-hidden="true">
        {answered === "solved" ? <Flame size={ICON_SIZE.emphasis} /> : <Stethoscope size={ICON_SIZE.emphasis} />}
      </span>
      {answered ? (
        <div className="game-checkin-copy" role="status">
          <b id={titleId}>{answered === "solved" ? (streak > 1 ? `Nice. ${streak} in a row.` : "Nice one.") : "Logged."}</b>
          <span>{answered === "solved" ? "Saved on this device." : `The next case lands in ${compactCountdown(msUntilDoctordle(new Date(now)))}.`}</span>
        </div>
      ) : (
        <>
          <div className="game-checkin-copy">
            <b id={titleId}>Did you get today's Doctordle?</b>
            <span>Case #{caseNumber}. AXOM only knows what you tell it.</span>
          </div>
          <div className="game-checkin-actions">
            <button type="button" className="gbtn sm primary" onClick={() => answer("solved")}>Got it</button>
            <button type="button" className="gbtn sm" onClick={() => answer("missed")}>Missed it</button>
            <button type="button" className="ghost-btn" onClick={later}>Later</button>
          </div>
          <button type="button" className="game-checkin-close" onClick={later} aria-label="Ask me later">
            <X size={ICON_SIZE.body} aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
