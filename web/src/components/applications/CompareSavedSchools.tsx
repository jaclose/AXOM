import { GlassCard, PanelHeader, Tag } from "../ui/primitives";
import type { MetricComparison, SchoolCheckResult } from "../../lib/applicationChecker";
import type { ApplicationSchool } from "../../lib/applicationSchools";
import { BAND_TEXT, CHECK_STATUS, formatDelta, formatMetric, METRIC_LABEL, outcomeLabel } from "./applicationDisplay";

function MetricCell({ comparison, metric, hasProfile }: { comparison?: MetricComparison; metric: MetricComparison["metric"]; hasProfile: boolean }) {
  if (!comparison || comparison.benchmark === undefined) return <span className="sub">No benchmark captured</span>;
  const yours = comparison.yours;
  return (
    <>
      <span className="application-compare-figure">{formatMetric(metric, yours)} vs {formatMetric(metric, comparison.benchmark)}</span>
      <span className="sub">
        {yours !== undefined && comparison.band
          ? `${formatDelta(metric, comparison.delta)} · ${BAND_TEXT[comparison.band]} · ${comparison.benchmarkLabel}`
          : `${hasProfile ? `Add your ${METRIC_LABEL[metric]}` : "Add your profile"} · ${comparison.benchmarkLabel}`}
      </span>
    </>
  );
}

export function CompareSavedSchools({ schools, results, hasProfile }: {
  schools: readonly ApplicationSchool[];
  results: ReadonlyMap<string, SchoolCheckResult>;
  hasProfile: boolean;
}) {
  if (!schools.length) return null;
  return (
    <GlassCard pad className="application-compare-card">
      <PanelHeader title="Compare saved schools" headingLevel={2}
        sub="Automatic checks and research-team estimates side by side. Estimates are planning context, not requirements." />
      <div className="application-compare-wrap">
        {/* Explicit roles keep table semantics when the phone layout changes display (WebKit drops them otherwise). */}
        <table className="application-compare" role="table">
          <caption>{schools.length} saved school{schools.length === 1 ? "" : "s"} compared on captured requirements and estimates</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">School</th>
              <th scope="col" role="columnheader">Check result</th>
              <th scope="col" role="columnheader">GPA vs benchmark</th>
              <th scope="col" role="columnheader">MCAT vs benchmark</th>
              <th scope="col" role="columnheader">Residency</th>
              <th scope="col" role="columnheader">Estimated competitiveness</th>
              <th scope="col" role="columnheader">Deadline</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {schools.map(school => {
              const result = results.get(school.id);
              const status = result ? CHECK_STATUS[result.eligibility.status] : CHECK_STATUS["not-enough-information"];
              const comparisons = result?.competitiveness?.comparisons ?? [];
              const residency = result?.checks.find(check => check.kind === "state-residency");
              const deadline = result?.checks.find(check => check.kind === "deadline");
              const competitiveness = result?.competitiveness;
              return (
                <tr key={school.id} role="row">
                  <th scope="row" role="rowheader" data-label="School">
                    <span className="application-compare-name">{school.name}</span>
                    {school.location && <span className="sub">{school.location}</span>}
                  </th>
                  <td role="cell" data-label="Check result">
                    <Tag tone={status.tone}>{status.label}</Tag>
                    {result && hasProfile && result.checks.length > 0 && (
                      <span className="sub">{result.eligibility.blockers} blocker{result.eligibility.blockers === 1 ? "" : "s"} · {result.eligibility.reviews} to review</span>
                    )}
                  </td>
                  <td role="cell" data-label="GPA vs benchmark"><MetricCell metric="gpa" comparison={comparisons.find(item => item.metric === "gpa")} hasProfile={hasProfile} /></td>
                  <td role="cell" data-label="MCAT vs benchmark"><MetricCell metric="mcat" comparison={comparisons.find(item => item.metric === "mcat")} hasProfile={hasProfile} /></td>
                  <td role="cell" data-label="Residency">
                    {residency
                      ? <><span>{outcomeLabel(residency)}</span>{residency.schoolValue && <span className="sub">{residency.schoolValue}</span>}</>
                      : <span className="sub">Not captured</span>}
                  </td>
                  <td role="cell" data-label="Estimated competitiveness">
                    {competitiveness?.band
                      ? <><span>Estimate: {BAND_TEXT[competitiveness.band]}</span>{competitiveness.tier && <span className="sub">Research-team tier {competitiveness.tier}</span>}</>
                      : competitiveness
                        ? <><span className="sub">Add GPA or MCAT to compare</span>{competitiveness.tier && <span className="sub">Research-team tier {competitiveness.tier}</span>}</>
                        : <span className="sub">No estimate</span>}
                  </td>
                  <td role="cell" data-label="Deadline">
                    {deadline?.schoolValue
                      ? <><span>{deadline.schoolValue}</span><span className="sub">{outcomeLabel(deadline)}</span></>
                      : <span className="sub">{school.deadline ?? "Not captured"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
