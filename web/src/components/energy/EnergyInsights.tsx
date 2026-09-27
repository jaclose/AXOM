import { useMemo, useState } from "react";
import { BatteryCharging, Clock3, FlaskConical, Info, TrendingDown, TrendingUp } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import {
  ENERGY_LEVELS,
  dayRhythm,
  energyDrivers,
  peakWindow,
  todaysCapacity,
  type EnergyInputs,
} from "../../lib/energyInsights";
import { readRestLog } from "../../lib/rest";
import { readListeningLog } from "../../lib/soundscapes/listeningLog";
import { pushToast } from "../../lib/toast";

/** Everything the energy model reads, from the workspace and device ledgers. */
export function useEnergyInputs(): EnergyInputs {
  const profile = useStore((state) => state.profile);
  const journal = useStore((state) => state.journal);
  const closeouts = useStore((state) => state.closeouts);
  const sessions = useStore((state) => state.sessions);
  const logs = useStore((state) => state.logs);
  const questions = useStore((state) => state.questions);
  const energyFactors = useStore((state) => state.energyFactors);
  const productivityTrackers = useStore((state) => state.productivityTrackers);
  return useMemo(() => ({
    energyChecks: profile.energyChecks ?? [],
    journal,
    closeouts,
    sessions,
    logs,
    attempts: (questions ?? []).flatMap((question) => question.attempts ?? []),
    energyFactors,
    productivityTrackers,
    rests: readRestLog(),
    listening: readListeningLog(),
  }), [profile.energyChecks, journal, closeouts, sessions, logs, questions, energyFactors, productivityTrackers]);
}

/** One tap: how is your energy right now? */
export function EnergyCheckRow({ compact = false }: { compact?: boolean }) {
  const checks = useStore((state) => state.profile.energyChecks);
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const last = checks?.at(-1);
  const lastLabel = last ? ENERGY_LEVELS.reduce((best, level) => (Math.abs(level.score - last.score) < Math.abs(best.score - last.score) ? level : best)).label : null;
  function log(score: number, label: string) {
    const store = useStore.getState();
    const next = [...(store.profile.energyChecks ?? []), { at: new Date().toISOString(), score }].slice(-400);
    store.updateProfile({ energyChecks: next });
    setJustLogged(label);
    pushToast({ title: `Energy logged: ${label}`, body: "Thanks — AXOM uses these to find your best hours.", tone: "success", duration: 3500, dedupe: "energy-check" });
  }
  return (
    <div className={`energy-check ${compact ? "compact" : ""}`}>
      <span className="energy-check-label">Energy right now</span>
      <div className="energy-check-levels" role="group" aria-label="Log your energy right now">
        {ENERGY_LEVELS.map((level) => (
          <button key={level.label} type="button" className={justLogged === level.label ? "on" : ""} onClick={() => log(level.score, level.label)} aria-label={`Log energy: ${level.label}`}>
            <i style={{ "--level": level.score / 100 } as React.CSSProperties} aria-hidden="true" />
            <span>{level.label}</span>
          </button>
        ))}
      </div>
      {last && !compact && (
        <small className="energy-check-last">Last: {lastLabel} · {new Date(last.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</small>
      )}
    </div>
  );
}

export function CapacitySummary({ showCheck = true, showReasons = true, showHead = true }: { showCheck?: boolean; showReasons?: boolean; showHead?: boolean }) {
  const inputs = useEnergyInputs();
  const today = useStore((state) => state.activeDayKey);
  const capacity = useMemo(() => todaysCapacity(inputs, today), [inputs, today]);
  const peak = useMemo(() => peakWindow(dayRhythm(inputs)), [inputs]);
  return (
    <div className={`capacity-summary level-${capacity.hasEvidence ? capacity.level : "none"}`}>
      {showHead && <div className="capacity-head">
        <span className="capacity-pill"><BatteryCharging size={ICON_SIZE.body} aria-hidden="true" /> {capacity.label}</span>
        {capacity.suggestedMinutes > 0 && capacity.hasEvidence && (
          <span className="capacity-target"><b>{capacity.suggestedMinutes} min</b> <small>suggested · typical {capacity.typicalMinutes}</small></span>
        )}
      </div>}
      {showReasons && <ul className="capacity-reasons">
        {capacity.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
      </ul>}
      {peak && (
        <p className="capacity-peak"><Clock3 size={ICON_SIZE.microInline} aria-hidden="true" /> Sharpest: <b>{peak.band.label.toLowerCase()}</b> ({formatBand(peak.band.startHour, peak.band.endHour)}){peak.basis === "accuracy" && peak.band.accuracy !== null ? ` · ${peak.band.accuracy}% accuracy on ${peak.band.answered} questions` : " · highest energy"}</p>
      )}
      {showCheck && <EnergyCheckRow compact />}
    </div>
  );
}

function formatMinutes(minutes: number) {
  return minutes >= 90 ? `${Math.round(minutes / 6) / 10} h` : `${minutes} min`;
}

function formatBand(start: number, end: number) {
  const format = (hour: number) => new Date(2000, 0, 1, hour % 24).toLocaleTimeString([], { hour: "numeric" });
  return `${format(start)}–${format(end)}`;
}

/** Reports: capacity, the day's rhythm, and what seems to move your energy. */
export function EnergyFocusPanel() {
  const inputs = useEnergyInputs();
  const rhythm = useMemo(() => dayRhythm(inputs), [inputs]);
  const drivers = useMemo(() => energyDrivers(inputs), [inputs]);
  const maxMinutes = Math.max(1, ...rhythm.map((band) => band.minutes));
  const totalMinutes = rhythm.reduce((sum, band) => sum + band.minutes, 0);
  const samples = rhythm.reduce((sum, band) => sum + band.energySamples, 0);
  return (
    <div className="energy-panel">
      <CapacitySummary showCheck={false} />
      <div className="energy-rhythm" role="table" aria-label="Energy and focus across the day, last 30 days">
        <div className="energy-rhythm-row head" role="row">
          <span role="columnheader">Time of day</span>
          <span role="columnheader">Energy</span>
          <span role="columnheader">Share of study time</span>
          <span role="columnheader">Accuracy</span>
        </div>
        {rhythm.map((band) => (
          <div key={band.label} className="energy-rhythm-row" role="row">
            <span role="cell"><b>{band.label}</b><small>{formatBand(band.startHour, band.endHour)}</small></span>
            <span role="cell" className="energy-bar-cell">
              {band.energy !== null
                ? <><i className="energy-bar" style={{ width: `${band.energy}%` }} /><em>{band.energy}</em></>
                : <small>{band.energySamples ? `${band.energySamples} check${band.energySamples === 1 ? "" : "s"} — need 2` : "—"}</small>}
            </span>
            <span role="cell" className="energy-bar-cell">
              {band.minutes > 0 ? <><i className="energy-bar minutes" style={{ width: `${(band.minutes / maxMinutes) * 100}%` }} /><em>{Math.round((band.minutes / Math.max(1, totalMinutes)) * 100)}% · {formatMinutes(band.minutes)}</em></> : <small>—</small>}
            </span>
            <span role="cell">{band.accuracy !== null ? `${band.accuracy}%` : band.answered ? <small>{band.answered} answered — need 10</small> : <small>—</small>}</span>
          </div>
        ))}
      </div>
      <div className="energy-drivers">
        <h4><FlaskConical size={ICON_SIZE.body} aria-hidden="true" /> What seems to move your energy</h4>
        {drivers.length ? (
          <ul>
            {drivers.slice(0, 5).map((driver) => (
              <li key={driver.id}>
                {driver.difference >= 0 ? <TrendingUp size={ICON_SIZE.body} className="up" aria-hidden="true" /> : <TrendingDown size={ICON_SIZE.body} className="down" aria-hidden="true" />}
                <span><b>{driver.label}</b>: energy {driver.withAverage} vs {driver.withoutAverage} without <small>({driver.withDays} vs {driver.withoutDays} days)</small></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">After about a week of quick energy checks, AXOM compares days with and without movement, rests, soundscapes, a heavy previous day, logged sleep and any tracker you mark “affects energy”.</p>
        )}
        <p className="energy-honesty"><Info size={ICON_SIZE.microInline} aria-hidden="true" /> Observational: days differ in many ways, so treat these as leads to test, not causes. {samples ? `${samples} energy observation${samples === 1 ? "" : "s"} in the last 30 days.` : "No energy observations yet."}</p>
      </div>
      <EnergyCheckRow />
    </div>
  );
}
