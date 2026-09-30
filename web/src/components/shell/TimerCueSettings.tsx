// Settings > Appearance: the timer's start tone, finish chime and edge glow.
import { useEffect, useId, useState } from "react";
import { BellRing, Play } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import {
  flashTimerGlow,
  playTimerEndCue,
  playTimerStartCue,
  readTimerCues,
  TIMER_CUES_EVENT,
  writeTimerCues,
  type TimerCuePreferences,
} from "../../lib/timerCues";

export function TimerCueSettings() {
  const titleId = useId();
  const [prefs, setPrefs] = useState<TimerCuePreferences>(readTimerCues);
  useEffect(() => {
    const sync = () => setPrefs(readTimerCues());
    window.addEventListener(TIMER_CUES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TIMER_CUES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const rows: Array<{ key: keyof TimerCuePreferences; label: string; hint: string; preview: () => void }> = [
    {
      key: "sound",
      label: "Tones",
      hint: "A small tone when a timer starts and a soft chime when it ends.",
      preview: () => {
        playTimerStartCue({ force: true });
        window.setTimeout(() => playTimerEndCue("focus", { force: true }), 700);
      },
    },
    {
      key: "glow",
      label: "Screen glow",
      hint: "The edges of the screen glow green for a moment when a timer ends.",
      preview: () => flashTimerGlow({ force: true }),
    },
  ];

  return (
    <section className="appearance-block timer-cue-settings" aria-labelledby={titleId}>
      <header>
        <h4 id={titleId}><BellRing size={ICON_SIZE.body} aria-hidden="true" /> Timer cues</h4>
        <p>So you can look away while you work and still know when a timer starts and ends.</p>
      </header>
      <div className="timer-cue-rows">
        {rows.map((row) => (
          <div key={row.key} className="timer-cue-row">
            <span><b>{row.label}</b><small>{row.hint}</small></span>
            <button type="button" className="account-link" onClick={row.preview} aria-label={`Preview ${row.label.toLowerCase()}`}>
              <Play size={ICON_SIZE.microInline} aria-hidden="true" /> Preview
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              aria-label={row.label}
              className={`onboarding-switch ${prefs[row.key] ? "on" : ""}`}
              onClick={() => setPrefs(writeTimerCues({ [row.key]: !prefs[row.key] }))}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
