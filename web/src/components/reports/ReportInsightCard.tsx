import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import type { ReportMetric } from "../../lib/reports";

export interface ReportCardInsight {
  change?: string;
  strongestContributor?: string;
}

const STATE_LABEL: Record<ReportMetric["state"], string> = {
  ready: "Live",
  "low-data": "Low data",
  neutral: "Waiting for data",
};

/**
 * A report number with its meaning always visible. The "How is this
 * calculated?" layer opens only on an explicit click/Enter — hovering never
 * reshapes the card, which made the old version hard to read.
 */
export function ReportInsightCard({
  icon,
  metric,
  insight,
}: {
  icon: ReactNode;
  metric: ReportMetric;
  insight?: ReportCardInsight;
}) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const tone = metric.state === "neutral" ? "neutral" : metric.state === "low-data" ? "orange" : "cyan";
  const context = metric.denominator
    ? `${metric.numerator} of ${metric.denominator} · ${metric.period}`
    : metric.period;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <article className={`glass-card pad stat-card report-stat report-insight-card ${open ? "revealed pinned" : ""} state-${metric.state}`}>
      <div className="report-stat-top">
        <span className={`report-stat-icon ${tone}`}>{icon}</span>
        <span className="stat-title">{metric.label}</span>
        <span className={`report-stat-state ${metric.state}`}>{STATE_LABEL[metric.state]}</span>
      </div>
      <div className="stat-value">{metric.value}</div>
      <div className="report-stat-statusline">{metric.note}</div>
      <p className="report-stat-meaning">{metric.interpretation}</p>
      <div className="report-stat-foot">
        <span className="report-stat-context">{context}</span>
        <button
          type="button"
          className="report-insight-trigger"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${metric.label}: ${open ? "hide" : "show"} how this is calculated`}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={onKeyDown}
        >
          {open ? "Hide details" : "How is this calculated?"}
          <ChevronDown size={ICON_SIZE.microInline} aria-hidden="true" className="report-insight-chevron" />
        </button>
      </div>
      <div id={detailId} className={`report-stat-detail report-insight-layer ${open ? "visible" : ""}`} hidden={!open}>
        {open && <dl>
          <div><dt>What changed</dt><dd>{insight?.change ?? "No reliable comparison yet."}</dd></div>
          {insight?.strongestContributor && <div><dt>Biggest contributor</dt><dd>{insight.strongestContributor}</dd></div>}
          <div><dt>Calculation</dt><dd>{metric.calculation}</dd></div>
          <div><dt>Source</dt><dd>{metric.sourceLabel}{metric.sourceRecordIds.length ? ` · ${metric.sourceRecordIds.length} record${metric.sourceRecordIds.length === 1 ? "" : "s"}` : ""}</dd></div>
          {metric.action && <div><dt>Next step</dt><dd>{metric.action}</dd></div>}
        </dl>}
      </div>
    </article>
  );
}
