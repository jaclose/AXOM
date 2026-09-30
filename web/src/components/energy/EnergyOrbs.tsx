// Energy right now, as five orbs (JD, Ideas 3 and 4): tap one and it answers.
// High energy ripples outward, low energy melts; the other orbs step aside and
// the confirmation rises from the orb row itself ("Energy logged. Check in
// again later."), with a one-time note on why AXOM asks. With `writing` on
// (the Daily Check-In's own option), a question that fits the mood follows.
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ENERGY_LEVELS } from "../../lib/energyInsights";
import { writingPrompt } from "../../lib/dailyCheckIn";
import { prefersReducedMotion } from "../../lib/motion";
import { useStore } from "../../lib/store";
import "../../styles/energy-orbs.css";

const FIRST_CHECK_KEY = "axom.energy.explained.v1";
/** How long the logged moment holds before the row settles. */
const MOMENT_MS = 2600;

type Mood = "low" | "middle" | "high";
const moodFor = (score: number): Mood => (score <= 35 ? "low" : score >= 75 ? "high" : "middle");

export function EnergyOrbs({ compact = false, writing = false }: { compact?: boolean; writing?: boolean }) {
  const checks = useStore((state) => state.profile.energyChecks);
  const [logged, setLogged] = useState<{ label: string; score: number; at: string; firstTime: boolean } | null>(null);
  const [settled, setSettled] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const labelId = useId();
  const noteId = useId();
  const last = checks?.at(-1);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function log(score: number, label: string) {
    const store = useStore.getState();
    const at = new Date().toISOString();
    store.updateProfile({ energyChecks: [...(store.profile.energyChecks ?? []), { at, score }].slice(-400) });
    let firstTime = false;
    try {
      firstTime = !localStorage.getItem(FIRST_CHECK_KEY);
      if (firstTime) localStorage.setItem(FIRST_CHECK_KEY, at);
    } catch { /* storage blocked: skip the note */ }
    setLogged({ label, score, at, firstTime });
    setSettled(false);
    setNote("");
    setNoteSaved(false);
    window.clearTimeout(timer.current);
    // With writing on, the moment waits for the answer (or a skip).
    if (!writing) timer.current = window.setTimeout(() => setSettled(true), prefersReducedMotion() ? 1400 : MOMENT_MS);
  }

  function saveNote() {
    const text = note.trim().slice(0, 280);
    if (text && logged) {
      const store = useStore.getState();
      const all = store.profile.energyChecks ?? [];
      store.updateProfile({ energyChecks: all.map((check) => (check.at === logged.at ? { ...check, note: text } : check)) });
    }
    setNoteSaved(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSettled(true), 1200);
  }

  // Settled: a quiet line with the last check and a way to check in again.
  if (logged && settled) {
    return (
      <div className={`energy-orbs settled ${compact ? "compact" : ""}`}>
        <span className={`energy-orb small mood-${moodFor(logged.score)}`} style={{ "--level": logged.score / 100 } as CSSProperties} aria-hidden="true" />
        <span className="energy-orbs-settled-copy">
          Energy <b>{logged.label.toLowerCase()}</b> at {new Date(logged.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <button type="button" className="energy-orbs-again" onClick={() => { setLogged(null); setSettled(false); }}>Check in again</button>
      </div>
    );
  }

  const chosen = logged?.label;
  const mood = logged ? moodFor(logged.score) : undefined;
  const lastLabel = last ? ENERGY_LEVELS.reduce((best, level) => (Math.abs(level.score - last.score) < Math.abs(best.score - last.score) ? level : best)).label : null;
  return (
    <div className={`energy-orbs ${compact ? "compact" : ""} ${logged ? `is-logged mood-${mood}` : ""}`}>
      <span className="energy-orbs-label" id={labelId}>Energy right now</span>
      <div className="energy-orbs-row" role="group" aria-labelledby={labelId}>
        {ENERGY_LEVELS.map((level, index) => {
          const on = chosen === level.label;
          return (
            <button
              key={level.label}
              type="button"
              className={`energy-orb-choice ${on ? "on" : ""} ${chosen && !on ? "aside" : ""}`}
              style={{ "--level": level.score / 100, "--i": index } as CSSProperties}
              onClick={() => log(level.score, level.label)}
              aria-label={`Log energy: ${level.label}`}
              aria-pressed={on}
              disabled={Boolean(logged) && !on}
            >
              <span className={`energy-orb mood-${moodFor(level.score)}`} aria-hidden="true">
                {on && mood === "high" && <><i className="energy-ring" /><i className="energy-ring" /><i className="energy-ring" /></>}
              </span>
              <small>{level.label}</small>
            </button>
          );
        })}
      </div>

      {logged ? (
        <div className="energy-orbs-bubble" role="status">
          <b>Energy logged.</b> Check in again later.
          {logged.firstTime && <span className="energy-orbs-why">When you keep track of this, AXOM finds your best times of day.</span>}
        </div>
      ) : (
        last && !compact && <small className="energy-orbs-last">Last: {lastLabel} · {new Date(last.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</small>
      )}

      {logged && writing && !noteSaved && (
        <form className="energy-orbs-writing" onSubmit={(event) => { event.preventDefault(); saveNote(); }}>
          <label htmlFor={noteId}>
            {writingPrompt(logged.score, Date.parse(logged.at)).split(" ").map((word, index) => (
              <Fragment key={index}>{index > 0 && " "}<span style={{ "--w": index } as CSSProperties}>{word}</span></Fragment>
            ))}
          </label>
          <input id={noteId} value={note} maxLength={280} autoFocus placeholder="A line is enough" onChange={(event) => setNote(event.target.value)} />
          <span className="energy-orbs-writing-actions">
            <button type="submit">{note.trim() ? "Keep it" : "Skip"}</button>
          </span>
        </form>
      )}
      {logged && writing && noteSaved && note.trim() && <p className="energy-orbs-kept" role="status">Kept with this check-in.</p>}
    </div>
  );
}
