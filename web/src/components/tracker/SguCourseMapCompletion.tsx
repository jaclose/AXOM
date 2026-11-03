import { useMemo } from "react";
import { SGU_CURRICULUM, mergeCurriculumMap, type CurriculumMergeCounts } from "../../lib/curricula";
import { completeCurriculumMap } from "../../lib/setupPlan";
import { useStore } from "../../lib/store";
import { pushToast } from "../../lib/toast";
import { GButton } from "../ui/primitives";
import "../../styles/course-tracker.css";

const countLabel = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
const additionLabel = ({ terms, courses, modules }: CurriculumMergeCounts): string =>
  [terms && countLabel(terms, "term"), courses && countLabel(courses, "course"), modules && countLabel(modules, "module")]
    .filter(Boolean).join(" · ");

/** An opt-in route for learners who already have Course Tracker work. */
export function SguCourseMapCompletion() {
  const terms = useStore(state => state.terms);
  const courses = useStore(state => state.courses);
  const trackerCount = useStore(state => state.tracker.length);
  const track = useStore(state => state.profile.educationTrack);
  const { added } = useMemo(() => mergeCurriculumMap({ terms, courses }, SGU_CURRICULUM), [terms, courses]);
  if ((!terms.length && !courses.length && !trackerCount) || !(added.terms || added.courses || added.modules)) return null;

  function complete() {
    const written = completeCurriculumMap(SGU_CURRICULUM);
    if (written.terms || written.courses || written.modules) pushToast({
      tone: "success", title: "SGU course map completed",
      body: `Added ${additionLabel(written)}. Your existing courses and activities are preserved.`,
    });
  }

  return <section className="tracker-sgu-map-setup" aria-labelledby="tracker-sgu-map-heading">
    <div>
      <span className="tracker-sgu-map-eyebrow">Optional curriculum setup</span>
      <h2 id="tracker-sgu-map-heading">Complete SGU course map</h2>
      <p>{track === "sgu" ? "Add the missing SGU structure to your tracker." : "Use this if you follow SGU's term structure."} Your courses and activity records stay intact.</p>
      <span className="tracker-sgu-map-count">{additionLabel(added)} to add</span>
    </div>
    <GButton variant="primary" onClick={complete}>Complete SGU course map</GButton>
  </section>;
}
