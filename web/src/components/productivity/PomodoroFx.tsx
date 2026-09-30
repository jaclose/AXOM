// Mounted once at the app root. Owns the Pomodoro clock lifecycle so a running
// sprint keeps accurate time on ANY route and across reloads — not only while
// the Productivity page is mounted. Watches for a completed focus sprint and
// fires the whole-page glow + a completion toast (and an OS notification if the
// user granted permission).
import { useEffect } from "react";
import { notify } from "../../lib/notify";
import { usePomodoro, ensurePomodoroClock, reconcilePomodoro } from "../../lib/pomodoro";
import { pushToast } from "../../lib/toast";
import { TimerEdgeGlow } from "../shell/TimerEdgeGlow";

export function PomodoroFx() {
  const completedAt = usePomodoro((s) => s.completedAt);
  const completedMinutes = usePomodoro((s) => s.completedMinutes);

  // Root-level clock ownership: start ticking on load if a sprint was running,
  // and reconcile against wall-clock time whenever the tab regains focus or is
  // restored from the back/forward cache. Listeners are cleaned up on unmount.
  useEffect(() => {
    ensurePomodoroClock();
    const reconcile = () => reconcilePomodoro();
    const onVisible = () => { if (!document.hidden) reconcile(); };
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!completedAt) return;
    const minutes = completedMinutes;
    pushToast({
      title: "Focus sprint complete",
      body: minutes ? `${minutes}m logged to today — take your break.` : "Nice work — take your break.",
      tone: "success",
      href: "#productivity",
      actionLabel: "Productivity",
      duration: 7000,
      dedupe: `pomodoro-complete-${completedAt}`,
    });
    if (typeof document !== "undefined" && (document.visibilityState === "hidden" || !document.hasFocus())) {
      void notify("AXOM — focus sprint complete", minutes ? `${minutes} minutes logged. Take your break.` : "Take your break.", { tag: `axom-pomodoro-${completedAt}` });
    }
  }, [completedAt, completedMinutes]);

  // Start tone and finish glow (the chime itself comes from the timer's natural finish).
  return <TimerEdgeGlow />;
}
