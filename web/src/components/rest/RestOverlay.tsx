import { useEffect, useRef, useState } from "react";
import { AlarmClock, BedDouble, Minimize2, Moon, Plus, Sunrise } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { DEFAULT_REST_MINUTES, formatRestClock, restoreRest, useRest } from "../../lib/rest";
import { SoundscapeVisual } from "../soundscapes/SoundscapeVisual";

function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** "Put my head down" — the start button used in the timer card. */
export function RestButton({ compact = false }: { compact?: boolean }) {
  const status = useRest((state) => state.status);
  const withSound = useRest((state) => state.withSound);
  const { start, setOverlayOpen, setWithSound } = useRest.getState();
  if (status !== "idle") {
    return (
      <button type="button" className="rest-button active" onClick={() => setOverlayOpen(true)}>
        <Moon size={ICON_SIZE.body} aria-hidden="true" /> Resting — open
      </button>
    );
  }
  return (
    <div className={`rest-start ${compact ? "compact" : ""}`}>
      <button type="button" className="rest-button" onClick={() => start(DEFAULT_REST_MINUTES)} title="Pauses your timer, then wakes you gently in 15 minutes">
        <BedDouble size={ICON_SIZE.body} aria-hidden="true" /> Put my head down <small>15 min</small>
      </button>
      {!compact && (
        <label className="rest-sound-toggle">
          <input type="checkbox" checked={withSound} onChange={(event) => setWithSound(event.target.checked)} /> Soft rain while I rest
        </label>
      )}
    </div>
  );
}

/** Full-screen rest and wake-up surface. Mounted once at the app root. */
export function RestOverlay() {
  const status = useRest((state) => state.status);
  const endsAt = useRest((state) => state.endsAt);
  const overlayOpen = useRest((state) => state.overlayOpen);
  const paused = useRest((state) => state.paused);
  const now = useClock(status !== "idle");
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => { restoreRest(); }, []);
  useEffect(() => {
    if (overlayOpen && status !== "idle") primary.current?.focus({ preventScroll: true });
  }, [overlayOpen, status]);

  if (status === "idle" || !overlayOpen) return null;
  const { extend, wakeNow, snooze, dismiss, setOverlayOpen } = useRest.getState();
  const ringing = status === "ringing";
  const wakeTime = endsAt ? new Date(endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const canResume = Boolean(paused?.pomodoro || paused?.sessionId);

  return (
    <div className={`rest-overlay ${ringing ? "ringing" : ""}`} role="dialog" aria-modal="true" aria-label={ringing ? "Time to lift your head" : "Resting"}>
      <div className="rest-visual" aria-hidden="true">
        <SoundscapeVisual visual={ringing ? "flow" : "breath"} animate />
      </div>
      <div className="rest-copy">
        {ringing ? <Sunrise size={28} aria-hidden="true" /> : <Moon size={28} aria-hidden="true" />}
        <h2>{ringing ? "Time to lift your head" : "Head down. Breathe slowly."}</h2>
        <div className="rest-clock mono" aria-live="off">{ringing ? wakeTime : formatRestClock((endsAt ?? now) - now)}</div>
        <p>{ringing ? "Take a sip of water and ease back in." : `AXOM will wake you gently at ${wakeTime}.`}</p>
        <div className="rest-actions">
          {ringing ? (
            <>
              <button ref={primary} type="button" className="rest-primary" onClick={() => dismiss({ resume: canResume })}>
                {canResume ? "I’m up — resume focus" : "I’m up"}
              </button>
              <button type="button" onClick={() => snooze(5)}><AlarmClock size={ICON_SIZE.body} aria-hidden="true" /> 5 more minutes</button>
              {canResume && <button type="button" onClick={() => dismiss()}>I’m up, don’t resume</button>}
            </>
          ) : (
            <>
              <button type="button" onClick={() => extend(5)}><Plus size={ICON_SIZE.body} aria-hidden="true" /> 5 min</button>
              <button ref={primary} type="button" className="rest-primary" onClick={() => wakeNow()}>Wake me now</button>
              <button type="button" onClick={() => setOverlayOpen(false)} aria-label="Minimize to the focus dock"><Minimize2 size={ICON_SIZE.body} aria-hidden="true" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
