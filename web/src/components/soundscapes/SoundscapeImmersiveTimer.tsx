import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { usePomodoro, formatClock, pomodoroPhaseSeconds } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { findLiveSession, formatElapsed, sessionElapsedMs } from "../../lib/sessions";

/**
 * Fullscreen uses the canonical focus timer or live study session, never a
 * shadow clock. The overlay is present only while a timer/session exists.
 * Paused timers remain readable without inventing an activity event.
 */
export function SoundscapeImmersiveTimer() {
  const pomodoro = usePomodoro();
  const sessions = useStore((state) => state.sessions);
  const session = findLiveSession(sessions ?? []);
  const [now, setNow] = useState(() => Date.now());
  const total = pomodoroPhaseSeconds(pomodoro);
  const timed = pomodoro.running || pomodoro.focusRunStarted || pomodoro.phase !== "focus" ||
    pomodoro.secondsLeft < total;
  useEffect(() => {
    if (timed || session?.status !== "active") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timed, session?.status]);
  if (!timed && !session) return null;

  const running = timed ? pomodoro.running : session?.status === "active";
  const label = timed
    ? pomodoro.targetLabel || pomodoro.intention || (pomodoro.phase === "break" ? "Recovery" : "Focus sprint")
    : session?.title || "Study session";
  const clock = timed ? formatClock(pomodoro.secondsLeft) : formatElapsed(sessionElapsedMs(session!, new Date(now)));
  const phase = timed ? (pomodoro.phase === "break" ? "BREAK" : "FOCUS") : "STUDY SESSION";
  const ratio = timed ? 1 - pomodoro.secondsLeft / Math.max(1, total)
    : session?.plannedMinutes ? sessionElapsedMs(session, new Date(now)) / (session.plannedMinutes * 60_000) : null;
  const progress = ratio === null ? null : Math.max(0, Math.min(100, ratio * 100));
  const toggle = () => {
    if (timed) usePomodoro.getState().toggle();
    else if (session) {
      if (session.status === "active") useStore.getState().pauseSession(session.id);
      else useStore.getState().resumeSession(session.id);
    }
  };
  return (
    <div className="soundscape-immersive-timer" role="group" aria-label="Focus timer">
      <div className="soundscape-immersive-timer-top">
        <span className="soundscape-immersive-timer-eyebrow">AXOM <span aria-hidden="true">/</span> {phase}</span>
        <span className={"soundscape-immersive-timer-status " + (running ? "running" : "paused")}>
          <i aria-hidden="true" />{running ? "Running" : "Paused"}
        </span>
      </div>
      <div className="soundscape-immersive-timer-row">
        <div className="soundscape-immersive-timer-readout">
          <span className="soundscape-immersive-timer-clock" role="timer" aria-live="off">{clock}</span>
          <span className="soundscape-immersive-timer-label" title={label}>{label}</span>
        </div>
        <button type="button" className="soundscape-immersive-timer-toggle"
          onClick={toggle} aria-label={running ? "Pause timer" : "Resume timer"}>
          {running ? <Pause aria-hidden="true" size={22} /> : <Play aria-hidden="true" size={22} />}
        </button>
      </div>
      {progress !== null && (
        <div className="soundscape-immersive-timer-track" role="progressbar"
          aria-label={timed ? "Focus phase progress" : "Session goal progress"}
          aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="soundscape-immersive-timer-progress" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
