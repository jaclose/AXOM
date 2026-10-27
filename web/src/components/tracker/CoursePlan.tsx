import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, Play } from "lucide-react";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import type { QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { loadPreparedCourse } from "../../lib/bookshelf/preparedCourses";
import type { SaveOutcome } from "../../lib/bookshelf/loadCourse";
import { courseQuizSelection, launchCourseQuiz } from "../../lib/course-engine/quizLaunch";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton } from "../ui/primitives";

export function CoursePlan({ book, bank, availableQuestions, onBack, onOpen, onCustomize, onLoad }: {
  book: CourseBook; bank?: QuestionBankBook; onBack: () => void;
  onOpen: (book: CourseBook) => void; onCustomize: (book: CourseBook) => void;
  onLoad?: (weeks: number[]) => Promise<SaveOutcome>;
  availableQuestions?: number;
}) {
  const [weeks, setWeeks] = useState(() => book.weeks.map(week => week.week));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const selectedCount = useMemo(() => book.weeks.filter(week => weeks.includes(week.week)).reduce((sum, week) => sum + week.total, 0), [book, weeks]);
  const loaded = book.templateIds?.length ? (book.loadedActivities ?? 0) > 0 : book.origin === "workspace" && book.count > 0;
  async function load() {
    setBusy(true); setError(""); setNotice("");
    try {
      const outcome = await (onLoad ? onLoad(weeks) : loadPreparedCourse(book, weeks));
      if (outcome.status === "failed") setError(outcome.message);
      else setNotice(outcome.status === "nothing-to-save" ? "These activities are already in My Courses. Your progress is preserved." : "Course added to My Courses. Your existing progress and notes are preserved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The course could not be saved. Try again."); }
    finally { setBusy(false); }
  }
  function quiz(week?: number) {
    if (!bank) return;
    setError("");
    try { launchCourseQuiz(courseQuizSelection(bank, week)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The quiz could not be opened."); }
  }
  return <section className="course-plan" aria-label={`${book.module} course plan`}>
    <GButton size="sm" onClick={onBack}><ArrowLeft size={ICON_SIZE.body} /> All courses</GButton>
    <div className="course-plan-heading">
      <div className="course-plan-cover" aria-hidden="true"><span>{book.term}</span><strong>{book.module}</strong><BookOpen size={40} strokeWidth={1} /></div>
      <div><p className="course-eyebrow">{book.term}{book.academicContext?.academicTerm ? ` · ${book.academicContext.academicTerm}` : book.courseCode && !book.courseCode.startsWith("academic:") ? ` · ${book.courseCode}` : ""}</p><h1 tabIndex={-1}>{book.module}</h1>
        <p>{book.courseName || "Your weekly course plan"}</p>
        <div className="course-plan-facts"><span><b>{book.weeks.length}</b> weeks</span><span><b>{book.count}</b> activities</span>{bank
          ? <span><b>{bank.ready}</b> locally answer-ready</span>
          : <span><b>{availableQuestions ?? 0}</b> reviewed available to download</span>}</div>
        {loaded && <p className="course-activation"><Check size={ICON_SIZE.body} /> In My Courses{book.loadedActivities !== undefined ? ` · ${book.loadedActivities} activities loaded` : ""}</p>}
      </div>
    </div>
    <div className="course-plan-layout">
      <div className="course-week-list">
        <div className="course-section-heading"><h2>Weekly plan</h2>{book.weeks.length > 0 && <GButton size="sm" onClick={() => setWeeks(weeks.length === book.weeks.length ? [] : book.weeks.map(week => week.week))}>{weeks.length === book.weeks.length ? "Clear selection" : "Select all weeks"}</GButton>}</div>
        {!book.weeks.length && <p className="course-empty">The weekly plan is not available yet. Your existing activities remain in My Courses.</p>}
        {book.weeks.map(week => {
          const ready = bank ? courseQuizSelection(bank, week.week).questionIds.length : 0;
          return <article className="course-week" key={week.week}>
            <div className="course-week-heading"><label><input type="checkbox" checked={weeks.includes(week.week)} onChange={event => setWeeks(current => event.target.checked ? [...current, week.week] : current.filter(number => number !== week.week))} /><b>Week {week.week}</b></label><span>{week.total} {week.total === 1 ? "activity" : "activities"}</span></div>
            {book.academicContext?.weekDates[week.week] && <p className="course-week-dates">{book.academicContext.weekDates[week.week]}</p>}
            <p className="sub">{week.activities.map(activity => activity.label).join(" · ")}</p>
            <details><summary>View activities <span>{week.done} completed</span></summary><ul>{week.items.map(item => <li key={item.id}><span>{item.label}</span><small>{item.kind.replaceAll("-", " ")}</small></li>)}</ul></details>
            <div className="course-week-practice"><span>{ready ? `${ready} ready questions` : !bank && availableQuestions ? "Load Course to open its reviewed question sets" : "No reviewed questions mapped to this week"}</span>{ready > 0 && <GButton size="sm" onClick={() => quiz(week.week)}><Play size={ICON_SIZE.body} /> Quiz week {week.week}</GButton>}</div>
          </article>;
        })}
        {book.unfiled > 0 && <p className="course-empty">{book.unfiled} activities have no confirmed week. Review them in Customize Weeks & Activities before assigning a week.</p>}
      </div>
      <aside className="course-plan-actions" aria-label="Course actions">
        <h2>Make it your course</h2><p>{selectedCount} activities in {weeks.length} selected weeks. Loading adds missing activities and preserves your completed work, notes and personal edits.</p>
        <GButton variant="primary" onClick={() => void load()} disabled={busy || !book.templateIds?.length || !weeks.length || book.term === "Term unconfirmed"}>{busy ? "Saving course…" : "Load Course"}</GButton>
        {loaded && <GButton onClick={() => onOpen(book)}>Open Course / Continue</GButton>}
        <GButton onClick={() => onCustomize(book)}>Customize Weeks &amp; Activities</GButton>
        <div className="course-practice-action"><h3>Study this course</h3><p>{bank?.ready ? `${bank.ready} reviewed questions from this course. Questions without a confirmed week stay in the course scope.` : availableQuestions ? `Load Course to download ${availableQuestions} reviewed questions and their images.` : "No reviewed question set is ready for this course yet."}</p><GButton onClick={() => quiz()} disabled={!bank?.ready}><Play size={ICON_SIZE.body} /> Create Quiz</GButton></div>
        {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{notice}</p>
        <details><summary>Source and version details</summary><p>{book.templateIds?.length ? `${book.templateIds.length} saved template sections` : "No saved course template"}</p>{book.academicContext?.sourceRevision && <p>Source revision: {book.academicContext.sourceRevision}</p>}{book.academicContext?.cohort && <p>Cohort: {book.academicContext.cohort}</p>}{book.templateVersion && <p className="course-version">{book.templateVersion}</p>}<p>Import time does not establish academic currency. Unconfirmed week mappings require source review.</p></details>
      </aside>
    </div>
  </section>;
}
