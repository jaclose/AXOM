import { useSyncExternalStore } from "react";
import { appUpdates, type UpdatePhase } from "../../lib/appUpdates";
import { CINEMATICS, readCinematicPreferences } from "../../lib/cinematics";
import { useReducedMotion } from "../../lib/motion";

const STEPS: Partial<Record<UpdatePhase, string>> = {
  preparing: "Saving your workspace…",
  installing: "Installing the update…",
  restarting: "Restarting AXOM…",
};

/**
 * The short film shown while an update the learner approved is applied:
 * checkpoint → install → restart. It covers the app so nothing is edited
 * mid-install, and disappears if any step fails (the panel explains why).
 */
export function UpdateCinematic() {
  const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot);
  const reduced = useReducedMotion();
  const step = STEPS[state.phase];
  if (!step) return null;
  const film = CINEMATICS[readCinematicPreferences().installing];
  const base = import.meta.env.BASE_URL;
  return (
    <div className="axom-update-cinematic" role="alertdialog" aria-modal="true" aria-label="Updating AXOM" style={{ background: film.background }}>
      {reduced
        ? <img className="axom-update-cinematic__film" src={`${base}${film.poster}`} alt="" />
        : <video className="axom-update-cinematic__film" src={`${base}${film.src}`} poster={`${base}${film.poster}`} autoPlay muted playsInline aria-hidden="true" />}
      <div className="axom-update-cinematic__status" role="status">
        <b>{state.version ? `Updating to v${state.version}` : "Updating AXOM"}</b>
        <span>{step}</span>
        <i className="axom-update-cinematic__bar" aria-hidden="true" />
      </div>
    </div>
  );
}
