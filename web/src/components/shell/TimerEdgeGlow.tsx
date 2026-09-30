// The finish half of the timer cues: a green glow that blooms around the
// screen's edges and fades (lib/timerCues.ts). Also plays the small tone when
// the Pomodoro starts; the timer itself cues its finish, so a skip is silent.
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../../lib/motion";
import { usePomodoro } from "../../lib/pomodoro";
import { playTimerStartCue, TIMER_GLOW_EVENT } from "../../lib/timerCues";
import "../../styles/timer-cues.css";

const GLOW_MS = 2600;
/** Under reduced motion the glow still carries the news, as a brief still frame. */
const STILL_MS = 1200;

export function TimerEdgeGlow() {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const onGlow = () => setPulse((count) => count + 1);
    window.addEventListener(TIMER_GLOW_EVENT, onGlow);
    return () => window.removeEventListener(TIMER_GLOW_EVENT, onGlow);
  }, []);

  // Runs inside the click that starts the timer, so the shared audio context
  // is allowed to start (and can sound the finish later).
  useEffect(() => usePomodoro.subscribe((state, previous) => {
    if (state.running && !previous.running) playTimerStartCue();
  }), []);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(0), prefersReducedMotion() ? STILL_MS : GLOW_MS);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  if (!pulse) return null;
  return <div key={pulse} className="timer-edge-glow" aria-hidden="true" />;
}
