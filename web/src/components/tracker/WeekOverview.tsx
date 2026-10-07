// ===========================================================================
// Weeks: the course as the learner lives it. One line per week with what is
// done, what the question attempts already show, and absences against the
// term's allowance. Shown only once the tracker holds week-filed rows (a
// loaded course template); the full tracker tree below is unchanged.
// ===========================================================================
import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { countActivity, COURSE_ACTIVITY_LABEL, type CourseActivity } from "../../lib/course-engine/activity";
import { absenceStanding, buildModuleWeeks, isAttended, type ModuleWeeks, type WeekSummary } from "../../lib/course-engine/weekView";
import { GlassCard, PanelHeader, Tag } from "../ui/primitives";

const ALLOWANCE_FIELDS: CourseActivity[] = ["lecture", "small-group", "imcq", "esoft", "lab"];

function questionLine(week: WeekSummary): string | null {
  const { total, attempted, firstTimeCorrect } = week.questions;
  if (!total) return null;
  if (!attempted) return `${total} question${total === 1 ? "" : "s"} filed, none answered yet`;
  return `Questions: ${attempted} of ${total} answered, ${Math.round((firstTimeCorrect / attempted) * 100)}% right first time`;
}

export function WeekOverview() {
  const s = useStore();
  const setsById = useMemo(() => new Map((s.questionSets ?? []).map((set) => [set.id, set])), [s.questionSets]);
  const modules = useMemo(
    () => buildModuleWeeks(s.tracker, s.questions ?? [], setsById),
    [s.tracker, s.questions, setsById],
  );
  // Open on the module in progress; the rest are one click away. Until the
  // learner picks one, the choice follows the data, so a template loaded a
  // moment ago opens without a reload. null means "all closed, on purpose".
  const [chosenModule, setChosenModule] = useState<string | null>();
  const openModule = chosenModule === undefined
    ? modules.find((module) => module.done > 0 && module.currentWeek)?.key ?? modules[0]?.key
    : chosenModule ?? undefined;
  const [openWeek, setOpenWeek] = useState<string>();

  if (modules.length === 0) return null;
  const terms = s.terms.filter((term) => modules.some((module) => module.term === term.name));

  return (
    <GlassCard pad className="week-overview">
      <PanelHeader title="Weeks" sub="What is done each week. Question progress is read from your answers; nothing here is entered by hand except attendance." />

      {terms.map((term) => {
        const standing = absenceStanding(s.tracker, term);
        return (
          <details key={term.id} className="week-absences">
            <summary>
              <b>{term.name} absences</b>
              <span className="row wrap gap6">
                {standing.length === 0 && <span className="sub">None recorded. Set what the term allows.</span>}
                {standing.map((entry) => (
                  <Tag key={entry.category} tone={entry.remaining !== undefined && entry.remaining < 0 ? "red" : entry.remaining === 0 ? "orange" : "neutral"}>
                    {COURSE_ACTIVITY_LABEL[entry.category]}: {entry.missed} missed{entry.allowed !== undefined ? ` of ${entry.allowed} allowed` : ""}
                  </Tag>
                ))}
              </span>
            </summary>
            <div className="week-allowances">
              {ALLOWANCE_FIELDS.map((activity) => (
                <label key={activity} className="stack gap6">
                  <span className="field-label">{COURSE_ACTIVITY_LABEL[activity]} absences allowed</span>
                  <input className="field" type="number" inputMode="numeric" min={0} max={200}
                    value={term.absenceAllowances?.[activity] ?? ""} placeholder="Not set"
                    onChange={(event) => s.setTermAbsenceAllowance(term.id, activity, event.target.value === "" ? undefined : Number(event.target.value))} />
                </label>
              ))}
            </div>
          </details>
        );
      })}

      <div className="week-modules">
        {modules.map((module) => (
          <ModuleBlock key={module.key} module={module}
            open={openModule === module.key} onToggle={() => setChosenModule(openModule === module.key ? null : module.key)}
            openWeek={openWeek} onToggleWeek={(path) => setOpenWeek(openWeek === path ? undefined : path)} />
        ))}
      </div>
    </GlassCard>
  );
}

function ModuleBlock({ module, open, onToggle, openWeek, onToggleWeek }: {
  module: ModuleWeeks;
  open: boolean;
  onToggle: () => void;
  openWeek?: string;
  onToggleWeek: (path: string) => void;
}) {
  const s = useStore();
  return (
    <section className="week-module" aria-label={`${module.module} by week`}>
      <button type="button" className="week-module-head" aria-expanded={open} onClick={onToggle}>
        {/* The tracker tree below has its own toggle named after the module:
            this prefix tells the two apart for anyone not looking at the page. */}
        <span className="sr-only">Weeks: </span>
        <b>{module.module}</b>
        <span className="sub">
          {module.term ? `${module.term} · ` : ""}{module.weeks.length} week{module.weeks.length === 1 ? "" : "s"} · {module.done} of {module.total} done
        </span>
      </button>
      {open && (
        <ul className="week-list">
          {module.weeks.map((week) => {
            const questions = questionLine(week);
            const expanded = openWeek === week.path;
            return (
              <li key={week.path} className={`week-row ${week.week === module.currentWeek ? "current" : ""}`}>
                <button type="button" className="week-row-head" aria-expanded={expanded} onClick={() => onToggleWeek(week.path)}>
                  <span className="week-row-title">
                    <b>Week {week.week}</b>
                    {week.week === module.currentWeek && <Tag tone="gold">Current</Tag>}
                    {week.missed > 0 && <Tag tone="orange">{week.missed} missed</Tag>}
                    {week.items.some((item) => item.weekSource === "inferred") && <Tag tone="neutral">{week.items.filter((item) => item.weekSource === "inferred").length} placed by AXOM</Tag>}
                  </span>
                  <span className="sub">
                    {week.done} of {week.items.length} done
                    {week.byActivity.length > 0 && ` · ${week.byActivity.filter((entry) => entry.activity !== "other").map((entry) => countActivity(entry.activity as CourseActivity, entry.total)).join(", ")}`}
                  </span>
                  {questions && <span className="week-questions">{questions}</span>}
                  <span className="week-bar" aria-hidden="true"><span style={{ width: `${week.items.length ? Math.round((week.done / week.items.length) * 100) : 0}%` }} /></span>
                </button>
                {expanded && (
                  <ul className="week-items">
                    {week.items.map((item) => (
                      <li key={item.id}>
                        <label className="week-item-done">
                          <input type="checkbox" checked={item.passes >= 1}
                            onChange={() => s.setPasses(item.id, item.passes >= 1 ? 0 : 1)} />
                          <span>{item.label}</span>
                        </label>
                        {item.weekSource === "inferred" && (
                          // The template did not say which week this belongs to. Moving it
                          // records the learner's choice, which a re-import then keeps.
                          <select className="field week-move" aria-label={`Week for ${item.label}`} value={week.week}
                            onChange={(event) => s.updateTrackerItem(item.id, {
                              path: item.path.replace(/\/[^/]+$/, `/Week ${event.target.value}`),
                              weekSource: "learner",
                            })}>
                            {module.weeks.map((option) => <option key={option.week} value={option.week}>Week {option.week}</option>)}
                          </select>
                        )}
                        {isAttended(item.activity) && (
                          <button type="button" className={`filter-pill ${item.attendance === "missed" ? "on" : ""}`}
                            aria-pressed={item.attendance === "missed"} aria-label={`Missed ${item.label}`}
                            onClick={() => s.updateTrackerItem(item.id, { attendance: item.attendance === "missed" ? undefined : "missed" })}>
                            Missed
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
