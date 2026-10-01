// Energy right now, as five orbs (JD, Ideas 3 and 4): tap one and it answers.
// High energy ripples outward, low energy melts. The other orbs fall away,
// the chosen one glides to the front, and the confirmation comes off the orb
// itself ("Energy logged. Check in again later."), with a one-time note on
// why AXOM asks. With `writing` on (the Daily Check-In's own option), a
// question that fits the mood follows.
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ENERGY_LEVELS } from "../../lib/energyInsights";
import { writingPrompt } from "../../lib/dailyCheckIn";
import { prefersReducedMotion } from "../../lib/motion";
import { useStore } from "../../lib/store";
import "../../styles/energy-orbs.css";

const FIRST_CHECK_KEY = "axom.energy.explained.v1";
/** How long the logged moment holds before the row settles. */
const MOMENT_MS = 2600;
const EASE = "cubic-bezier(.22, 1, .36, 1)";

type Mood = "low" | "middle" | "high";
const moodFor = (score: number): Mood => (score <= 35 ? "low" : score >= 75 ? "high" : "middle");

export function EnergyOrbs({ compact = false, writing = false }: { compact?: boolean; writing?: boolean }) {
  const checks = useStore((state) => state.profile.energyChecks);
  const [logged, setLogged] = useState<{ label: string; score: number; at: string; firstTime: boolean } | null>(null);
  const [settled, setSettled] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  /** Where the chosen orb sat before the others fell away (for the glide). */
  const glideFrom = useRef<{ label: string; left: number } | null>(null);
  const keepFocus = useRef(false);
  const labelId = useId();
  const noteId = useId();
  const last = checks?.at(-1);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // FLIP: the chosen orb starts where it was tapped and glides to the front.
  useLayoutEffect(() => {
    const from = glideFrom.current;
    glideFrom.current = null;
    if (!from || prefersReducedMotion()) return;
    const orb = root.current?.querySelector<HTMLElement>(`[data-level="${from.label}"]`);
    if (!orb || typeof orb.animate !== "function") return;
    const dx = from.left - orb.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) orb.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 620, easing: EASE });
  }, [logged]);

  // Settling swaps the row for one line; keep keyboard focus inside it.
  useEffect(() => {
    if (!settled || !keepFocus.current) return;
    keepFocus.current = false;
    root.current?.querySelector<HTMLElement>(".energy-orbs-again")?.focus();
  }, [settled]);

  function settleAfter(ms: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      keepFocus.current = Boolean(root.current?.contains(document.activeElement));
      setSettled(true);
    }, ms);
  }

  function log(score: number, label: string, button: HTMLElement) {
    if (logged) return;
    const store = useStore.getState();
    const at = new Date().toISOString();
    store.updateProfile({ energyChecks: [...(store.profile.energyChecks ?? []), { at, score }].slice(-400) });
    let firstTime = false;
    try {
      firstTime = !localStorage.getItem(FIRST_CHECK_KEY);
      if (firstTime) localStorage.setItem(FIRST_CHECK_KEY, at);
    } catch { /* storage blocked: skip the note */ }
    glideFrom.current = { label, left: button.getBoundingClientRect().left };
    setLogged({ label, score, at, firstTime });
    setSettled(false);
    setNote("");
    setNoteSaved(false);
    // With writing on, the moment waits for the answer (or a skip). The
    // first-ever check holds a little longer so its extra line can be read.
    if (!writing) settleAfter(prefersReducedMotion() ? 1400 : MOMENT_MS + (firstTime ? 1600 : 0));
  }

  function saveNote() {
    const text = note.trim().slice(0, 280);
    if (text && logged) {
      const store = useStore.getState();
      const all = store.profile.energyChecks ?? [];
      store.updateProfile({ energyChecks: all.map((check) => (check.at === logged.at ? { ...check, note: text } : check)) });
    }
    setNoteSaved(true);
    settleAfter(1200);
  }

  function again() {
    setLogged(null);
    setSettled(false);
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(".energy-orb-choice")?.focus());
  }

  // Settled: a quiet line with the last check and a way to check in again.
  if (logged && settled) {
    return (
      <div ref={root} className={`energy-orbs settled ${compact ? "compact" : ""}`}>
        <span className={`energy-orb small mood-${moodFor(logged.score)}`} style={{ "--level": logged.score / 100 } as CSSProperties} aria-hidden="true" />
        <span className="energy-orbs-settled-copy">
          Energy <b>{logged.label.toLowerCase()}</b> at {new Date(logged.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <button type="button" className="energy-orbs-again" onClick={again}>Check in again</button>
      </div>
    );
  }

  const mood = logged ? moodFor(logged.score) : undefined;
  const lastLabel = last ? ENERGY_LEVELS.reduce((best, level) => (Math.abs(level.score - last.score) < Math.abs(best.score - last.score) ? level : best)).label : null;
  return (
    <div ref={root} className={`energy-orbs ${compact ? "compact" : ""} ${logged ? `is-logged mood-${mood}` : ""}`}>
      <span className="energy-orbs-label" id={labelId}>Energy right now</span>
      <div className="energy-orbs-row" role="group" aria-labelledby={labelId}>
        {ENERGY_LEVELS.map((level, index) => {
          const on = logged?.label === level.label;
          if (logged && !on) return null;
          return (
            <button
              key={level.label}
              type="button"
              className={`energy-orb-choice ${on ? "on" : ""}`}
              data-level={level.label}
              style={{ "--level": level.score / 100, "--i": index } as CSSProperties}
              onClick={(event) => log(level.score, level.label, event.currentTarget)}
              aria-label={`Log energy: ${level.label}`}
              aria-pressed={on}
            >
              <span className={`energy-orb mood-${moodFor(level.score)}`} aria-hidden="true">
                {on && mood === "high" && <><i className="energy-ring" /><i className="energy-ring" /><i className="energy-ring" /></>}
              </span>
              <small>{level.label}</small>
            </button>
          );
        })}
        {logged && (
          <div className="energy-orbs-bubble" role="status">
            <span><b>Energy logged.</b> Check in again later.</span>
            {logged.firstTime && <span className="energy-orbs-why">When you keep track of this, AXOM finds your best times of day.</span>}
          </div>
        )}
      </div>

      {!logged && last && !compact && (
        <small className="energy-orbs-last">Last: {lastLabel} · {new Date(last.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</small>
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
