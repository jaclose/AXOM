import { useMemo } from "react";
import { useStore } from "../lib/store";
import { GlassCard } from "../components/ui/primitives";
import { SGU_CURRICULUM } from "../lib/curricula";
import { officialSguClinicalCourseEvidence } from "../lib/course-engine/officialSguCatalog";

/** Public catalog evidence: official course duration, but not a student schedule. */
export function OfficialSguClinicalCatalogReview() {
  const terms = useStore((state) => state.terms);
  const courses = useStore((state) => state.courses);
  const report = useMemo(() => officialSguClinicalCourseEvidence(SGU_CURRICULUM, {
    terms, courses,
  }), [terms, courses]);
  const mismatches = report.filter((course) => course.migrationReviewRequired).length;
  return <GlassCard pad className="tracker-official-sgu-evidence">
    <details>
      <summary><b>Published curriculum overview</b><span className="sub">
        PCM 500 / PCM 501 · {mismatches ? `${mismatches} course mappings need review` : "Source overview aligned"}
      </span></summary>
      <p className="sub">The reviewed source catalog uses <b>PCM 500</b> for Term 4 and <b>PCM 501</b> for Term 5 from Fall 2025 onward. The current AXOM built-in outline still uses <b>PPM 500/501</b>, and labels the first Term 5 module <b>NMI</b> rather than the source catalog's <b>MI</b>. Existing courses, imported questions and progress are preserved until their identities are reviewed. No automatic renaming occurs here.</p>
      {report.map((course) => <section key={course.term} className="tracker-official-course">
        <div className="tracker-official-course-title">
          <b>{course.term} · {course.officialCourseCode} · {course.totalWeeks} published instructional weeks</b>
          <a href={course.officialCatalogUrl} target="_blank" rel="noopener noreferrer">
            View published source
          </a>
        </div>
        <p className="sub">AXOM outline: {course.appOutlineCourseCodes.join(", ") || "not installed"}.
          {course.savedWorkspaceCourseCodes.length ? ` Local workspace: ${course.savedWorkspaceCourseCodes.join(", ")}.` : " No matching term course has been added to this workspace."}
          {course.migrationReviewRequired ? " Course identity or module aliases require review." : " Academic course code and module names align."}
        </p>
        <div className="tracker-official-table-scroll">
          <table className="tracker-official-table">
            <thead><tr><th>Source catalog module</th><th>Weeks</th><th>Derived sequence</th><th>AXOM mapping</th></tr></thead>
            <tbody>{course.modules.map((module) => <tr key={module.code}>
              <th scope="row"><b>{module.code}</b><small>{module.fullName}</small></th>
              <td>{module.durationWeeks}</td>
              <td>{module.derivedWeekStart}–{module.derivedWeekEnd}*</td>
              <td>{module.moduleMapping === "exact"
                ? `Matches ${module.matchedAXOMModule}`
                : "Requires module-alias review"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>)}
      <p className="sub">*These sequence ranges are arithmetic from the catalog's ordered module durations, not published exact class dates, IMCQ numbers, quiz schedules, or an authenticated term-specific syllabus. No course activities or question banks are created from them. School/private source uploads still need original-source and ownership checks before they can be presented as complete.</p>
    </details>
  </GlassCard>;
}
