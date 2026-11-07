import { useEffect, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { useSoundscape } from "../../lib/soundscapes/store";
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
  const stopAt = useSoundscape((state) => state.stopAt);
  const soundStatus = useSoundscape((state) => state.status);
  const session = findLiveSession(sessions ?? []);
  const [now, setNow] = useState(() => Date.now());
  const total = pomodoroPhaseSeconds(pomodoro);
  const timed = pomodoro.running || pomodoro.focusRunStarted || pomodoro.phase !== "focus" ||
    pomodoro.secondsLeft < total;
  const soundStop = Boolean(stopAt && soundStatus !== "idle");
  useEffect(() => {
    if (!soundStop && (timed || session?.status !== "active")) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timed, session?.status, soundStop]);
  if (!timed && !session && !soundStop) return null;
  const soundOnly = !timed && !session;

  const running = soundOnly ? soundStatus === "playing" : timed ? pomodoro.running : session?.status === "active";
  const label = soundOnly ? "Soundscape playback will stop" : timed
    ? pomodoro.targetLabel || pomodoro.intention || (pomodoro.phase === "break" ? "Recovery" : "Focus sprint")
    : session?.title || "Study session";
  const clock = soundOnly ? formatClock(Math.max(0, Math.ceil(((stopAt ?? now) - now) / 1000)))
    : timed ? formatClock(pomodoro.secondsLeft) : formatElapsed(sessionElapsedMs(session!, new Date(now)));
  const phase = soundOnly ? "AUDIO STOP" : timed ? (pomodoro.phase === "break" ? "BREAK" : "FOCUS") : "STUDY SESSION";
  const ratio = soundOnly ? null : timed ? 1 - pomodoro.secondsLeft / Math.max(1, total)
    : session?.plannedMinutes ? sessionElapsedMs(session, new Date(now)) / (session.plannedMinutes * 60_000) : null;
  const progress = ratio === null ? null : Math.max(0, Math.min(100, ratio * 100));
  const toggle = () => {
    if (soundOnly) useSoundscape.getState().setStopAfter(null);
    else if (timed) usePomodoro.getState().toggle();
    else if (session) {
      if (session.status === "active") useStore.getState().pauseSession(session.id);
      else useStore.getState().resumeSession(session.id);
    }
  };
  return (
    <div className="soundscape-immersive-timer" role="group" aria-label={soundOnly ? "Audio stop timer" : "Focus timer"}>
      <div className="soundscape-immersive-timer-top">
        <span className="soundscape-immersive-timer-eyebrow">AXOM <span aria-hidden="true">/</span> {phase}</span>
        <span className={"soundscape-immersive-timer-status " + (running ? "running" : "paused")}>
          <i aria-hidden="true" />{soundOnly ? "Scheduled" : running ? "Running" : "Paused"}
        </span>
      </div>
      <div className="soundscape-immersive-timer-row">
        <div className="soundscape-immersive-timer-readout">
          <span className="soundscape-immersive-timer-clock" role="timer" aria-live="off">{clock}</span>
          <span className="soundscape-immersive-timer-label" title={label}>{label}</span>
        </div>
        <button type="button" className="soundscape-immersive-timer-toggle"
          onClick={toggle} aria-label={soundOnly ? "Cancel sound stop timer" : running ? "Pause timer" : "Resume timer"}>
          {soundOnly ? <X aria-hidden="true" size={22} /> : running ? <Pause aria-hidden="true" size={22} /> : <Play aria-hidden="true" size={22} />}
        </button>
      </div>
      {soundStop && !soundOnly && <p className="soundscape-immersive-stop">Audio stops in {Math.max(0, Math.ceil(((stopAt ?? now) - now) / 60_000))} min</p>}
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
