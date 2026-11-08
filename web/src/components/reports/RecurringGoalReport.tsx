import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { recurringGoalSummaries } from "../../lib/recurringGoalReports";

/** Read-only projections: no report writes or extra completion records. */
export function RecurringGoalReport({ includeUnshared = false }: { includeUnshared?: boolean } = {}) {
  const state = useStore();
  const rows = useMemo(() => recurringGoalSummaries(state, state.activeDayKey, includeUnshared), [state, includeUnshared]);
  if (!rows.length) return <p className="sub">Flexible weekly goals and named daily check-ins appear here once you create them in Productivity.</p>;
  return (
    <section aria-label="Personal recurring goals">
      <p className="sub">These are self-reported goal records, not academic mastery or inferred activity. Only your existing saved goal evidence is counted.</p>
      <div className="recurring-goal-report">
        {rows.map((row) => <article key={row.id} className="recurring-goal-report-row">
          <div className="recurring-goal-report-title">
            <b>{row.label}</b>
            <small>{row.periodLabel} · {row.progress}</small>
          </div>
          <div className="recurring-goal-report-pulses" role="img"
            aria-label={row.history.map((period) => `${period.label}: ${period.current} of ${period.target}`).join("; ")}>
            {row.history.map((period) => <span key={period.label}
              title={`${period.label}: ${period.current} of ${period.target}`}
              className={period.met ? "is-met" : period.current > 0 ? "is-partial" : ""} />)}
          </div>
          <small className="recurring-goal-report-evidence">{row.sourceRecordIds.length} source record{row.sourceRecordIds.length === 1 ? "" : "s"} this period</small>
        </article>)}
      </div>
    </section>
  );
}
