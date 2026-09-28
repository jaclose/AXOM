import { useEffect, useId, useState } from "react";
import { Clapperboard, Play, Repeat } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import {
  CINEMATICS,
  CINEMATIC_PREFS_EVENT,
  FIRST_RUN_FILM,
  INTRO_FILM_ORDER,
  INTRO_FREQUENCY_LABELS,
  readCinematicPreferences,
  writeCinematicPreferences,
  type CinematicId,
  type CinematicPreferences,
  type IntroFrequency,
} from "../../lib/cinematics";
import { startStartupIntro } from "../../lib/startupIntro";
import { APP_RELEASE_VERSION } from "../../lib/brand";
import { useReducedMotion } from "../../lib/motion";
import { onRadioGroupKeyDown } from "./AppearanceStudio";

export function useCinematicPreferences(): CinematicPreferences {
  const [prefs, setPrefs] = useState(readCinematicPreferences);
  useEffect(() => {
    const sync = () => setPrefs(readCinematicPreferences());
    window.addEventListener(CINEMATIC_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CINEMATIC_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return prefs;
}

const FREQUENCIES: IntroFrequency[] = ["daily", "weekly", "updates", "always", "never"];

function preview(id: CinematicId, caption?: string) {
  startStartupIntro({ preview: { film: CINEMATICS[id], caption } });
}

/** Opening-film schedule and film choice (Settings → Appearance). */
export function CinematicSettings() {
  const groupId = useId();
  const prefs = useCinematicPreferences();
  const reduced = useReducedMotion();
  const placeholders = [prefs.intro, prefs.update, prefs.installing].some((id) => id !== "rotate" && CINEMATICS[id].placeholder);
  return (
    <section className="appearance-block cinematic-settings" aria-labelledby={`${groupId}-films`}>
      <header>
        <h4 id={`${groupId}-films`}><Clapperboard size={ICON_SIZE.body} aria-hidden="true" /> Opening film</h4>
        <p>A short brand film when AXOM opens. It never delays your work — click or press Escape to skip.</p>
      </header>

      <div className="cinematic-frequency" role="radiogroup" aria-label="When the opening film plays" onKeyDown={onRadioGroupKeyDown}>
        {FREQUENCIES.map((frequency) => {
          const selected = prefs.frequency === frequency;
          return (
            <button
              key={frequency}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className={selected ? "on" : ""}
              onClick={() => writeCinematicPreferences({ frequency })}
            >
              <b>{INTRO_FREQUENCY_LABELS[frequency].label}</b>
              <small>{INTRO_FREQUENCY_LABELS[frequency].hint}</small>
            </button>
          );
        })}
      </div>

      <div className="cinematic-films" role="radiogroup" aria-label="Everyday opening film" onKeyDown={onRadioGroupKeyDown}>
        {INTRO_FILM_ORDER.map((id) => {
          const film = CINEMATICS[id];
          const selected = prefs.intro === id;
          return (
            <div key={id} className={`cinematic-film ${selected ? "on" : ""}`}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="cinematic-film-pick"
                onClick={() => writeCinematicPreferences({ intro: id })}
              >
                <img src={`${import.meta.env.BASE_URL}${film.poster}`} alt="" loading="lazy" style={{ background: film.background }} />
                <span><b>{film.label}</b><small>{film.description}</small></span>
              </button>
              <button type="button" className="cinematic-film-preview" onClick={() => preview(id)} disabled={reduced} aria-label={`Preview ${film.label}`}>
                <Play size={ICON_SIZE.microInline} aria-hidden="true" /> Preview
              </button>
            </div>
          );
        })}
        <div className={`cinematic-film rotate ${prefs.intro === "rotate" ? "on" : ""}`}>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.intro === "rotate"}
            tabIndex={prefs.intro === "rotate" ? 0 : -1}
            className="cinematic-film-pick"
            onClick={() => writeCinematicPreferences({ intro: "rotate" })}
          >
            <span className="cinematic-rotate-glyph" aria-hidden="true"><Repeat size={ICON_SIZE.emphasis} /></span>
            <span><b>Rotate</b><small>A different film each time.</small></span>
          </button>
        </div>
      </div>

      <div className="cinematic-moments">
        <div className="cinematic-moment-fixed">
          <span>First open on a device</span>
          <b>{CINEMATICS[FIRST_RUN_FILM].label} · {Math.round(CINEMATICS[FIRST_RUN_FILM].durationMs / 1000)} s</b>
          <button type="button" className="account-link" disabled={reduced} onClick={() => preview(FIRST_RUN_FILM)}>Preview</button>
        </div>
        <label>
          <span>After an update</span>
          <select className="field" value={prefs.update} onChange={(event) => writeCinematicPreferences({ update: event.target.value as CinematicId })}>
            {INTRO_FILM_ORDER.map((id) => <option key={id} value={id}>{CINEMATICS[id].label}</option>)}
          </select>
          <button type="button" className="account-link" disabled={reduced} onClick={() => preview(prefs.update, `Updated to v${APP_RELEASE_VERSION}`)}>Preview</button>
        </label>
        <label>
          <span>While installing an update</span>
          <select className="field" value={prefs.installing} onChange={(event) => writeCinematicPreferences({ installing: event.target.value as CinematicId })}>
            {INTRO_FILM_ORDER.map((id) => <option key={id} value={id}>{CINEMATICS[id].label}</option>)}
          </select>
        </label>
      </div>
      <p className="appearance-footnote">
        {reduced
          ? "Films are off while reduced motion is on."
          : placeholders
            ? "Some of your chosen films are early placeholders; the AXOM wordmark films are the finished renders."
            : "Each film fades to black and AXOM settles in beneath it. Nothing waits on the film."}
      </p>
    </section>
  );
}
