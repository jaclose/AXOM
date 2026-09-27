// ===========================================================================
// Command Brief — the primary dashboard section (directive §1). One mode, one
// next best move, one fallback win, and a factual delta since yesterday.
// Rules-driven today (lib/commandBrief); AI proposals plug in later through
// the same schema, always behind user review.
// ===========================================================================
import { useMemo, useState } from "react";
import { Play, Zap, LifeBuoy, ClipboardCheck, ChevronDown, ChevronUp, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { useStore } from "../../lib/store";
import {
  assessCommandBriefEvidence,
  buildCommandBrief,
  MODE_LABEL,
  type BriefMode,
  type BriefStarterDestination,
} from "../../lib/commandBrief";
import { detectRecoveryTriggers } from "../../lib/recovery";
import { findLiveSession } from "../../lib/sessions";
import { closeoutForDay } from "../../lib/closeout";
import { GlassCard, GButton, GhostButton, Tag } from "../ui/primitives";
import { CloseoutModal } from "./CloseoutModal";
import { RecoveryPanel } from "./RecoveryPanel";
import { explainLowEnergy, type ReadinessResult } from "../../lib/energy";
import { gotoJournalDay } from "../../lib/uiStore";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { ICON_SIZE } from "../../lib/iconSize";
import { activePrimaryPaths } from "../../lib/trackerFocus";

const MODE_TONE: Record<BriefMode, "cyan" | "green" | "purple" | "orange" | "red" | "neutral"> = {
  maintain: "green",
  "catch-up": "orange",
  recovery: "purple",
  sprint: "cyan",
  "exam-week": "red",
};

export function CommandBrief({ readiness }: { readiness?: ReadinessResult }) {
  const s = useStore();
  const [showCloseout, setShowCloseout] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [showEnergyCalculation, setShowEnergyCalculation] = useState(false);
  const [energyPreviewDismissed, setEnergyPreviewDismissed] = useState(false);
  const [manualActivation, setManualActivation] = useState(false);
  const dailySuccess = useMemo(() => evaluateDailySuccess({
    profile: s.profile,
    logs: s.logs,
    productivityTrackers: s.productivityTrackers,
    habits: s.habits ?? [],
    habitEntries: s.habitEntries ?? [],
    closeouts: s.closeouts ?? [],
    activeDayKey: s.activeDayKey,
  }, s.activeDayKey, s.activeDayKey), [
    s.profile, s.logs, s.productivityTrackers, s.habits, s.habitEntries, s.closeouts, s.activeDayKey,
  ]);

  const evidence = useMemo(() => assessCommandBriefEvidence({
    courses: s.courses,
    tracker: s.tracker,
    studyWorkflow: s.profile.studyWorkflow,
    logs: s.logs,
    tasks: s.tasks,
    questions: s.questions ?? [],
    documents: s.documents ?? [],
    questionSets: s.questionSets ?? [],
    activeDayKey: s.activeDayKey,
    dayPlans: s.dayPlans ?? [],
    sessions: s.sessions ?? [],
    dailySuccess,
    habits: s.habits ?? [],
    habitEntries: s.habitEntries ?? [],
    readiness,
  }, { manualActivation }), [
    s.courses, s.tracker, s.profile.studyWorkflow, s.logs, s.tasks, s.questions, s.documents, s.questionSets,
    s.activeDayKey, s.dayPlans, s.sessions, s.habits, s.habitEntries, dailySuccess, readiness, manualActivation,
  ]);
  const brief = useMemo(
    () => evidence.ready ? buildCommandBrief({
      tasks: s.tasks,
      tracker: s.tracker,
      primaryScopes: activePrimaryPaths(s.profile.primaryTrackerScopes, s.activeDayKey),
      courses: s.courses,
      studyWorkflow: s.profile.studyWorkflow,
      logs: s.logs,
      boardPrep: s.boardPrep,
      activeDayKey: s.activeDayKey,
      sessions: s.sessions ?? [],
      closeouts: s.closeouts ?? [],
      questions: s.questions ?? [],
      ankiCards: s.ankiCards ?? [],
      dayPlans: s.dayPlans ?? [],
      dailySuccess,
      habits: s.habits ?? [],
      habitEntries: s.habitEntries ?? [],
      readiness,
    }) : null,
    [
      evidence.ready, s.tasks, s.tracker, s.profile.primaryTrackerScopes, s.courses, s.profile.studyWorkflow, s.logs, s.boardPrep, s.activeDayKey, s.sessions,
      s.closeouts, s.questions, s.ankiCards, s.dayPlans, dailySuccess, s.habits, s.habitEntries, readiness,
    ],
  );
  const recovery = useMemo(() => brief ? detectRecoveryTriggers(brief.signals) : null, [brief]);
  const recoveryDismissedToday = (s.recoveryPlans ?? []).some((plan) =>
    (plan.status === "deferred" || plan.status === "dismissed")
    && (plan.dayKey ?? plan.createdAt.slice(0, 10)) === s.activeDayKey);
  const energy = readiness ? explainLowEnergy(readiness) : null;
  const liveSession = findLiveSession(s.sessions ?? []);
  const todayCloseout = closeoutForDay(s.closeouts ?? [], s.activeDayKey);

  if (!brief) {
    return (
      <CommandBriefLearningState
        evidence={evidence}
        onManualActivation={() => setManualActivation(true)}
      />
    );
  }
  const readyBrief = brief;
  const limitedConfidence = evidence.activation === "manual";

  function begin(kind: "move" | "mvw") {
    const target = kind === "move" ? readyBrief.move : undefined;
    if (target) {
      s.startSession({
        title: target.title,
        link: target.link,
        plannedMinutes: target.estimatedMinutes,
        resources: target.resources,
        reason: target.reason,
        source: "command-brief",
      });
    } else {
      s.startSession({
        title: readyBrief.minimumViableWin.title,
        link: readyBrief.minimumViableWin.link,
        plannedMinutes: readyBrief.minimumViableWin.estimatedMinutes,
        reason: readyBrief.minimumViableWin.reason,
        source: "minimum-viable-win",
      });
    }
  }

  return (
    <GlassCard className="brief" data-tour="command-brief">
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="brief-kicker">Current state</div>
          <div className="row" style={{ gap: 10 }}>
            <span className="h-section">Command Brief</span>
            <Tag tone={MODE_TONE[brief.mode]}>{MODE_LABEL[brief.mode]}</Tag>
            {limitedConfidence && <Tag tone="orange">Limited confidence</Tag>}
          </div>
          <div className="sub" style={{ maxWidth: 640 }}>
            {limitedConfidence ? `${brief.modeReason} AXOM is using only the evidence currently available.` : brief.modeReason}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {recovery?.triggered && !recoveryDismissedToday && (
            <GButton size="sm" onClick={() => setShowRecovery(true)}>
              <LifeBuoy size={ICON_SIZE.body} /> Recovery plan
            </GButton>
          )}
          <GButton size="sm" variant={todayCloseout ? "default" : "primary"} onClick={() => setShowCloseout(true)}>
            <ClipboardCheck size={ICON_SIZE.body} /> {todayCloseout ? "Closeout ✓" : "Daily closeout"}
          </GButton>
        </div>
      </div>

      {energy?.triggered && !energyPreviewDismissed && (
        <section className="backup-actions-panel" aria-labelledby="low-energy-title">
          <div>
            <h3 className="sync-title" id="low-energy-title" style={{ margin: 0 }}>Lower-energy option</h3>
            <div className="sub">
              {energy.trigger}: <b>{energy.currentValue}/100</b>; suggestion threshold: <b>{energy.threshold}/100</b>.
              AXOM is showing a smaller-work preview because this value is below the threshold.
            </div>
          </div>
          <div className="sub"><b>Suggested adjustment:</b> {energy.adjustment} {energy.recommendation}</div>
          <div className="sub"><b>Still unchanged:</b> {energy.unchanged.join(", ")}. Nothing was silently edited.</div>
          {showEnergyCalculation && (
            <div className="stack gap6" aria-label="Energy calculation">
              <div className="sub">Baseline {readiness?.baseline}/100 + confirmed impacts {readiness?.totalImpact ?? 0} = estimated readiness {readiness?.estimatedReadiness}/100.</div>
              {energy.contributions.length ? energy.contributions.map((contribution) => (
                <div className="sub" key={`${contribution.label}-${contribution.value}`}>
                  <b>{contribution.label} {contribution.value > 0 ? "+" : ""}{contribution.value}</b> · {contribution.explanation}
                </div>
              )) : <div className="sub">The trigger came from today’s self-reported energy; no additional negative factors were applied.</div>}
              {(readiness?.possibleSignals.length ?? 0) > 0 && <div className="sub">Possible journal-language signals are excluded until you confirm them.</div>}
            </div>
          )}
          <div className="row wrap gap8">
            <GButton size="sm" variant="primary" onClick={() => document.querySelector<HTMLElement>(".brief-mvw")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              Review adjusted plan
            </GButton>
            <GButton size="sm" onClick={() => setEnergyPreviewDismissed(true)}>Restore original plan</GButton>
            <GButton size="sm" onClick={() => gotoJournalDay(s.activeDayKey)}>Update energy</GButton>
            <GhostButton aria-expanded={showEnergyCalculation} onClick={() => setShowEnergyCalculation((shown) => !shown)}>
              {showEnergyCalculation ? <ChevronUp size={ICON_SIZE.microInline} /> : <ChevronDown size={ICON_SIZE.microInline} />} Show calculation
            </GhostButton>
          </div>
        </section>
      )}

      <div className="brief-body">
        <div className="brief-move">
          <div className="brief-kicker">Next best move</div>
          <div className="brief-title">{brief.move.title}</div>
          <div className="brief-meta">
            ~{brief.move.estimatedMinutes} min
            {brief.move.link.context ? ` · ${brief.move.link.context}` : ""}
            {brief.move.resources.length > 0 ? ` · ${brief.move.resources.join(", ")}` : ""}
          </div>
          <div className="brief-why dim">
            <b>What success looks like:</b> {brief.move.expectedOutcome}
          </div>
          <details className="brief-provenance" data-tour="recommendation-provenance">
            <summary>Why this suggestion?</summary>
            <p>{brief.move.reason}</p>
            {brief.move.studyPlan && (
              <section aria-label="Study plan used for this suggestion">
                <p><b>Your study plan:</b> {brief.move.studyPlan.summary}</p>
                <p className="sub">Applied in order: {brief.move.studyPlan.sources.join(" → ")}. Change defaults in Settings or override this item in Course Tracker.</p>
              </section>
            )}
            {(brief.move.contributions?.length ?? 0) > 0 && (
              <>
                <div className="brief-evidence-score">Evidence score: {brief.move.score}</div>
                <ul aria-label="Suggestion evidence">
                  {brief.move.contributions?.map((contribution) => (
                    <li key={contribution.id}>
                      <span>{contribution.label}</span>
                      <small>{contribution.sourceLabel} · {contribution.weight >= 0 ? "+" : ""}{contribution.weight}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {limitedConfidence && evidence.rankedEvidence.length > 0 && (
              <>
                <div className="brief-evidence-score">Available evidence</div>
                <ul aria-label="Available limited-confidence evidence">
                  {evidence.rankedEvidence.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <span>{item.label}</span>
                      <small>{item.sourceLabel} · {item.count}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            {liveSession ? (
              <span className="sub">A session is already running below — finish or park it first.</span>
            ) : (
              <GButton variant="primary" onClick={() => begin("move")}>
                <Play size={ICON_SIZE.body} /> Begin Session
              </GButton>
            )}
          </div>
        </div>

        <div className="brief-side">
          <div className="brief-mvw">
            <div className="brief-kicker"><Zap size={ICON_SIZE.microInline} style={{ marginRight: 4 }} />Alternate small win</div>
            <div className="brief-mvw-title">{brief.minimumViableWin.title}</div>
            <div className="sub">{brief.minimumViableWin.reason}</div>
            {!liveSession && (
              <GhostButton onClick={() => begin("mvw")} style={{ marginTop: 8 }}>
                Do the small win (~{brief.minimumViableWin.estimatedMinutes} min)
              </GhostButton>
            )}
          </div>

          <div className="brief-changes">
            <button className="brief-kicker as-button" onClick={() => setShowChanges((v) => !v)}>
              Since yesterday {showChanges ? <ChevronUp size={ICON_SIZE.microInline} /> : <ChevronDown size={ICON_SIZE.microInline} />}
            </button>
            {showChanges && (
              <ul className="brief-change-list">
                {brief.changes.map((c, i) => (
                  <li key={i} className={`brief-change ${c.tone}`}>
                    <span className="brief-change-label">{c.label}</span>
                    <span>{c.value}</span>
                  </li>
                ))}
                {brief.changes.length === 0 && <li className="sub">Nothing logged yet — today writes the first entry.</li>}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showCloseout && <CloseoutModal onClose={() => setShowCloseout(false)} />}
      {showRecovery && recovery && <RecoveryPanel signals={brief.signals} trigger={recovery} onClose={() => setShowRecovery(false)} />}
    </GlassCard>
  );
}

function CommandBriefLearningState({
  evidence,
  onManualActivation,
}: {
  evidence: ReturnType<typeof assessCommandBriefEvidence>;
  onManualActivation: () => void;
}) {
  const readyIds = new Set(evidence.rankedEvidence.map((item) => item.id));
  const checklist: StarterChecklistItem[] = [
    {
      id: "work",
      title: "Add or import one real study item",
      explanation: "Gives AXOM concrete work it can rank; shipped examples never count.",
      ready: evidence.workload.ready,
      label: evidence.starter?.actionLabel ?? "Open Course Tracker",
      destination: evidence.starter?.destination ?? "tracker",
    },
    {
      id: "intention",
      title: "Set today’s intention",
      explanation: "Adds the outcome you want AXOM to protect today.",
      ready: readyIds.has("day-intention"),
      label: "Set today’s focus",
      destination: "dashboard",
      focusSelector: '[data-tour="intention"] input',
    },
    {
      id: "activity",
      title: "Start a timer or log an activity",
      explanation: "Adds current context without requiring a placeholder task.",
      ready: readyIds.has("focus-session") || readyIds.has("activity-log"),
      label: "Open Productivity",
      destination: "productivity",
    },
    {
      id: "practice",
      title: "Optional: import or answer practice questions",
      explanation: "Trusted due questions can become a grounded review action.",
      ready: readyIds.has("question-practice") || readyIds.has("due-questions") || readyIds.has("trusted-questions"),
      label: "Open Question Bank",
      destination: "questions",
      optional: true,
    },
  ];
  const completed = checklist.filter((item) => item.ready && !item.optional).length;

  return (
    <GlassCard className="brief brief-learning" data-tour="command-brief">
      <div className="row wrap gap8">
        <h2 className="h-section" style={{ margin: 0 }}>Command Brief</h2>
        <Tag tone="neutral">Learning</Tag>
      </div>
      <p className="brief-learning-title">{evidence.starter?.title ?? "AXOM is learning your current workload."}</p>
      <p className="sub">{evidence.starter?.explanation ?? "Recommendations stay neutral until your workspace has real evidence."}</p>
      <div className="sr-only" role="status" aria-live="polite">{completed} of 3 setup signals ready</div>
      <ul className="brief-starter-list" aria-label="Command Brief starter checklist" data-tour="recommendation-provenance">
        {checklist.map((item) => <StarterChecklistRow key={item.id} item={item} />)}
      </ul>
      {evidence.canActivateManually && (
        <div className="brief-manual-activation">
          <div>
            <b>Want a first recommendation now?</b>
            <p>{evidence.manualActivationReason}</p>
          </div>
          <GButton size="sm" onClick={onManualActivation}>Use Command Brief now</GButton>
        </div>
      )}
    </GlassCard>
  );
}

interface StarterChecklistItem {
  id: string;
  title: string;
  explanation: string;
  ready: boolean;
  label: string;
  destination: BriefStarterDestination | "dashboard";
  focusSelector?: string;
  optional?: boolean;
}

function StarterChecklistRow({ item }: { item: StarterChecklistItem }) {
  const descriptionId = `brief-starter-${item.id}-description`;

  function queueFocus() {
    if (!item.focusSelector) return;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(item.focusSelector!);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
    }, 0);
  }

  return (
    <li className={item.ready ? "ready" : "needed"}>
      {item.ready
        ? <CheckCircle2 size={ICON_SIZE.emphasis} aria-hidden="true" />
        : <Circle size={ICON_SIZE.emphasis} aria-hidden="true" />}
      <div>
        <div className="spread gap8">
          <b>{item.title}</b>
          <span>{item.ready ? "Ready" : item.optional ? "Optional" : "Next"}</span>
        </div>
        <small id={descriptionId}>{item.explanation}</small>
      </div>
      {!item.ready && (
        <a
          className="brief-starter-action"
          href={`#${item.destination}`}
          aria-describedby={descriptionId}
          onClick={queueFocus}
        >
          {item.label}<ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
        </a>
      )}
    </li>
  );
}
