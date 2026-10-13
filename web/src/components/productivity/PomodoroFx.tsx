// Mounted once at the app root. Owns the Pomodoro clock lifecycle so a running
// sprint keeps accurate time on ANY route and across reloads — not only while
// the Productivity page is mounted. Watches for a completed focus sprint and
// fires the whole-page glow + a completion toast (and an OS notification if the
// user granted permission).
import { useEffect, useState } from "react";
import { notify } from "../../lib/notify";
import { usePomodoro, ensurePomodoroClock, reconcilePomodoro } from "../../lib/pomodoro";
import { pushToast } from "../../lib/toast";
import { useStore } from "../../lib/store";

export function PomodoroFx() {
  const completedAt = usePomodoro((s) => s.completedAt);
  const completedMinutes = usePomodoro((s) => s.completedMinutes);
  const [glow, setGlow] = useState(false);

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
    setGlow(true);
    const minutes = completedMinutes;
    const pomodoro = usePomodoro.getState();
    const trackerTarget = pomodoro.targetKind === "tracker" && pomodoro.targetId
      ? useStore.getState().tracker.find((item) => item.id === pomodoro.targetId)
      : undefined;
    const eventId = `pomodoro-course:${completedAt}`;
    pushToast({
      title: "Focus sprint complete",
      body: trackerTarget
        ? `${minutes ? `${minutes}m logged. ` : ""}What kind of pass did you finish for ${trackerTarget.label}?`
        : minutes ? `${minutes}m logged to today — take your break.` : "Nice work — take your break.",
      tone: "success",
      ...(trackerTarget ? {
        actions: [
          { label: "Study pass", onAction: () => useStore.getState().recordCoursePass(trackerTarget.id, "study", eventId) },
          { label: "Anki round", onAction: () => useStore.getState().recordCoursePass(trackerTarget.id, "anki", eventId) },
          { label: "Question round", onAction: () => useStore.getState().recordCoursePass(trackerTarget.id, "questions", eventId) },
        ],
        duration: 0,
      } : {
        href: "#productivity",
        actionLabel: "Productivity",
        duration: 7000,
      }),
      dedupe: `pomodoro-complete-${completedAt}`,
    });
    if (typeof document !== "undefined" && (document.visibilityState === "hidden" || !document.hasFocus())) {
      void notify("AXOM — focus sprint complete", minutes ? `${minutes} minutes logged. Take your break.` : "Take your break.", { tag: `axom-pomodoro-${completedAt}` });
    }
    const timer = setTimeout(() => setGlow(false), 2800);
    return () => clearTimeout(timer);
  }, [completedAt, completedMinutes]);

  return <div className={`pomo-page-glow ${glow ? "active" : ""}`} aria-hidden="true" />;
}
