// The Daily Check-In (JD, Ideas 4): open by default and in the setup style.
// One intention in the big underlined field, up to three wins, context behind
// a disclosure. Setting it plays a short "Intention set" moment, then the
// intention stays on the page, large, with its underline drawn in. Energy
// orbs sit underneath. Logic moved unchanged from DashboardPage's WinTheDay.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowRightCircle, BookText, Check, Circle, Trophy, X } from "lucide-react";
import { OUTCOMES, isAfterLocalTime, wrapUpMessage } from "../../lib/dailyCheckIn";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { dailyLoopReminderLedger } from "../../lib/dailyLoopReminders";
import { ICON_SIZE } from "../../lib/iconSize";
import { prefersReducedMotion } from "../../lib/motion";
import { prettyDate } from "../../lib/scoring";
import { useStore } from "../../lib/store";
import { useUi } from "../../lib/uiStore";
import { EnergyOrbs } from "../energy/EnergyOrbs";
import { ChoiceSegment } from "../ui/Choice";
import { GButton, GhostButton, GlassCard, Tag } from "../ui/primitives";
import "../../styles/daily-checkin.css";

const COMMITMENT = [1, 2, 3, 4, 5] as const;
/** How long "Intention set" shows before settling into the page. */
const SET_MOMENT_MS = 1800;

/** `writing`: the widget's option for a short note after an energy check. */
export function DailyCheckIn({ writing = false }: { writing?: boolean }) {
  const s = useStore();
  const dailyLoopRequest = useUi((state) => state.dailyLoopRequest);
  const clearDailyLoopRequest = useUi((state) => state.clearDailyLoopRequest);
  const today = s.activeDayKey;
  const todayPlan = s.dayPlans.find((p) => p.dayKey === today);
  const pendingPast = s.dayPlans
    .filter((p) => p.dayKey < today && !p.reviewedAt)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))[0];

  const [intention, setIntention] = useState("");
  const [wins, setWins] = useState("");
  const [note, setNote] = useState("");
  const [expectedMinutes, setExpectedMinutes] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [priority, setPriority] = useState("");
  const [obstacle, setObstacle] = useState("");
  const [commitment, setCommitment] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [showContext, setShowContext] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(() => (
    dailyLoopReminderLedger.read(today).checkIn.disposition === "skipped"
  ));
  const [showWrapPrompt, setShowWrapPrompt] = useState(false);
  const [justSet, setJustSet] = useState(false);

  const openTasks = s.tasks.filter((t) => !t.done && !t.archived).slice(0, 3);
  const reviewDue = isAfterLocalTime(s.profile.journalReviewTime ?? "20:00");
  const selectedTargets = useMemo(
    () => evaluateDailySuccess(s, today, today).requirements
      .filter((item) => item.eligible && item.status !== "unavailable")
      .map((item) => item.requirement.label),
    [s, today],
  );

  useEffect(() => {
    if (todayPlan && !todayPlan.outcome && reviewDue) setShowWrapPrompt(true);
  }, [reviewDue, todayPlan]);

  useEffect(() => {
    setPromptDismissed(dailyLoopReminderLedger.read(today).checkIn.disposition === "skipped");
    setIntention("");
    setWins("");
    setNote("");
    setExpectedMinutes("");
    setPersonalNote("");
    setPriority("");
    setObstacle("");
    setCommitment(3);
    setShowContext(false);
    setShowWrapPrompt(false);
  }, [today]);

  useEffect(() => {
    if (dailyLoopRequest?.kind !== "check-in" || dailyLoopRequest.dayKey !== today) return;
    setPromptDismissed(false);
    clearDailyLoopRequest();
  }, [clearDailyLoopRequest, dailyLoopRequest, today]);

  useEffect(() => {
    if (!justSet) return;
    const timer = window.setTimeout(() => setJustSet(false), prefersReducedMotion() ? 900 : SET_MOMENT_MS);
    return () => window.clearTimeout(timer);
  }, [justSet]);

  function save() {
    if (!intention.trim()) return;
    s.setDayPlan(
      today,
      intention.trim(),
      wins.split("\n").map((w) => w.trim()).filter(Boolean).slice(0, 3),
      {
        expectedStudyMinutes: expectedMinutes ? Math.max(0, Number(expectedMinutes) || 0) : undefined,
        personalNote: personalNote.trim() || undefined,
        priority: priority.trim() || undefined,
        anticipatedObstacle: obstacle.trim() || undefined,
        commitmentLevel: commitment,
      },
    );
    dailyLoopReminderLedger.markShown(today, "check-in");
    setIntention(""); setWins("");
    setJustSet(true);
  }

  function useTargets() {
    if (!selectedTargets.length) {
      location.hash = "productivity";
      return;
    }
    s.setDayPlan(today, "Complete today’s chosen targets", selectedTargets.slice(0, 3), { commitmentLevel: commitment });
    dailyLoopReminderLedger.markShown(today, "check-in");
    setJustSet(true);
  }

  /** Back to the form with today's words in it, ready to edit. */
  function changeIntention() {
    if (!todayPlan) return;
    setIntention(todayPlan.intention);
    setWins(todayPlan.wins.join("\n"));
    s.setDayPlan(today, "", []);
  }

  function skipCheckIn() {
    dailyLoopReminderLedger.skip(today, "check-in");
    setPromptDismissed(true);
  }

  return (
    <GlassCard pad className="win-day daily-checkin" data-tour="intention">
      {showWrapPrompt && todayPlan && !todayPlan.outcome && (
        <div className="journal-wrap-popover">
          <button className="ghost-btn" onClick={() => setShowWrapPrompt(false)} title="Dismiss"><X size={ICON_SIZE.body} /></button>
          <div className="journal-wrap-mark"><BookText size={ICON_SIZE.emphasis} /></div>
          <div>
            <b>Wrap up the day</b>
            <span>{wrapUpMessage(today)} Review “{todayPlan.intention}”, then turn it into a useful standup.</span>
          </div>
          <a className="gbtn sm primary" href="#journal">Open Journal</a>
        </div>
      )}
      {pendingPast && (
        <div className="carry-over">
          <ArrowRightCircle size={ICON_SIZE.emphasis} />
          <div className="grow">
            <b>You planned {prettyDate(`${pendingPast.dayKey}T12:00:00`)} but never closed it out.</b>
            <span>“{pendingPast.intention}”. Did you get it done?</span>
          </div>
          <div className="row gap6">
            {OUTCOMES.map((o) => (
              <button key={o.key} className={`gbtn tiny ${o.tone === "green" ? "primary" : ""}`}
                onClick={() => s.reviewDayPlan(pendingPast.dayKey, o.key)}>{o.label}</button>
            ))}
          </div>
        </div>
      )}

      {!todayPlan && promptDismissed ? (
        <div className="daily-checkin-collapsed">
          <div>
            <div className="panel-title">Daily Check-In</div>
            <div className="panel-sub">Optional. Add direction whenever it would help.</div>
          </div>
          <GButton size="sm" onClick={() => setPromptDismissed(false)}>Open check-in</GButton>
        </div>
      ) : !todayPlan ? (
        <form className="daily-checkin-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="daily-checkin-head">
            <span className="setup-eyebrow">Daily check-in</span>
            <h3>What would make today count?</h3>
          </div>
          <label className="setup-name daily-checkin-intention">
            <span>Primary intention</span>
            <input value={intention} maxLength={160} placeholder="e.g. Finish the renal review before lunch" onChange={(e) => setIntention(e.target.value)} />
          </label>
          <label className="setup-inline-field">
            <span>One to three win conditions (optional)</span>
            <textarea rows={2} placeholder="One per line" value={wins} onChange={(e) => setWins(e.target.value)} />
          </label>
          <details className="setup-more daily-checkin-context" open={showContext} onToggle={(event) => setShowContext(event.currentTarget.open)}>
            <summary>Add context (optional)</summary>
            <div className="daily-checkin-context-grid">
              <label className="setup-inline-field"><span>Expected study block</span><input type="number" min="0" inputMode="numeric" placeholder="minutes" value={expectedMinutes} onChange={(event) => setExpectedMinutes(event.target.value)} /></label>
              <label className="setup-inline-field"><span>Priority course or topic</span><input value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
              <label className="setup-inline-field"><span>Anticipated obstacle</span><input value={obstacle} onChange={(event) => setObstacle(event.target.value)} /></label>
              <label className="setup-inline-field"><span>Personal note</span><input value={personalNote} onChange={(event) => setPersonalNote(event.target.value)} /></label>
              <div className="setup-followup">
                <span className="setup-label">Commitment level</span>
                <ChoiceSegment label="Commitment level" options={COMMITMENT.map((level) => ({ value: level, label: level }))} value={commitment} onChange={setCommitment} />
              </div>
            </div>
          </details>
          <div className="daily-checkin-actions">
            <button type="submit" className="setup-next" disabled={!intention.trim()}>
              <span>Set today’s focus</span>
              <span className="setup-next-icon" aria-hidden="true"><ArrowRight size={ICON_SIZE.body} /></span>
            </button>
            <GButton onClick={useTargets}>Use my targets</GButton>
            <GhostButton onClick={skipCheckIn}>Skip for now</GhostButton>
          </div>
        </form>
      ) : (
        <>
          <div className="daily-checkin-set">
            <div className="daily-checkin-set-head">
              <span className="setup-eyebrow">Today’s intention</span>
              {todayPlan.outcome
                ? <Tag tone={OUTCOMES.find((o) => o.key === todayPlan.outcome)?.tone ?? "neutral"}>
                    <Trophy size={ICON_SIZE.microInline} /> {OUTCOMES.find((o) => o.key === todayPlan.outcome)?.label}
                  </Tag>
                : <button type="button" className="daily-checkin-change" onClick={changeIntention}>Change</button>}
            </div>
            <p className={`daily-checkin-intent ${justSet ? "is-new" : ""}`}>
              <span>{todayPlan.intention}</span>
              <svg viewBox="0 0 320 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path pathLength={1} d="M2 8c50-6 100-6 150-2 55 4 110 4 166-3" />
              </svg>
            </p>
            {justSet && <span className="daily-checkin-logged" role="status"><Check size={ICON_SIZE.microInline} strokeWidth={2.5} aria-hidden="true" /> Intention set</span>}
          </div>

          {todayPlan.wins.length > 0 && (
            <div className="win-conditions">
              {todayPlan.wins.map((w, i) => <span key={i} className="win-cond"><Check size={ICON_SIZE.microInline} /> {w}</span>)}
            </div>
          )}

          {(todayPlan.priority || todayPlan.expectedStudyMinutes || todayPlan.anticipatedObstacle) && (
            <div className="daily-checkin-snapshot">
              {todayPlan.priority && <span><b>Priority</b>{todayPlan.priority}</span>}
              {todayPlan.expectedStudyMinutes ? <span><b>Expected block</b>{todayPlan.expectedStudyMinutes} min</span> : null}
              {todayPlan.anticipatedObstacle && <span><b>Watch for</b>{todayPlan.anticipatedObstacle}</span>}
            </div>
          )}

          {openTasks.length > 0 && (
            <div className="win-tasks">
              <div className="field-label" style={{ marginBottom: 6 }}>Check off as you go</div>
              {openTasks.map((t) => (
                <button key={t.id} className="win-task" onClick={() => s.toggleTask(t.id)}>
                  <Circle size={ICON_SIZE.body} /> <span className="win-task-title">{t.title}</span>
                  {t.scope && <Tag tone="neutral">{t.scope}</Tag>}
                </button>
              ))}
            </div>
          )}

          {!todayPlan.outcome && (
            <div className="win-review">
              <input className="field grow" placeholder="End-of-day note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {OUTCOMES.map((o) => (
                <GButton key={o.key} size="sm" variant={o.tone === "green" ? "primary" : "default"}
                  onClick={() => s.reviewDayPlan(today, o.key, note.trim() || undefined)}>{o.label}</GButton>
              ))}
            </div>
          )}
          {!todayPlan.outcome && reviewDue && (
            <div className="journal-follow-nudge">
              <BookText size={ICON_SIZE.body} />
              <span>It is past your journal follow-up time. Review today’s intention, then write the standup.</span>
              <a className="gbtn tiny" href="#journal">Open Journal</a>
            </div>
          )}
          {todayPlan.outcome && (
            <div className="row gap8" style={{ marginTop: 10 }}>
              <GhostButton onClick={() => s.reviewDayPlan(today, undefined)} title="Re-open review"><ArrowRight size={ICON_SIZE.body} /></GhostButton>
              <span className="sub">Reviewed{todayPlan.reviewNote ? `: “${todayPlan.reviewNote}”` : ""}. Want to log it as a standup? Open Journal.</span>
            </div>
          )}
        </>
      )}

      <div className="daily-checkin-energy">
        <EnergyOrbs writing={writing} />
      </div>
    </GlassCard>
  );
}
