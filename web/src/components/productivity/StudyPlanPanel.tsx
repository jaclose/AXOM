import { useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { useStore } from "../../lib/store";
import type { StudyAction, StudyPlan } from "../../lib/studyPlan";
import { capturePracticeLaunchContext, launchRecommendedPractice } from "../../lib/exam/practiceLaunch";
import { ICON_SIZE } from "../../lib/iconSize";

const minutesLabel = (minutes: number | undefined): string => minutes ? ` About ${minutes} min at your pace.` : "";

/**
 * Under Up Next: everything else the learner's record supports doing now, each
 * with its reason and the control that starts it, then what AXOM itself
 * recorded today. Up Next stays the one recommendation; this is the rest of
 * the choice, read from the same answers and course work.
 */
export function StudyPlanPanel({ plan }: { plan: StudyPlan }) {
  const questions = useStore((state) => state.questions);
  const context = capturePracticeLaunchContext(questions ?? []);
  const [error, setError] = useState("");
  function start(action: StudyAction) {
    setError("");
    try {
      if (action.launch.type === "practice") launchRecommendedPractice(action.launch.questionIds, context, useStore.getState().questions ?? []);
      else window.location.hash = action.launch.route;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This could not be started. Your saved work is unchanged.");
    }
  }
  const seen = plan.observed;
  const sawAnything = seen.answered + seen.trackerPasses + seen.cardReviews + seen.observedMinutes + seen.reportedMinutes > 0;
  if (!plan.actions.length && !sawAnything && !plan.empty) return null;
  return <section className="study-plan" aria-label="From your record">
    {plan.actions.length > 0 && <>
      <h2 className="study-plan-heading">From your record</h2>
      <ol className="study-plan-then">
        {plan.actions.map((action) => <li key={action.id}>
          <div><h3>{action.title}</h3><p>{action.reason}{minutesLabel(action.minutes)}</p></div>
          <button type="button" className="gbtn sm" onClick={() => start(action)}>{action.actionLabel}</button>
        </li>)}
      </ol>
    </>}
    {error && <p role="alert" className="study-plan-error">{error}</p>}
    {plan.empty && <p className="study-plan-note">AXOM plans from what you do in it. Load a course in <a href="#tracker">Course Tracker</a> or add questions in <a href="#questions">Question Bank</a>, and the next steps appear here with their reasons.</p>}
    {sawAnything && <dl className="study-plan-observed" aria-label="Recorded today">
      <div><dt><Eye size={ICON_SIZE.microInline} aria-hidden="true" /> Recorded by AXOM today</dt>
        <dd>{[
          seen.answered ? `${seen.answered} ${seen.answered === 1 ? "question" : "questions"} answered${seen.accuracy === null ? "" : `, ${seen.accuracy}% correct`}` : "",
          seen.trackerPasses ? `${seen.trackerPasses} course ${seen.trackerPasses === 1 ? "pass" : "passes"}` : "",
          seen.cardReviews ? `${seen.cardReviews} card ${seen.cardReviews === 1 ? "review" : "reviews"}` : "",
          seen.observedMinutes ? `${seen.observedMinutes} min timed` : "",
        ].filter(Boolean).join(" · ") || "Nothing yet"}</dd></div>
      {seen.reportedMinutes > 0 && <div><dt><PenLine size={ICON_SIZE.microInline} aria-hidden="true" /> Logged by you</dt><dd>{seen.reportedMinutes} min</dd></div>}
    </dl>}
  </section>;
}
