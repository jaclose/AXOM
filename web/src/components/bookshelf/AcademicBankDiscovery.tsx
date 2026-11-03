import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, RefreshCw } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { useAcademicCatalog } from "../../lib/academicLibrary/useAcademicCatalog";
import { openAcademicCourse } from "../../lib/academicLibrary/navigation";
import { coursesByTerm } from "../../lib/academicLibrary/catalogOrder";
import { ConnectedCoursePlan } from "../tracker/ConnectedCoursePlan";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import "../../styles/course-library.css";

/** QBank and Course Library discover the same permissioned collection. */
export function AcademicBankDiscovery() {
  const accountId = useAccount(state => state.user?.id);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ accountId: string; course: AcademicCourse }>();
  const detail = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const hadSelection = useRef(false);
  const catalog = useAcademicCatalog(accountId, query, "");
  const selectedCourse = selected && accountId && selected.accountId === accountId ? selected.course : undefined;
  const course = selectedCourse
    ? catalog.courses.find(entry => entry.id === selectedCourse.id) ?? selectedCourse
    : undefined;
  const selectedCourseId = course?.id;
  useEffect(() => { setSelected(undefined); }, [accountId]);
  useEffect(() => {
    if (selectedCourseId) { detail.current?.focus(); hadSelection.current = true; }
    else if (hadSelection.current) { search.current?.focus(); hadSelection.current = false; }
  }, [selectedCourseId]);
  return <GlassCard pad>
    <section className="academic-bank-discovery" aria-label="Available question banks">
      <PanelHeader headingLevel={2} title="Study by course" sub="Preview the weekly plan, load the weeks you need, and open their reviewed question sets."
        action={course
          ? <GButton onClick={() => openAcademicCourse(course.id)}><ArrowUpRight size={16} /> Open in Course Tracker</GButton>
          : <GButton onClick={catalog.retry} disabled={!accountId || catalog.loading}><RefreshCw size={16} /> Refresh banks</GButton>} />
      {!accountId ? <p>Sign in through Account to discover courses. Your saved questions remain available below.</p> : course ? <div ref={detail} tabIndex={-1} role="region" aria-label={`${course.module} question sets`}>
        <ConnectedCoursePlan key={`${accountId}:${course.current_revision_id}`} course={course} onBack={() => setSelected(undefined)}
          onOpen={() => openAcademicCourse(course.id)} onCustomize={() => openAcademicCourse(course.id)} onSharingSaved={catalog.retry} />
      </div> : <>
        <label className="course-search"><span className="sr-only">Search available banks</span><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Course or module" /></label>
        {catalog.loading && <p role="status">Loading available question banks…</p>}
        {catalog.error && <p role="alert">{catalog.error}</p>}
        {!catalog.loading && !catalog.error && !catalog.courses.length && <p>No courses match this search. Your saved questions remain available below.</p>}
        {coursesByTerm(catalog.courses).map(({ term, courses }, index) => <section key={term} className="course-term-section" aria-labelledby={`bank-term-${index}`}>
          <header className="course-term-heading"><h3 id={`bank-term-${index}`}>{term}</h3><span>{courses.length} {courses.length === 1 ? "course" : "courses"}</span></header>
          <div className="course-collection">
            {courses.map(course => <button type="button" key={course.id} data-course-id={course.id} className="course-card" onClick={() => setSelected({ accountId, course })} aria-label={`Preview ${course.module} course and weekly question sets`}>
              <div className="course-card-cover"><span>{course.term}</span><strong>{course.module}</strong><BookOpen size={28} strokeWidth={1} /></div>
              <div className="course-card-copy"><span className="course-card-context">{course.academic_term || course.term}</span><h4>{course.module}</h4><p>{course.title}</p><span className="course-card-facts">{course.ready_questions} ready {course.ready_questions === 1 ? "question" : "questions"}{course.review_questions > 0 && ` · ${course.review_questions} awaiting review`}</span><span className="course-card-state">Preview weeks and question sets</span></div>
              <ArrowUpRight size={20} aria-hidden="true" />
            </button>)}
          </div>
        </section>)}
        {catalog.more && <GButton disabled={catalog.loading} onClick={() => void catalog.loadMore()}>Load more banks</GButton>}
      </>}
    </section>
  </GlassCard>;
}
