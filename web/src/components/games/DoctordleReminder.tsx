// A friendly dashboard nudge for Doctordle regulars (JD, Ideas 3): "did you
// do the Doctordle? yes, no, later, don't show again." Shown only when a new
// case is up, the learner hasn't touched it, and they played recently.
import { useEffect, useState } from "react";
import { ArrowUpRight, Flame, Stethoscope } from "lucide-react";
import { useClockNow } from "../../lib/clock";
import { ICON_SIZE } from "../../lib/iconSize";
import {
  DOCTORDLE_URL, doctordleCaseNumber, doctordleStreak, shouldRemind, useDoctordle, type DoctordleResult,
} from "../../lib/doctordle";
import { pushToast } from "../../lib/toast";
import { GButton, GhostButton, GlassCard } from "../ui/primitives";
import { compactCountdown, msUntilDoctordle } from "../shell/DailyGameNavMeta";

type Step = "ask" | "result" | "play" | "logged";
const LATER_MS = 3 * 60 * 60_000;
const LOGGED_MS = 2_600;

export function DoctordleReminder() {
  const log = useDoctordle((state) => state.log);
  const now = useClockNow("minute");
  const today = doctordleCaseNumber(now.getTime());
  const [step, setStep] = useState<Step>("ask");
  const [logged, setLogged] = useState<DoctordleResult | null>(null);
  const due = shouldRemind(log, today, now.getTime());

  useEffect(() => {
    if (step !== "logged") return;
    const timer = window.setTimeout(() => setStep("ask"), LOGGED_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  if (!due && (step === "ask" || step === "play")) return null;

  const { recordOpen, recordResult, skipToday, snooze, setRemindersOff } = useDoctordle.getState();
  const answer = (result: DoctordleResult) => { recordResult(result); setLogged(result); setStep("logged"); };
  const stopReminding = () => {
    setRemindersOff(true);
    pushToast({
      title: "Doctordle reminders off",
      body: "Turn them back on from the Doctordle page.",
      tone: "info",
      actionLabel: "Undo",
      onAction: () => useDoctordle.getState().setRemindersOff(false),
      dedupe: "doctordle-reminders-off",
    });
  };

  const streak = doctordleStreak(log, today);
  const copy: Record<Step, { title: string; body: string }> = {
    ask: { title: "Did you do today's Doctordle?", body: `Case #${today} is up.${streak ? ` You're on ${streak} in a row.` : ""}` },
    result: { title: "How did it go?", body: "AXOM only knows what you tell it." },
    play: { title: "It's a quick one", body: "Open it now, or sit this case out." },
    logged: {
      title: logged === "solved" ? (streak > 1 ? `Logged. ${streak} in a row.` : "Logged. Nice one.") : "Logged.",
      body: `The next case lands in ${compactCountdown(msUntilDoctordle(now))}.`,
    },
  };

  return (
    <GlassCard pad className="standup-prompt-card due doctordle-reminder" aria-live="polite">
      <div className="standup-prompt-head">
        <span className="standup-prompt-mark">
          {step === "logged" && logged === "solved" ? <Flame size={ICON_SIZE.emphasis} /> : <Stethoscope size={ICON_SIZE.emphasis} />}
        </span>
        <div className="grow">
          <b>{copy[step].title}</b>
          <span>{copy[step].body}</span>
        </div>
      </div>
      {step === "ask" && (
        <div className="row wrap gap8 doctordle-reminder-actions">
          <GButton size="sm" variant="primary" onClick={() => setStep("result")}>Yes</GButton>
          <GButton size="sm" onClick={() => setStep("play")}>No</GButton>
          <GhostButton onClick={() => snooze(LATER_MS)}>Later</GhostButton>
          <GhostButton onClick={stopReminding}>Don't show again</GhostButton>
        </div>
      )}
      {step === "result" && (
        <div className="row wrap gap8 doctordle-reminder-actions">
          <GButton size="sm" variant="primary" onClick={() => answer("solved")}>Got it</GButton>
          <GButton size="sm" onClick={() => answer("missed")}>Missed it</GButton>
        </div>
      )}
      {step === "play" && (
        <div className="row wrap gap8 doctordle-reminder-actions">
          <a className="gbtn sm primary" href={DOCTORDLE_URL} target="_blank" rel="noopener noreferrer" onClick={() => { recordOpen(); setStep("ask"); }}>
            Open doctordle.org <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" />
          </a>
          <GhostButton onClick={() => { skipToday(); setStep("ask"); }}>Not today</GhostButton>
        </div>
      )}
    </GlassCard>
  );
}
