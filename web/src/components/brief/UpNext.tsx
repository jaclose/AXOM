// ===========================================================================
// Up next — one suggested step from your real work, plus a smaller one.
// Replaces the Command Brief card. It uses the same ranking engine
// (lib/commandBrief) but sits in one quiet line. It stays out of the way when
// there is nothing real to rank or a session is already running. Nothing
// starts until you press Start.
// ===========================================================================
import { useMemo, useState } from "react";
import { ArrowRight, LifeBuoy, Play, X } from "lucide-react";
import { useStore } from "../../lib/store";
import { assessCommandBriefEvidence, buildCommandBrief } from "../../lib/commandBrief";
import { detectRecoveryTriggers } from "../../lib/recovery";
import { findLiveSession } from "../../lib/sessions";
import { explainLowEnergy, type ReadinessResult } from "../../lib/energy";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { activePrimaryPaths } from "../../lib/trackerFocus";
import { GButton } from "../ui/primitives";
import { RecoveryPanel } from "./RecoveryPanel";
import { ICON_SIZE } from "../../lib/iconSize";

export function UpNext({ readiness, onHide }: { readiness?: ReadinessResult; onHide?: () => void }) {
  const s = useStore();
  const [showWhy, setShowWhy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [fullPlan, setFullPlan] = useState(false);

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

  // Any real evidence is enough; an empty or example-only workspace shows nothing.
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
  }, { manualActivation: true }), [
    s.courses, s.tracker, s.profile.studyWorkflow, s.logs, s.tasks, s.questions, s.documents, s.questionSets,
    s.activeDayKey, s.dayPlans, s.sessions, s.habits, s.habitEntries, dailySuccess, readiness,
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
      evidence.ready, s.tasks, s.tracker, s.profile.primaryTrackerScopes, s.courses, s.profile.studyWorkflow, s.logs, s.boardPrep,
      s.activeDayKey, s.sessions, s.closeouts, s.questions, s.ankiCards, s.dayPlans, dailySuccess, s.habits, s.habitEntries, readiness,
    ],
  );
  const recovery = useMemo(() => brief ? detectRecoveryTriggers(brief.signals) : null, [brief]);

  // The focus dock already shows a running session.
  if (!brief || findLiveSession(s.sessions ?? [])) return null;

  const recoveryDismissedToday = (s.recoveryPlans ?? []).some((plan) =>
    (plan.status === "deferred" || plan.status === "dismissed")
    && (plan.dayKey ?? plan.createdAt.slice(0, 10)) === s.activeDayKey);
  const offerRecovery = Boolean(recovery?.triggered) && !recoveryDismissedToday;
  const lowEnergy = Boolean(readiness && explainLowEnergy(readiness).triggered);
  const { move, minimumViableWin: small } = brief;
  // Low energy leads with the smaller step; the full plan is one click away.
  const leadSmall = lowEnergy && !fullPlan;
  const meta = leadSmall
    ? [`~${small.estimatedMinutes} min`, small.link.context]
    : [`~${move.estimatedMinutes} min`, move.link.context];
  const resources = leadSmall ? [] : move.resources;
  // The button already says Start.
  const title = (leadSmall ? small.title : move.title).replace(/^Start:\s*/, "");
  const ranked = [...(move.contributions ?? [])].sort((a, b) => b.weight - a.weight);

  function start(kind: "move" | "small") {
    if (kind === "move") {
      s.startSession({
        title: move.title,
        link: move.link,
        plannedMinutes: move.estimatedMinutes,
        resources: move.resources,
        reason: move.reason,
        source: "command-brief",
      });
    } else {
      s.startSession({
        title: small.title,
        link: small.link,
        plannedMinutes: small.estimatedMinutes,
        reason: small.reason,
        source: "minimum-viable-win",
      });
    }
  }

  return (
    <section className={`up-next ${showWhy ? "open" : ""}`} aria-labelledby="up-next-label" data-tour="command-brief">
      <span className="up-next-kicker" id="up-next-label">Up next</span>
      <div className="up-next-body">
        <div className="up-next-row">
          <div className="up-next-copy">
            <b className="up-next-title">{title}</b>
            <span className="up-next-meta">
              {meta.filter(Boolean).join(" · ")}
              {resources.length > 0 && <span className="up-next-resources"> · {resources.join(", ")}</span>}
            </span>
          </div>
          <div className="up-next-actions">
            <GButton size="sm" variant="primary" onClick={() => start(leadSmall ? "small" : "move")}>
              <Play size={ICON_SIZE.body} aria-hidden="true" /> Start
            </GButton>
            <button
              type="button"
              className="up-next-link"
              aria-expanded={showWhy}
              aria-controls="up-next-why"
              data-tour="recommendation-provenance"
              onClick={() => setShowWhy((open) => !open)}
            >
              Why?
            </button>
            {onHide && (
              <button type="button" className="up-next-hide" aria-label="Hide Up next" title="Hide (bring it back in Settings)" onClick={onHide}>
                <X size={ICON_SIZE.body} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="up-next-foot">
          {leadSmall ? (
            <>
              <span>Energy is low today, so this starts small.</span>
              <button type="button" className="up-next-link" onClick={() => setFullPlan(true)}>
                Full plan: {move.title} <ArrowRight size={ICON_SIZE.microInline} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button type="button" className="up-next-link" onClick={() => start("small")}>
              Short on time? {small.title} (~{small.estimatedMinutes} min) <ArrowRight size={ICON_SIZE.microInline} aria-hidden="true" />
            </button>
          )}
          {offerRecovery && (
            <button type="button" className="up-next-link recovery" onClick={() => setShowRecovery(true)}>
              <LifeBuoy size={ICON_SIZE.microInline} aria-hidden="true" /> Behind? Make a recovery plan
            </button>
          )}
        </div>

        {showWhy && (
          <div className="up-next-why" id="up-next-why">
            <p>{leadSmall ? small.reason : move.reason}</p>
            {!leadSmall && move.studyPlan && (
              <section aria-label="Study plan used for this suggestion">
                <p><b>Your study plan:</b> {move.studyPlan.summary}</p>
                <p className="sub">Applied in order: {move.studyPlan.sources.join(" → ")}. Change defaults in Settings or override this item in Course Tracker.</p>
              </section>
            )}
            {!leadSmall && ranked.length > 0 && (
              <ul aria-label="Suggestion evidence">
                {ranked.map((contribution) => (
                  <li key={contribution.id}>
                    <span>{contribution.label}</span>
                    <small>{contribution.sourceLabel} · {contribution.weight >= 0 ? "+" : ""}{contribution.weight}</small>
                  </li>
                ))}
              </ul>
            )}
            {!leadSmall && <p className="sub">What success looks like: {move.expectedOutcome}</p>}
          </div>
        )}
      </div>

      {showRecovery && recovery && <RecoveryPanel signals={brief.signals} trigger={recovery} onClose={() => setShowRecovery(false)} />}
    </section>
  );
}
