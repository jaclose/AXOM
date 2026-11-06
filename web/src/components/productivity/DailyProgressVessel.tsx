import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DailySuccessResult } from "../../lib/dailySuccess";
import { ICON_SIZE } from "../../lib/iconSize";

export function DailyProgressVessel({ result, compact = false, dayLabel = "Today" }: { result: DailySuccessResult; compact?: boolean; dayLabel?: string }) {
  const previous = useRef(result.progress);
  const [changed, setChanged] = useState(false);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const breakdownId = useId();

  useEffect(() => {
    if (previous.current === result.progress) return;
    previous.current = result.progress;
    setChanged(true);
    const timeout = window.setTimeout(() => setChanged(false), 760);
    return () => window.clearTimeout(timeout);
  }, [result.progress]);

  const displayStatus = result.statusLabel === "No requirements selected" ? "No targets selected" : result.statusLabel;
  const ariaText = result.status === "neutral"
    ? `${displayStatus}. ${result.eligibleCount} eligible target${result.eligibleCount === 1 ? "" : "s"}.`
    : `${result.progress}% complete. ${result.metCount} of ${result.eligibleCount} targets met.`;
  const visible = useMemo(
    () => result.requirements.filter((item) => item.eligible && item.status !== "not-eligible"),
    [result.requirements],
  );
  const totalWeight = visible
    .filter((item) => item.status !== "unavailable")
    .reduce((sum, item) => sum + Math.max(0.1, Number(item.requirement.weight) || 1), 0) || 1;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((value) => !value);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`daily-progress-vessel ${compact ? "compact" : ""}`} data-state={result.status}>
      <div className="daily-progress-copy">
        <span>{dayLabel}</span>
        <strong>{displayStatus}</strong>
        <small>{result.eligibleCount
              ? `${result.metCount} of ${result.eligibleCount} selected target${result.eligibleCount === 1 ? "" : "s"} met`
          : "Choose only the signals that matter to you"}</small>
      </div>
      <div
        className={`daily-progress-inspector ${peek || open ? "peek" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={breakdownId}
        aria-label="Where today’s progress came from"
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={() => setPeek(false)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleKeyDown}
      >
        <div
          className="daily-progress-track"
          role="progressbar"
          aria-label="Daily success progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={result.progress}
          aria-valuetext={ariaText}
        >
          <div className={`daily-progress-fill ${changed ? "changed" : ""}`} style={{ width: `${result.progress}%` }} />
          {result.eligibleCount > 0 && <i className="daily-progress-threshold" aria-hidden="true" />}
          <span aria-hidden="true">{result.status === "neutral" ? "—" : `${result.progress}%`}</span>
        </div>
        {result.eligibleCount > 0 && <div className="daily-progress-threshold-label">80% streak threshold</div>}
        {visible.length > 0 && (
          <div className="daily-progress-segments" aria-hidden="true">
            {visible.filter((item) => item.status !== "unavailable").map((item) => {
              const weight = Math.max(0.1, Number(item.requirement.weight) || 1);
              return (
                <span key={item.requirement.id} style={{ flexGrow: weight, flexBasis: `${(weight / totalWeight) * 100}%` }} title={`${item.requirement.label}: ${Math.round(item.ratio * 100)}%`}>
                  <i style={{ width: `${Math.round(item.ratio * 100)}%` }} />
                </span>
              );
            })}
          </div>
        )}
        <div className="daily-progress-peek" aria-hidden={!peek && !open}>
          <span>Where progress came from</span>
          <b>{visible.length ? visible.slice(0, 3).map((item) => item.requirement.label).join(" · ") : "No targets scheduled"}</b>
          {open ? <ChevronUp size={ICON_SIZE.body} aria-hidden="true" /> : <ChevronDown size={ICON_SIZE.body} aria-hidden="true" />}
        </div>
      </div>
      {open && (
        <section id={breakdownId} className="daily-progress-breakdown" aria-label="Daily target contribution breakdown">
          <div className="daily-progress-breakdown-head">
            <b>Where progress came from</b>
            <span>Native progress and weighted contribution are shown separately.</span>
          </div>
          {visible.length === 0 ? (
            <p>No target is scheduled today. Choose targets only when they help.</p>
          ) : visible.map((item) => {
            const remaining = Math.max(0, item.target - item.current);
            const weight = Math.max(0.1, Number(item.requirement.weight) || 1);
            const weighted = item.status === "unavailable" ? 0 : Math.round((weight / totalWeight) * item.ratio * 100);
            const sources = [...new Set(item.contributions.map((row) => contributionSource(row.sourceRecord, row.matchedBy)))];
            return (
              <article key={item.requirement.id} data-status={item.status}>
                <div>
                  <b>{item.requirement.label}</b>
                  <span>{item.calculation}</span>
                </div>
                <dl>
                  <div><dt>Native progress</dt><dd>{Math.round(item.ratio * 100)}%</dd></div>
                  <div><dt>Weighted contribution</dt><dd>{weighted} points</dd></div>
                  <div><dt>Source</dt><dd>{sources.length ? sources.join(", ") : item.sourceLabel}</dd></div>
                  <div><dt>Remaining</dt><dd>{item.status === "unavailable" ? "Source unavailable" : remaining ? `${formatNumber(remaining)} ${item.requirement.unit}` : "Complete"}</dd></div>
                </dl>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function contributionSource(source: string, matchedBy: string): string {
  if (source === "habit-entry") return "Habit Tracker";
  if (source === "daily-closeout") return "Journal closeout";
  if (source === "manual-contribution") return matchedBy === "manual" ? "Manual check-off" : "Manual adjustment";
  if (matchedBy === "reassigned") return "Reassigned activity";
  return matchedBy === "alias" ? "Matched activity" : "Activity log";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
