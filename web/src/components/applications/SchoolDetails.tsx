import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import type { RequirementCheck, SchoolCheckResult } from "../../lib/applicationChecker";
import type { RequirementEvidence } from "../../lib/applicationRequirements";
import { researchFactRevision, researchValue, type ApplicationResearchEntry, type SchoolResearchFact } from "../../lib/applicationResearch";
import type { ApplicationSchool, SchoolRiskFlag } from "../../lib/applicationSchools";
import {
  BAND_TEXT,
  byAttention,
  CAPTURE_LABEL,
  estimateExplanation,
  formatDate,
  formatDelta,
  formatMetric,
  METRIC_LABEL,
  outcomeLabel,
  outcomeTone,
  sourceText,
  STAT_BASIS_LABEL,
} from "./applicationDisplay";

function SourceLink({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noreferrer noopener">Review source <ExternalLink size={ICON_SIZE.microInline} aria-hidden="true" /></a>;
}

function CaptureLine({ status, capturedAt, url }: { status: SchoolResearchFact["captureStatus"]; capturedAt: string; url: string }) {
  return (
    <div className="application-capture">
      <span className={status === "official-capture" ? "official" : "unverified"}>{CAPTURE_LABEL[status]}</span>
      <span>{formatDate(capturedAt)}</span>
      <SourceLink url={url} />
    </div>
  );
}

/** requirement_type is the research team's classification, not the rule's own text. */
const primaryEvidence = (evidence: readonly RequirementEvidence[]) =>
  evidence.find(item => !item.factId.endsWith(".requirement_type")) ?? evidence[0];

function CheckRow({ check }: { check: RequirementCheck }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tone = outcomeTone(check);
  const primary = primaryEvidence(check.evidence);
  return (
    <li className={`application-check tone-${tone}`}>
      <div className="application-check-head">
        <span className={`application-outcome tone-${tone}`}>{outcomeLabel(check)}</span>
        <span className="application-check-title">{check.title}</span>
      </div>
      <p className="application-check-explanation">{check.explanation}</p>
      {(check.yourValue !== undefined || check.schoolValue !== undefined) && (
        <dl className="application-check-values">
          {check.yourValue !== undefined && <div><dt>Yours</dt><dd>{check.yourValue}</dd></div>}
          {check.schoolValue !== undefined && <div><dt>School</dt><dd>{check.schoolValue}</dd></div>}
        </dl>
      )}
      {check.cycleNote && <p className="application-cycle-note">{check.cycleNote}</p>}
      {primary && (
        <div className="application-check-source">
          <CaptureLine status={primary.captureStatus} capturedAt={primary.capturedAt} url={primary.url} />
          <button type="button" className="application-disclosure" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
            {open ? "Hide source text" : "Show source text"}
          </button>
        </div>
      )}
      {primary && (
        <ul className="application-evidence" id={panelId} hidden={!open}>
          {check.evidence.map(item => (
            <li key={item.factId}>
              <span className="application-evidence-label">{item.label}</span>
              <blockquote className="application-source-text">{sourceText(item.rawValue)}</blockquote>
              {item !== primary && <CaptureLine status={item.captureStatus} capturedAt={item.capturedAt} url={item.url} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RequirementChecks({ result, hasProfile }: { result: SchoolCheckResult; hasProfile: boolean }) {
  const headingId = useId();
  const { checks, eligibility, cycle } = result;
  const sorted = [...checks].sort(byAttention);
  const unknown = eligibility.unknown;
  return (
    <section className="application-section application-checks" aria-labelledby={headingId}>
      <h4 id={headingId}>Automatic requirement check</h4>
      {checks.length === 0 ? (
        <p className="sub">No requirement evidence has been collected for this school yet, so there is nothing to check. Missing evidence is not a waived requirement.</p>
      ) : (
        <>
          <p className="sub">
            {hasProfile
              ? `${checks.length} captured requirement area${checks.length === 1 ? "" : "s"}: ${eligibility.blockers} possible blocker${eligibility.blockers === 1 ? "" : "s"} · ${eligibility.reviews} to review · ${unknown} need${unknown === 1 ? "s" : ""} your details or evidence.`
              : `${checks.length} captured requirement area${checks.length === 1 ? "" : "s"}. Add your application profile to compare them with your details.`}
            {" "}Each row shows how AXOM read the captured text; confirm every rule with the school.
          </p>
          {hasProfile && <p className={`application-cycle ${cycle.status === "earlier-cycle" ? "attention" : ""}`}>{cycle.note}</p>}
          <ol className="application-check-list">
            {sorted.map(check => <CheckRow check={check} key={check.requirementId} />)}
          </ol>
        </>
      )}
    </section>
  );
}

const POSITION_TEXT = { "below-range": "below this range", "within-range": "within this range", "above-range": "above this range" } as const;
const CONFIDENCE_TEXT = { low: "low", moderate: "moderate", high: "high", unknown: "not stated" } as const;

export function EstimatesSection({ school, result }: { school: ApplicationSchool; result: SchoolCheckResult }) {
  const headingId = useId();
  const estimates = school.estimates;
  const stats = school.reportedStats ?? [];
  const competitiveness = result.competitiveness;
  const activities = result.activities;
  if (!estimates && !stats.length) return null;
  return (
    <section className="application-section application-estimates" aria-labelledby={headingId}>
      <div className="application-estimates-head">
        <span className="application-estimate-badge">Estimate</span>
        <h4 id={headingId}>Estimates — not requirements</h4>
      </div>
      <p className="sub">Planning context from research-team estimates and reported class figures. None of this is an admission rule, and none of it predicts a decision.</p>

      {estimates?.tier && (
        <div className="application-estimate-block">
          <p><b>Research-team tier:</b> {estimates.tier}</p>
          {estimates.tierRationale && <blockquote className="application-source-text">{estimates.tierRationale}</blockquote>}
        </div>
      )}

      {competitiveness && competitiveness.comparisons.length > 0 && (
        <div className="application-estimate-block">
          <h5>Class figures compared with yours</h5>
          <ul className="application-estimate-list">
            {competitiveness.comparisons.map(comparison => (
              <li key={comparison.metric}>
                <div><b>{METRIC_LABEL[comparison.metric]} {formatMetric(comparison.metric, comparison.benchmark)}</b> <span className="sub">{comparison.benchmarkLabel}</span></div>
                <div>
                  {comparison.yours !== undefined && comparison.band
                    ? <>Yours {formatMetric(comparison.metric, comparison.yours)} ({formatDelta(comparison.metric, comparison.delta)}) — <b>{BAND_TEXT[comparison.band]}</b> this figure</>
                    : <span className="sub">Add your {METRIC_LABEL[comparison.metric]} to compare.</span>}
                </div>
              </li>
            ))}
          </ul>
          {competitiveness.band && <p><b>Estimated competitiveness:</b> {BAND_TEXT[competitiveness.band]}</p>}
        </div>
      )}
      {competitiveness && <p className="sub">{estimateExplanation(competitiveness.explanation)}</p>}

      {activities.length > 0 && (
        <div className="application-estimate-block">
          <h5>Activity hours: estimated typical ranges</h5>
          <ul className="application-estimate-list">
            {activities.map(activity => (
              <li key={activity.activity}>
                <div><b>{activity.label}</b> <span className="application-range">{activity.range.text}</span></div>
                <div className="sub">
                  {activity.yours === undefined ? "Your hours: not entered"
                    : `Your hours: ${activity.yours.toLocaleString()}${activity.position ? ` — ${POSITION_TEXT[activity.position]}` : ""}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {estimates && (
        <div className="application-estimate-block">
          <p className="sub">Research-team confidence: {CONFIDENCE_TEXT[estimates.confidence] ?? "not stated"} · Estimated {formatDate(estimates.estimatedAt)}</p>
          {estimates.sourcesReferenced && <p className="sub">Sources referenced: {estimates.sourcesReferenced}</p>}
          <blockquote className="application-source-text application-disclaimer">{estimates.disclaimer}</blockquote>
        </div>
      )}

      {stats.length > 0 && (
        <div className="application-estimate-block">
          <h5>Reported class statistics</h5>
          <ul className="application-estimate-list">
            {stats.map(stat => (
              <li key={stat.id}>
                <div><b>{stat.label}</b></div>
                <blockquote className="application-source-text">{stat.value}</blockquote>
                {stat.floorLike && <p className="application-floor-note">Reads as a threshold or minimum, not a class statistic.</p>}
                <div className="application-capture">
                  <span className={stat.basis === "official-capture" ? "official" : "unverified"}>{STAT_BASIS_LABEL[stat.basis]}</span>
                  <span>{formatDate(stat.capturedAt)}</span>
                  <SourceLink url={stat.url} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function RiskFlagSection({ flag }: { flag: SchoolRiskFlag }) {
  const headingId = useId();
  return (
    <section className="application-section application-risk" aria-labelledby={headingId}>
      <h4 id={headingId}>Research-team risk flag (judgment, not an official rating)</h4>
      <p><b>{flag.tier}</b></p>
      {flag.notes && <blockquote className="application-source-text">{flag.notes}</blockquote>}
      <CaptureLine status={flag.captureStatus} capturedAt={flag.capturedAt} url={flag.url} />
    </section>
  );
}

const FACT_GROUPS: readonly { title: string; prefixes: readonly string[] }[] = [
  { title: "Admissions", prefixes: ["admissions_requirements_raw"] },
  { title: "Coursework", prefixes: ["coursework_policy_raw"] },
  { title: "Application process", prefixes: ["application_process_raw"] },
  { title: "Cost and financial aid", prefixes: ["cost_financial_aid_raw"] },
  { title: "Accreditation and eligibility risk", prefixes: ["accreditation_regulatory_raw", "caribbean_risk_eligibility_raw"] },
];

function groupFacts(facts: readonly SchoolResearchFact[]) {
  const prefix = (fact: SchoolResearchFact) => fact.id.split(".")[0];
  const known = new Set(FACT_GROUPS.flatMap(group => group.prefixes));
  const groups = FACT_GROUPS.map(group => ({ title: group.title, facts: facts.filter(fact => group.prefixes.includes(prefix(fact))) }));
  groups.push({ title: "Other research", facts: facts.filter(fact => !known.has(prefix(fact))) });
  return groups.filter(group => group.facts.length > 0);
}

export function ResearchFactGroups({ facts, entry, onReviewedChange }: {
  facts: readonly SchoolResearchFact[];
  entry: ApplicationResearchEntry | undefined;
  onReviewedChange: (fact: SchoolResearchFact, reviewed: boolean) => void;
}) {
  if (!facts.length) return null;
  return (
    <section className="application-section application-research-facts" aria-label="Collected research">
      <p className="sub">Read the source, then mark the information you have reviewed. This does not mean you meet a requirement. Checks reopen when evidence changes. Workspace save status is shown in the application header.</p>
      {groupFacts(facts).map(group => {
        const reviewed = group.facts.filter(fact => entry?.reviewedFacts[fact.id] === researchFactRevision(fact)).length;
        return (
          <div className="application-fact-group" key={group.title}>
            <h4>{group.title} <span className="sub">{reviewed}/{group.facts.length} reviewed</span></h4>
            {group.facts.map(fact => (
              <div className="application-research-fact" key={fact.id}>
                <label className="row gap8" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" aria-label={`Reviewed ${fact.label}`} checked={entry?.reviewedFacts[fact.id] === researchFactRevision(fact)}
                    onChange={event => onReviewedChange(fact, event.target.checked)} />
                  <span><b>{fact.label}</b><br />{researchValue(fact.value)}</span>
                </label>
                <div className="sub">{CAPTURE_LABEL[fact.captureStatus]} · {formatDate(fact.capturedAt)} · <a href={fact.url} target="_blank" rel="noreferrer noopener">Review source</a></div>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
