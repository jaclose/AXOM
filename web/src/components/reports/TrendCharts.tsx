import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { gradeColor, todayGrade, type GradeTargets } from "../../lib/scoring";
import { useStore } from "../../lib/store";
import { formatMetric, reportTrendMetricValue, type ReportDayDatum, type ReportTrendMetric } from "../../lib/reports";

export const TREND_METRIC_LABELS: Record<ReportTrendMetric, string> = {
  minutes: "Minutes",
  questions: "Questions",
  cards: "Cards",
  requirements: "Target completion",
};

/**
 * Bar color follows the same day grades as Productivity (red → orange →
 * green → blue by study minutes / cards) so both pages read identically.
 * Non-minute metrics use the accent; target completion uses met/missed.
 */
export function dayBarColor(day: ReportDayDatum, metric: ReportTrendMetric, targets?: GradeTargets): string {
  if (metric === "requirements") {
    return day.status === "met" ? "var(--green)" : day.status === "missed" ? "var(--orange)" : "var(--cyan)";
  }
  if (metric === "minutes") return gradeColor(todayGrade(day.minutes, day.cards, targets));
  return "rgb(var(--accent-rgb))";
}

function useGradeTargets(): GradeTargets {
  const minutes = useStore((s) => s.profile.dailyMinuteTarget);
  const cards = useStore((s) => s.profile.dailyCardTarget);
  return { minutes, cards };
}

function weekdayShort(dayKey: string) {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}
function dateShort(dayKey: string) {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendDelta({ percentChange }: { percentChange: number | null }) {
  if (percentChange === null) return <span className="trend-delta neutral"><Minus size={ICON_SIZE.microInline} aria-hidden="true" /> New</span>;
  const up = percentChange > 0;
  const Icon = percentChange === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`trend-delta ${percentChange === 0 ? "neutral" : up ? "up" : "down"}`}>
      <Icon size={ICON_SIZE.microInline} aria-hidden="true" /> {percentChange > 0 ? "+" : ""}{percentChange}% vs last week
    </span>
  );
}

/**
 * Seven calendar days as bars with gridlines, an optional target line, the
 * previous week as faint ghost bars, value labels, and a hover/focus tooltip
 * that explains exactly what each bar is.
 */
export function WeeklyTrendChart({
  days,
  previous,
  metric,
  target,
  todayKey,
  selected,
  onSelect,
}: {
  days: readonly ReportDayDatum[];
  previous: readonly ReportDayDatum[];
  metric: ReportTrendMetric;
  target?: number;
  todayKey: string;
  selected?: string | null;
  onSelect: (dayKey: string) => void;
}) {
  const targets = useGradeTargets();
  const values = days.map((day) => reportTrendMetricValue(day, metric));
  const ghosts = previous.map((day) => reportTrendMetricValue(day, metric));
  const dense = days.length > 10;
  const ceiling = Math.max(1, ...values, ...ghosts, target ?? 0) * 1.12;
  const targetPercent = target ? Math.min(100, (target / ceiling) * 100) : undefined;
  return (
    <div className={`trend-week ${dense ? "dense" : ""}`} role="group" aria-label={`${TREND_METRIC_LABELS[metric]} for the last ${days.length === 7 ? "seven" : days.length} days`}>
      <div className="trend-week-plot">
        {[25, 50, 75, 100].map((line) => (
          <span key={line} className="trend-gridline" style={{ bottom: `${line}%` }} aria-hidden="true">
            <em>{formatAxis((ceiling * line) / 100, metric)}</em>
          </span>
        ))}
        {targetPercent !== undefined && (
          <span className="trend-target-line" style={{ bottom: `${targetPercent}%` }} aria-hidden="true">
            <em>Target {formatMetric(target!, metric)}</em>
          </span>
        )}
        <div className="trend-week-bars" style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}>
          {days.map((day, index) => {
            const value = values[index];
            const ghost = ghosts[index] ?? 0;
            const isToday = day.dayKey === todayKey;
            const style = { "--bar": dayBarColor(day, metric, targets) } as CSSProperties;
            return (
              <button
                key={day.dayKey}
                type="button"
                className={`trend-week-col ${isToday ? "today" : ""} ${selected === day.dayKey ? "selected" : ""}`}
                style={style}
                aria-label={`${weekdayShort(day.dayKey)} ${dateShort(day.dayKey)}: ${formatMetric(value, metric)}${previous.length ? `; last week ${formatMetric(ghost, metric)}` : ""}`}
                aria-pressed={selected === day.dayKey}
                onClick={() => onSelect(day.dayKey)}
              >
                <span className="trend-week-track">
                  <i className="trend-ghost" style={{ height: `${(ghost / ceiling) * 100}%` }} />
                  <i className="trend-bar" style={{ height: `${value ? Math.max(3, (value / ceiling) * 100) : 0}%` }}>
                    {value > 0 && !dense && <b>{formatAxis(value, metric)}</b>}
                  </i>
                </span>
                <span className="trend-week-label">
                  {dense
                    ? <b>{Number(day.dayKey.slice(-2))}</b>
                    : <><b>{isToday ? "Today" : weekdayShort(day.dayKey)}</b><small>{dateShort(day.dayKey)}</small></>}
                </span>
                <span className="trend-tip" role="presentation">
                  <b>{weekdayShort(day.dayKey)}, {dateShort(day.dayKey)}</b>
                  <span>{formatMetric(value, metric)}{metric !== "minutes" && day.minutes ? ` · ${formatMetric(day.minutes, "minutes")}` : ""}</span>
                  {previous.length > 0 && <span>Same day last week: {formatMetric(ghost, metric)}</span>}
                  {day.eligible && <span>Targets: {day.status === "met" ? "met" : day.status === "pending" ? "in progress" : "not met"}</span>}
                  <small>Click for the records behind it</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="trend-week-legend" aria-hidden="true">
        <span><i className="solid" /> This week</span>
        {previous.length > 0 && <span><i className="ghost" /> Same day last week</span>}
        {targetPercent !== undefined && <span><i className="target" /> Daily target</span>}
        {metric === "minutes" && <span className="grades"><i style={{ background: "var(--grade-red)" }} /><i style={{ background: "var(--grade-orange)" }} /><i style={{ background: "var(--grade-green)" }} /><i style={{ background: "var(--grade-blue)" }} /> Day grade (same as Productivity)</span>}
      </div>
    </div>
  );
}

function formatAxis(value: number, metric: ReportTrendMetric) {
  if (metric === "minutes") return value >= 60 ? `${(value / 60).toFixed(value >= 600 ? 0 : 1)}h` : `${Math.round(value)}m`;
  if (metric === "requirements") return `${Math.round(value)}%`;
  return `${Math.round(value)}`;
}

/**
 * The calendar month — the same shape and day grades as Productivity's
 * monthly activity calendar, with the chosen metric printed in each cell.
 */
export function MonthlyTrendCalendar({
  days,
  metric,
  todayKey,
  selected,
  onSelect,
}: {
  days: readonly ReportDayDatum[];
  metric: ReportTrendMetric;
  todayKey: string;
  selected?: string | null;
  onSelect: (dayKey: string) => void;
}) {
  const targets = useGradeTargets();
  const leading = days[0] ? new Date(`${days[0].dayKey}T12:00:00`).getDay() : 0;
  const max = Math.max(1, ...days.map((day) => reportTrendMetricValue(day, metric)));
  return (
    <div className="trend-month" role="group" aria-label={`${TREND_METRIC_LABELS[metric]} calendar`}>
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span className="trend-month-head" key={label}>{label}</span>)}
      {Array.from({ length: leading }, (_, index) => <span className="trend-month-cell blank" key={`blank-${index}`} />)}
      {days.map((day) => {
        const value = reportTrendMetricValue(day, metric);
        const color = dayBarColor(day, metric, targets);
        const future = day.dayKey > todayKey;
        return (
          <button
            key={day.dayKey}
            type="button"
            disabled={future}
            className={`trend-month-cell ${value ? "active" : ""} ${day.dayKey === todayKey ? "today" : ""} ${selected === day.dayKey ? "selected" : ""} ${day.eligible ? day.status : ""}`}
            style={{ "--cell": color, "--fill": `${Math.round((value / max) * 100)}%` } as CSSProperties}
            aria-label={`${dateShort(day.dayKey)}: ${formatMetric(value, metric)}${day.eligible ? `; targets ${day.status}` : ""}`}
            aria-pressed={selected === day.dayKey}
            onClick={() => onSelect(day.dayKey)}
            title={`${dateShort(day.dayKey)} · ${formatMetric(value, metric)}`}
          >
            <span className="trend-month-date">{Number(day.dayKey.slice(-2))}</span>
            {value > 0 && <span className="trend-month-value">{formatAxis(value, metric)}</span>}
            {day.eligible && day.status === "met" && <span className="trend-month-met" aria-hidden="true" />}
            <i aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
