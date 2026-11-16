import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useStore } from "../../lib/store";
import { buildStudyPlan, type StudyAction, type StudyActionKind } from "../../lib/studyPlan";
import { capturePracticeLaunchContext, launchRecommendedPractice } from "../../lib/exam/practiceLaunch";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/record-review.css";

const QUIZ_KINDS: readonly StudyActionKind[] = ["sure-and-wrong", "retry-missed", "new-questions", "flagged"];

/**
 * Practice blocks read from the learner's own record: confident misses, misses
 * by module, unanswered questions in the course in progress, and flags. Each
 * block starts the Question Bank runner with exactly the questions it names.
 * The same plan drives Productivity, so the three screens never disagree.
 * Renders nothing until the record supports at least one block.
 */
export function RecordReview({ title, sub, limit = 6, compact = false }: { title: string; sub: string; limit?: number; compact?: boolean }) {
  const state = useStore();
  const [error, setError] = useState("");
  const context = capturePracticeLaunchContext(state.questions ?? []);
  const actions = useMemo(() => buildStudyPlan(state, new Date(), null, { kinds: QUIZ_KINDS, limit, everyMissedModule: true }).actions, [state, limit]);
  if (!actions.length) return null;
  function start(action: StudyAction) {
    setError("");
    if (action.launch.type !== "practice") return;
    try { launchRecommendedPractice(action.launch.questionIds, context, useStore.getState().questions ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This block could not be started. Your saved work is unchanged."); }
  }
  return <section className={`record-review${compact ? " compact" : ""}`} aria-label={title}>
    <header><span className="record-review-eyebrow">From your record</span><h3>{title}</h3><p>{sub}</p></header>
    <ul>
      {actions.map((action) => <li key={action.id}>
        <button type="button" className="record-review-card" onClick={() => start(action)}>
          <b>{action.title}</b>
          {!compact && <small>{action.reason}</small>}
          <span>{action.minutes ? `About ${action.minutes} min` : "Exact questions, nothing mixed in"}<i>{action.actionLabel} <ArrowRight size={ICON_SIZE.microInline} aria-hidden="true" /></i></span>
        </button>
      </li>)}
    </ul>
    {error && <p role="alert" className="record-review-error">{error}</p>}
  </section>;
}
