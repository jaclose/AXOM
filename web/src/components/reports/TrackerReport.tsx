import { useMemo, type CSSProperties } from "react";
import { useStore } from "../../lib/store";
import { formatTrackerValue, summarizeTracker, trackerGoal } from "../../lib/trackerStats";
import { TrackerIcon } from "../productivity/TrackerManager";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";

/** Reports → Trackers: every tracker marked "Show in Reports" that has entries. */
export function TrackerReport() {
  const trackers = useStore((s) => s.productivityTrackers);
  const logs = useStore((s) => s.logs);
  const today = useStore((s) => s.activeDayKey);
  const rows = useMemo(() => trackers
    .filter((tracker) => tracker.contributesToReports && !tracker.archived)
    .map((tracker) => ({ tracker, summary: summarizeTracker(tracker, logs, today) }))
    .filter(({ summary }) => summary.last8Weeks.some((value) => value > 0))
    .sort((a, b) => b.summary.activeDays30 - a.summary.activeDays30), [trackers, logs, today]);

  if (!rows.length) {
    return <p className="sub">Log a tracker a few times and it appears here with its weekly total, goal progress and trend. Choose which trackers report under Productivity → Your trackers.</p>;
  }
  return (
    <div className="tracker-report" role="table" aria-label="Tracker report">
      <div className="tracker-report-row head" role="row">
        <span role="columnheader">Tracker</span>
        <span role="columnheader">Last 7 days</span>
        <span role="columnheader">vs previous 7</span>
        <span role="columnheader">8 weeks</span>
        <span role="columnheader">Active · streak</span>
      </div>
      {rows.map(({ tracker, summary }) => {
        const max = Math.max(1, ...summary.last8Weeks);
        const change = summary.previousWeek > 0 ? Math.round(((summary.week - summary.previousWeek) / summary.previousWeek) * 100) : null;
        const limit = trackerGoal(tracker) === "at-most";
        return (
          <div key={tracker.id} className="tracker-report-row" role="row" style={{ "--tracker": tracker.color } as CSSProperties}>
            <span role="cell" className="tracker-report-name"><span className="tracker-icon"><TrackerIcon name={tracker.icon} /></span><b>{tracker.name}</b>{limit && <small>limit</small>}</span>
            <span role="cell">
              <b>{formatTrackerValue(tracker, summary.week)}</b>
              {summary.weeklyProgress !== null && <small> · {summary.weeklyProgress}% of goal</small>}
            </span>
            <span role="cell">{change === null ? <small>—</small> : <Delta change={change} limit={limit} />}</span>
            <span role="cell" className="tracker-report-spark" aria-label={`Weekly totals: ${summary.last8Weeks.map((value) => formatTrackerValue(tracker, value)).join(", ")}`}>
              {summary.last8Weeks.map((value, index) => <i key={index} style={{ height: `${Math.max(6, (value / max) * 100)}%`, opacity: value ? 1 : 0.3 }} />)}
            </span>
            <span role="cell"><b>{summary.activeDays30}</b><small>/30 days</small>{summary.streak > 1 && <small> · {summary.streak}-day streak</small>}</span>
          </div>
        );
      })}
      <p className="energy-honesty">Green means the good direction: up for goals, down for limits.</p>
    </div>
  );
}

function Delta({ change, limit }: { change: number; limit: boolean }) {
  const Icon = change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = change === 0 ? "neutral" : (change > 0) !== limit ? "up" : "down";
  return <span className={`trend-delta ${tone}`}><Icon size={ICON_SIZE.microInline} aria-hidden="true" /> {change > 0 ? "+" : ""}{change}%</span>;
}
