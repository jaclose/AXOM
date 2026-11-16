import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { getPublicCourse, type PublicCoursePreview } from "../../lib/academicLibrary/publicCatalog";
import { publicPlanPreview, weekIsStated } from "../../lib/academicLibrary/publicPlanPreview";
import { useUi } from "../../lib/uiStore";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton } from "../ui/primitives";

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * What a visitor without an account sees of an offered course: its reviewed
 * weekly plan and question count. Read-only. Loading the course and practising
 * its questions stay account actions, so this view saves nothing.
 */
export function PublicCoursePlan({ course, onBack }: { course: AcademicCourse; onBack: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; preview: PublicCoursePreview | null } | { status: "error"; message: string }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void getPublicCourse(course.id).then(preview => { if (!cancelled) setState({ status: "ready", preview }); })
      .catch(cause => { if (!cancelled) setState({ status: "error", message: cause instanceof Error ? cause.message : "This course could not be opened." }); });
    return () => { cancelled = true; };
  }, [course.id, attempt]);
  const preview = state.status === "ready" ? state.preview : null;
  const plan = useMemo(() => {
    if (!preview) return undefined;
    try { return publicPlanPreview(preview.template_text, preview.term); }
    catch { return { weeks: [], unscheduled: [], activities: 0, tentative: false, unreadable: true }; }
  }, [preview]);
  const shown = preview ?? course;
  const questions = shown.ready_questions;
  const signIn = () => useUi.getState().requestSettings("account");
  return <section className="course-plan" aria-label={`${shown.module} course plan`}>
    <GButton size="sm" onClick={onBack}><ArrowLeft size={ICON_SIZE.body} /> All courses</GButton>
    <div className="course-plan-heading">
      <div className="course-plan-cover" aria-hidden="true"><span>{shown.term}</span><strong>{shown.module}</strong><BookOpen size={40} strokeWidth={1} /></div>
      <div><p className="course-eyebrow">{shown.term}{shown.academic_term ? ` · ${shown.academic_term}` : ""}{shown.cohort ? ` · ${shown.cohort}` : ""}</p><h1 tabIndex={-1}>{shown.module}</h1>
        <p>{shown.title}</p>
        <div className="course-plan-facts">{plan && <><span><b>{plan.weeks.length}</b> {plan.weeks.length === 1 ? "week" : "weeks"}</span><span><b>{plan.activities}</b> {plan.activities === 1 ? "activity" : "activities"}</span></>}
          <span><b>{questions}</b> reviewed {questions === 1 ? "question" : "questions"}</span></div>
      </div>
    </div>
    {state.status === "loading" && <p role="status">Opening the course plan…</p>}
    {state.status === "error" && <div role="alert"><p>{state.message}</p><GButton onClick={() => setAttempt(value => value + 1)}>Retry</GButton></div>}
    {state.status === "ready" && !preview && <p role="status" className="course-empty">This course is no longer offered to visitors. Sign in to see the courses available to your account.</p>}
    {plan && <div className="course-plan-layout">
      <div className="course-week-list">
        <div className="course-section-heading"><h2>Weekly plan</h2></div>
        {plan.unreadable && <p className="course-empty">The weekly plan for this course cannot be shown here yet. Its reviewed questions are still available after you sign in.</p>}
        {!plan.unreadable && plan.activities === 0 && <p className="course-empty">This course is a question collection without a weekly plan.</p>}
        {plan.tentative && <p className="sub">Activities marked tentative are placed by AXOM's ordering. The course plan does not state their week.</p>}
        {plan.weeks.map(week => <article className="course-week" key={week.week}>
          <div className="course-week-heading"><b>Week {week.week}</b><span>{plural(week.items.length, "activity", "activities")}{week.tentative ? ` · ${week.tentative} tentative` : ""}</span></div>
          <details><summary>View activities</summary><ul>{week.items.map(item => <li key={item.templateKey}><span>{item.label}</span><small>{item.kind.replaceAll("-", " ")}{weekIsStated(item) ? "" : " · tentative week"}</small></li>)}</ul></details>
        </article>)}
        {plan.unscheduled.length > 0 && <article className="course-week">
          <div className="course-week-heading"><b>No stated week</b><span>{plural(plan.unscheduled.length, "activity", "activities")}</span></div>
          <p className="sub">The course plan does not place these in a week, so AXOM does not assign one.</p>
          <details><summary>View activities</summary><ul>{plan.unscheduled.map(item => <li key={item.templateKey}><span>{item.label}</span><small>{item.kind.replaceAll("-", " ")}</small></li>)}</ul></details>
        </article>}
      </div>
      <aside className="course-plan-actions" aria-label="Course actions">
        <h2>Make it your course</h2>
        <p>Sign in or create a free account to load this course into your tracker{questions > 0 ? ` and practice its ${plural(questions, "reviewed question", "reviewed questions")}` : ""}. This preview saves nothing on this device.</p>
        <GButton variant="primary" onClick={signIn}>Sign in or create an account</GButton>
        <details><summary>Source and version details</summary>
          <p>Reviewed by an AXOM academic reviewer and offered to visitors.</p>
          {preview?.source_revision && <p>Source revision: {preview.source_revision}</p>}
          {shown.academic_term && <p>Academic term: {shown.academic_term}</p>}
          {shown.cohort && <p>Cohort: {shown.cohort}</p>}
        </details>
      </aside>
    </div>}
  </section>;
}
