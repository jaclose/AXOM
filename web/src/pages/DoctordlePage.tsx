import { ArrowLeft, ArrowUpRight, Flame, Globe2, Heart, ShieldCheck } from "lucide-react";
import { GlassCard, Tag } from "../components/ui/primitives";
import { compactCountdown, msUntilDoctordle } from "../components/shell/DailyGameNavMeta";
import { useClockNow } from "../lib/clock";
import { DOCTORDLE_URL, doctordleCaseNumber, doctordleStreak, useDoctordle } from "../lib/doctordle";
import { ICON_SIZE } from "../lib/iconSize";
import "../styles/ecosystem.css";

export function DoctordlePage() {
  const log = useDoctordle((state) => state.log);
  const now = useClockNow("minute");
  const today = doctordleCaseNumber(now.getTime());
  const streak = doctordleStreak(log, today);
  const results = Object.values(log.results);
  const solved = results.filter((result) => result === "solved").length;
  const todayResult = log.results[today];
  // Opened from here: this row is the "did you get it?" ask (the floating card skips this page).
  const asking = !todayResult && log.opened.includes(today);
  const { recordOpen, recordResult, setRemindersOff } = useDoctordle.getState();

  return <main className="ecosystem-page doctordle-page" aria-labelledby="doctordle-title">
    <div className="doctordle-topline">
      <a className="doctordle-back" href="#daily-games"><ArrowLeft size={ICON_SIZE.body} aria-hidden="true" /> Daily Games</a>
      <span className="doctordle-case">Case #{today} · next in {compactCountdown(msUntilDoctordle(now))}</span>
    </div>
    <GlassCard pad className="external-game-bridge">
      <Tag tone="green"><Globe2 size={14} /> Verified external destination</Tag>
      <h1 id="doctordle-title">Doctordle</h1>
      <p>Play the independent daily diagnosis game on its verified public website. AXOM does not embed the game, inspect your answers, or claim affiliation.</p>
      <div className="ecosystem-note"><ShieldCheck size={18} /> The provider controls its content, availability, privacy practices, and reset schedule.</div>
      <div className="doctordle-thanks">
        <Heart size={16} aria-hidden="true" />
        <p>
          <b>With thanks to the Doctordle creators.</b> Their game makes daily diagnostic reasoning fun. Go support it at the source.
          AXOM and Doctordle are independent today; a future collaboration is something we’d welcome, and this page will say so plainly if it ever happens.
        </p>
      </div>
      <a className="gbtn primary" href={DOCTORDLE_URL} target="_blank" rel="noopener noreferrer" onClick={() => recordOpen()}>Open doctordle.org <ArrowUpRight size={16} /></a>
    </GlassCard>

    <GlassCard pad className="doctordle-log" aria-labelledby="doctordle-log-title">
      <div className="doctordle-log-head">
        <h2 id="doctordle-log-title">Your check-ins</h2>
        <p>Only what you tell AXOM, kept on this device. doctordle.org keeps its own stats; nothing is read from it.</p>
      </div>
      <div className="doctordle-stats">
        <span><b>{streak > 0 && <Flame size={ICON_SIZE.body} aria-hidden="true" />}{streak}</b> in a row</span>
        <span><b>{results.length}</b> logged</span>
        <span><b>{solved}</b> got it</span>
      </div>
      <div className={`doctordle-today ${asking ? "is-asking" : ""}`}>
        {todayResult ? (
          <>
            <span>Case #{today}: <b>{todayResult === "solved" ? "Got it" : "Missed it"}</b></span>
            <button type="button" className="ghost-btn" onClick={() => recordResult(todayResult === "solved" ? "missed" : "solved")}>
              Change to {todayResult === "solved" ? "missed it" : "got it"}
            </button>
          </>
        ) : (
          <>
            <span>{asking ? `Back from doctordle.org? How did case #${today} go?` : `How did case #${today} go?`}</span>
            <button type="button" className="gbtn sm primary" onClick={() => recordResult("solved")}>Got it</button>
            <button type="button" className="gbtn sm" onClick={() => recordResult("missed")}>Missed it</button>
          </>
        )}
      </div>
      <label className="doctordle-reminder-toggle">
        <input type="checkbox" checked={!log.remindersOff} onChange={(event) => setRemindersOff(!event.target.checked)} />
        Remind me on the dashboard when a new case is up
      </label>
    </GlassCard>
  </main>;
}
