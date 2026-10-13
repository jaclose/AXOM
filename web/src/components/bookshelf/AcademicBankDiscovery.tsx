import { useState } from "react";
import { ArrowUpRight, BookOpen, RefreshCw } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useAcademicCatalog } from "../../lib/academicLibrary/useAcademicCatalog";
import { openAcademicCourse } from "../../lib/academicLibrary/navigation";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import "../../styles/course-library.css";

/** QBank and Course Library discover the same permissioned collection. */
export function AcademicBankDiscovery() {
  const accountId = useAccount(state => state.user?.id);
  const [query, setQuery] = useState("");
  const catalog = useAcademicCatalog(accountId, query, "");
  return <GlassCard pad>
    <section className="academic-bank-discovery" aria-label="Available question banks">
      <PanelHeader headingLevel={2} title="Study by course" sub="Preview the weekly plan, load the weeks you need, and open their reviewed question sets."
        action={<GButton onClick={catalog.retry} disabled={!accountId || catalog.loading}><RefreshCw size={16} /> Refresh banks</GButton>} />
      {!accountId ? <p>Sign in through Account to discover courses. Your saved questions remain available below.</p> : <>
        <label className="course-search"><span className="sr-only">Search available banks</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Course or module" /></label>
        {catalog.loading && <p role="status">Loading available question banks…</p>}
        {catalog.error && <p role="alert">{catalog.error}</p>}
        {!catalog.loading && !catalog.error && !catalog.courses.length && <p>No courses match this search. Your saved questions remain available below.</p>}
        <div className="course-collection">
          {catalog.courses.map(course => <button key={course.id} data-course-id={course.id} className="course-card" onClick={() => openAcademicCourse(course.id)} aria-label={`Open ${course.module} course and question sets`}>
            <div className="course-card-cover"><span>{course.term}</span><strong>{course.module}</strong><BookOpen size={28} strokeWidth={1} /></div>
            <div className="course-card-copy"><span className="course-card-context">{course.academic_term || course.term}</span><h2>{course.module}</h2><p>{course.title}</p><span className="course-card-facts">{course.ready_questions} ready {course.ready_questions === 1 ? "question" : "questions"}{course.review_questions > 0 && ` · ${course.review_questions} awaiting review`}</span><span className="course-card-state">Preview weeks and question sets</span></div>
            <ArrowUpRight size={20} aria-hidden="true" />
          </button>)}
        </div>
        {catalog.more && <GButton disabled={catalog.loading} onClick={() => void catalog.loadMore()}>Load more banks</GButton>}
      </>}
    </section>
  </GlassCard>;
}
