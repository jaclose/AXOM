import { useMemo, useState } from "react";
import { Flame, Target, Activity, CalendarCheck, Layers, ListChecks, Download, BatteryCharging, Gauge, AlertTriangle } from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, PanelHeader, Tag } from "../components/ui/primitives";
import { dayTotals, todayGrade, gradeColor, gradeLabel, gradeLegend, prettyDate } from "../lib/scoring";
import { PASS_COLOR, PASS_LABEL, YIELD_LABEL, YIELD_TONE, passStage, scopeMastery } from "../lib/tracker";
import { resolveTrack } from "../lib/tracks";
import { exportStateWithAttachments } from "../lib/backup";
import { analyzePerformance } from "../lib/performance";
import { calculateReadiness } from "../lib/energy";
import type { PassStage } from "../lib/tracker";
import type { TrackerKind, Yield } from "../lib/types";
import {
  buildActivityRhythm,
  buildCalendarWeeks,
  buildCanonicalReportSummary,
  buildRecentDays,
  buildCanonicalReportTrends,
  compareReportPeriods,
  formatMetric,
  reportTrendMetricValue,
  summarizeActivityWeek,
  type ReportDayDatum,
  type ReportMetric,
  type ReportTrendMetric,
} from "../lib/reports";
import { evaluateDailySuccess } from "../lib/dailySuccess";
import { MonthlyTrendCalendar, TREND_METRIC_LABELS, TrendDelta, WeeklyTrendChart } from "../components/reports/TrendCharts";
import { ReportInsightCard, type ReportCardInsight } from "../components/reports/ReportInsightCard";
import { ICON_SIZE } from "../lib/iconSize";
import { EnergyFocusPanel, useEnergyInputs } from "../components/energy/EnergyInsights";
import { todaysCapacity } from "../lib/energyInsights";

const RANGES = [14, 30] as const;
const STAGES: PassStage[] = ["untouched", "red", "young", "mature", "mastered"];
const YIELDS: Yield[] = ["high", "review", "low", "none"];
const KINDS: TrackerKind[] = ["Lecture", "DLA", "PQ", "Lab", "Reading", "Requirement", "Milestone", "Evidence", "Question Block", "Assessment", "Review Loop"];

export function ReportsPage() {
  const s = useStore();
  const [range, setRange] = useState<number>(14);
  const [trendMetric, setTrendMetric] = useState<ReportTrendMetric>("minutes");
  const [selectedTrendDay, setSelectedTrendDay] = useState<string | null>(null);
  const track = resolveTrack(s.profile.educationTrack);
  const minTarget = s.profile.dailyMinuteTarget || 240;
  const cardTarget = s.profile.dailyCardTarget || 120;
  const reportSummary = useMemo(() => buildCanonicalReportSummary(s, range), [s, range]);
  const reportTrends = useMemo(() => buildCanonicalReportTrends(s), [s]);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(s), [s]);
  const effortDays = useMemo(() => buildRecentDays(s, range), [s, range]);
  const activityRhythm = useMemo(() => buildActivityRhythm(s, range), [s, range]);
  const hasTargets = Boolean(s.profile.dailySuccess?.requirements.some((requirement) => requirement.enabled));
  const weeklyComparison = useMemo(
    () => compareReportPeriods(reportTrends.currentWeek, reportTrends.previousWeek, trendMetric),
    [reportTrends, trendMetric],
  );
  const todaySuccess = useMemo(() => evaluateDailySuccess(s, s.activeDayKey, s.activeDayKey), [s]);
  const performance = analyzePerformance({
    logs: s.logs,
    journal: s.journal,
    tasks: s.tasks,
    tracker: s.tracker,
    dayPlans: s.dayPlans,
    activeDayKey: s.activeDayKey,
    minuteTarget: minTarget,
    cardTarget,
    range,
  });
  const readiness = useMemo(() => calculateReadiness({
    date: s.activeDayKey,
    factors: s.energyFactors ?? [],
    journal: s.journal,
    logs: s.logs,
    tasks: s.tasks,
    dayPlans: s.dayPlans,
    productivityTrackers: s.productivityTrackers,
    energyChecks: s.profile.energyChecks,
  }), [s.activeDayKey, s.energyFactors, s.journal, s.logs, s.tasks, s.dayPlans, s.productivityTrackers, s.profile.energyChecks]);
  const energyInputs = useEnergyInputs();
  const capacity = useMemo(() => todaysCapacity(energyInputs, s.activeDayKey), [energyInputs, s.activeDayKey]);

  const days = useMemo(() => reportSummary.observedDates.map((key) => {
    const d = new Date(`${key}T12:00:00`);
    const { minutes, cards } = dayTotals(s.logs, key);
    return { key, date: d, minutes, cards, grade: todayGrade(minutes, cards, { minutes: s.profile.dailyMinuteTarget, cards: s.profile.dailyCardTarget }), active: minutes > 0 || cards > 0 };
  }), [s.logs, reportSummary.observedDates, s.profile.dailyMinuteTarget, s.profile.dailyCardTarget]);

  const activeDays = days.filter((d) => d.active);
  const bestDay = days.reduce<typeof days[number] | null>((best, d) => (!best || d.minutes > best.minutes ? d : best), null);

  const dist = { blue: 0, green: 0, orange: 0, red: 0 };
  activeDays.forEach((d) => dist[d.grade]++);

  // Tracker analytics — the spine of the system, summarized.
  const stageCounts = STAGES.map((stage) => ({ stage, n: s.tracker.filter((t) => passStage(t.passes) === stage).length }));
  const yieldCounts = YIELDS.map((y) => ({ y, n: s.tracker.filter((t) => t.yield === y).length }));
  const kindCounts = KINDS.map((k) => ({ k, n: s.tracker.filter((t) => t.kind === k).length })).filter((x) => x.n > 0);
  const ankiAnchored = s.tracker.filter((t) => t.ankiPasses > 0).length;
  const reviewFlags = s.tracker.filter((t) => t.yield === "review").length;

  const completedTasks = s.tasks.filter((t) => t.done && !t.archived);
  const latestStandups = s.journal.slice(0, 3);
  const readinessEvidenceIds = [...new Set([
    ...(readiness.selfReportedEnergy.source ? [readiness.selfReportedEnergy.source] : []),
    ...readiness.contributions
      .filter((contribution) => contribution.userConfirmed)
      .map((contribution) => contribution.factorId ?? contribution.id),
  ])];
  const capacityMetric: ReportMetric = {
    id: "readiness",
    label: "Capacity today",
    value: capacity.hasEvidence ? capacity.label : "No signal",
    note: !capacity.hasEvidence
      ? "No energy check today"
      : capacity.suggestedMinutes
        ? `Aim for about ${capacity.suggestedMinutes} min of study`
        : capacity.reasons[0],
    numerator: 0,
    denominator: 0,
    period: capacity.typicalMinutes ? `Typical day ${capacity.typicalMinutes} min` : "Against your own history",
    sourceLabel: "One-tap energy checks, journal and closeout energy, sleep you logged, and yesterday’s study minutes",
    sourceRecordIds: capacity.latestEnergy ? [capacity.latestEnergy.at] : [],
    calculation: "Today’s latest energy is compared with your own 30-day average (about 15 points is one step), yesterday’s minutes with your median active day (over 1.4× suggests going lighter, under half leaves room), plus any sleep you logged for today. Go lighter = 75% of your typical minutes; room to push = 110%.",
    interpretation: capacity.hasEvidence
      ? capacity.reasons.join(". ") + "."
      : "Tap how your energy feels right now. AXOM compares it with your own usual, never with a made-up default.",
    action: capacity.hasEvidence ? "Plan today around the suggested minutes; check in again after a break." : "Log a one-tap energy check below.",
    state: capacity.hasEvidence ? (capacity.latestEnergy ? "ready" : "low-data") : "neutral",
  };
  // The legacy performance engine still considers some lifetime journal/plan
  // signals. Never let those older records unlock a directional score for a
  // report window that does not yet contain five canonical active eligible days.
  const performancePreliminary = performance.preliminary || reportSummary.activeDates.length < 5;
  const openTasks = s.tasks.filter((task) => !task.archived && !task.done);
  const overdueOpenTasks = openTasks.filter((task) => task.due && task.due.slice(0, 10) < s.activeDayKey);
  const todayMetric: ReportMetric = {
    id: "daily-success",
    label: "Today’s success",
    value: todaySuccess.eligibleCount ? `${todaySuccess.progress}%` : "No targets",
    note: todaySuccess.statusLabel,
    numerator: todaySuccess.metCount,
    denominator: todaySuccess.eligibleCount,
    period: s.activeDayKey,
    sourceLabel: "Targets scheduled for today and their linked records",
    sourceRecordIds: [...new Set(todaySuccess.requirements.flatMap((requirement) => requirement.sourceRecordIds))],
    calculation: `${todaySuccess.metCount} met ÷ ${todaySuccess.eligibleCount} scheduled targets.`,
    interpretation: todaySuccess.eligibleCount ? todaySuccess.statusLabel : "No optional target is scheduled today.",
    action: "Review today’s targets",
    state: todaySuccess.eligibleCount ? "ready" : "neutral",
  };
  const openTaskMetric: ReportMetric = {
    id: "tasks",
    label: "Open tasks",
    value: `${openTasks.length}`,
    note: `${overdueOpenTasks.length} overdue`,
    numerator: openTasks.length,
    denominator: s.tasks.filter((task) => !task.archived).length,
    period: "Current task state",
    sourceLabel: "Current non-archived tasks",
    sourceRecordIds: openTasks.map((task) => task.id),
    calculation: `${openTasks.length} unfinished non-archived tasks; ${overdueOpenTasks.length} are overdue.`,
    interpretation: overdueOpenTasks.length ? `${overdueOpenTasks.length} overdue task${overdueOpenTasks.length === 1 ? "" : "s"} need a decision.` : openTasks.length ? "Open work is visible without treating it as failure." : "No open tasks are waiting.",
    action: overdueOpenTasks.length ? "Review overdue tasks" : "Review current tasks",
    state: openTasks.length ? "ready" : "neutral",
  };
  const monthlyQuestions = reportTrends.month.reduce((sum, day) => sum + day.questions, 0);
  const questionMetric: ReportMetric = {
    id: "study",
    label: "Question practice",
    value: monthlyQuestions ? `${monthlyQuestions}` : "No data",
    note: "questions this calendar month",
    numerator: monthlyQuestions,
    denominator: reportTrends.month.filter((day) => day.eligible).length,
    period: `${s.activeDayKey.slice(0, 7)} calendar month`,
    sourceLabel: "Activity records labeled as question quantities",
    sourceRecordIds: s.logs
      .filter((log) => reportTrends.month.some((day) => day.dayKey === log.dayKey) && log.quantityKind === "questions")
      .map((log) => log.id),
    calculation: `${monthlyQuestions} net question units after signed daily corrections.`,
    interpretation: monthlyQuestions ? "Practice-question volume is recorded separately from study time." : "No practice-question quantity has been logged this month.",
    action: monthlyQuestions ? "Review question activity" : "Log practice questions",
    state: monthlyQuestions ? "ready" : "neutral",
  };
  const activityCounts = [...new Map(s.logs
    .filter((log) => reportSummary.observedDates.includes(log.dayKey))
    .map((log) => [log.type.trim() || "Activity", 0] as const)).keys()]
    .map((label) => ({ label, count: s.logs.filter((log) => reportSummary.observedDates.includes(log.dayKey) && (log.type.trim() || "Activity") === label).length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const activityMetric: ReportMetric = {
    id: "study",
    label: "Activity mix",
    value: activityCounts[0]?.label ?? "No data",
    note: activityCounts.length ? `${activityCounts.length} recorded activity type${activityCounts.length === 1 ? "" : "s"}` : "No recorded activity",
    numerator: activityCounts[0]?.count ?? 0,
    denominator: s.logs.filter((log) => reportSummary.observedDates.includes(log.dayKey)).length,
    period: reportSummary.metrics.study.period,
    sourceLabel: "Named activity records",
    sourceRecordIds: reportSummary.metrics.study.sourceRecordIds,
    calculation: activityCounts.length ? activityCounts.slice(0, 3).map((item) => `${item.label}: ${item.count}`).join(" · ") : "No named activity records in range.",
    interpretation: activityCounts[0] ? `${activityCounts[0].label} appears most often in this window.` : "Activity distribution appears after a real log.",
    action: "Review activity history",
    state: activityCounts.length ? "ready" : "neutral",
  };
  const trendInsight: ReportCardInsight = {
    change: weeklyComparison.interpretation,
    strongestContributor: weeklyComparison.strongestContributor,
  };
  const weekDays = trendMetric === "requirements" ? reportTrends.currentWeek : calendarWeeks.current;
  const weekPrevious = trendMetric === "requirements" ? reportTrends.previousWeek : calendarWeeks.previous;
  const weekSummary = trendMetric === "requirements" ? null : summarizeActivityWeek(calendarWeeks.current, calendarWeeks.previous, trendMetric);
  const metricTarget = trendTarget(s, trendMetric);
  const selectedDay = [...calendarWeeks.current, ...calendarWeeks.previous, ...reportTrends.currentWeek, ...reportTrends.month].find((day) => day.dayKey === selectedTrendDay);
  const monthActiveDays = reportTrends.month.filter((day) => reportTrendMetricValue(day, trendMetric) > 0).length;
  const monthMetricTotal = reportTrends.month.reduce((sum, day) => sum + reportTrendMetricValue(day, trendMetric), 0);
  const monthBest = [...reportTrends.month]
    .sort((a, b) => reportTrendMetricValue(b, trendMetric) - reportTrendMetricValue(a, trendMetric) || a.dayKey.localeCompare(b.dayKey))[0];
  const monthScored = reportTrends.month.filter((day) => day.scored);
  const monthMet = monthScored.filter((day) => day.status === "met").length;
  const monthSummaryValue = trendMetric === "requirements"
    ? monthScored.length ? Math.round(monthScored.reduce((sum, day) => sum + day.requirementProgress, 0) / monthScored.length) : 0
    : monthMetricTotal;

  return (
    <>
      <GlassCard pad>
        <PanelHeader title="Reports" sub={`Traceable record for ${track.label} — every number is computed from your local study log, tracker, and tasks.`}
          action={
            <div className="row gap8">
              <div className="filter-bar" style={{ margin: 0 }}>
                {RANGES.map((r) => (
                  <button type="button" key={r} className={`filter-pill ${range === r ? "on" : ""}`} onClick={() => setRange(r)}>{r}d</button>
                ))}
              </div>
              <GButton size="sm" onClick={() => void exportStateWithAttachments(s)}><Download size={ICON_SIZE.body} /> Export</GButton>
            </div>} />
      </GlassCard>

      <section className="report-section" aria-labelledby="report-current-title">
        <div className="report-section-heading"><div><span>Current state</span><h2 id="report-current-title">Today</h2></div><p>The signals that can help you decide what to do next.</p></div>
        <div className="grid grid-stats report-card-grid">
          <ReportInsightCard icon={<Target size={ICON_SIZE.emphasis} />} metric={todayMetric} />
          <ReportInsightCard icon={<BatteryCharging size={ICON_SIZE.emphasis} />} metric={capacityMetric} />
          <ReportInsightCard icon={<ListChecks size={ICON_SIZE.emphasis} />} metric={openTaskMetric} />
        </div>
      </section>

      <section className="report-section" aria-labelledby="report-energy-title">
        <div className="report-section-heading"><div><span>Energy &amp; focus</span><h2 id="report-energy-title">Your rhythm</h2></div><p>When you are sharpest, how much today can hold, and what seems to help — from your own check-ins, sessions and questions.</p></div>
        <GlassCard pad className="report-energy-card">
          <EnergyFocusPanel />
        </GlassCard>
      </section>

      <section className="report-section" aria-labelledby="report-trend-title">
        <div className="report-section-heading"><div><span>Pattern over time</span><h2 id="report-trend-title">Trend</h2></div><p>Only scheduled, tracked dates enter requirement comparisons.</p></div>
        <div className="grid grid-stats report-card-grid report-card-grid-two">
          <ReportInsightCard icon={<CalendarCheck size={ICON_SIZE.emphasis} />} metric={hasTargets ? reportSummary.metrics.consistency : activityRhythm.consistency} insight={hasTargets ? trendInsight : { change: weekSummary?.interpretation }} />
          <ReportInsightCard icon={<Flame size={ICON_SIZE.emphasis} />} metric={hasTargets ? reportSummary.metrics.streak : activityRhythm.streak} insight={hasTargets ? trendInsight : { change: weekSummary?.interpretation }} />
        </div>
        <GlassCard pad className="report-week-card">
          <PanelHeader title="Weekly trend" sub={trendMetric === "requirements" ? "Your latest seven days with scheduled targets" : "The last seven calendar days — same days and colors as Productivity"}
            action={trendMetric === "requirements"
              ? <Tag tone={weeklyComparison.sufficient ? "cyan" : "neutral"}>{reportTrends.currentWeek.length}/7 scheduled</Tag>
              : <TrendDelta percentChange={weekSummary?.percentChange ?? null} />} />
          <div className="report-metric-switch" role="group" aria-label="Weekly and monthly trend metric">
            {(["minutes", "questions", "cards", "requirements"] as ReportTrendMetric[]).map((metric) => (
              <button key={metric} className={`filter-pill ${trendMetric === metric ? "on" : ""}`} aria-pressed={trendMetric === metric} onClick={() => setTrendMetric(metric)}>
                {TREND_METRIC_LABELS[metric]}
              </button>
            ))}
          </div>
          {weekSummary && (
            <div className="trend-kpis">
              <span><b>{formatMetric(weekSummary.total, trendMetric)}</b><small>this week</small></span>
              <span><b>{weekSummary.activeDays}/7</b><small>active days</small></span>
              <span><b>{weekSummary.activeDays ? formatMetric(Math.round(weekSummary.total / weekSummary.activeDays), trendMetric) : "—"}</b><small>per active day</small></span>
              <span><b>{weekSummary.bestDayKey ? new Date(`${weekSummary.bestDayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) : "—"}</b><small>strongest day</small></span>
            </div>
          )}
          {trendMetric === "requirements" && !hasTargets ? (
            <div className="report-empty-trend">
              <b>No daily targets yet</b>
              <span>Target completion appears once you choose what makes a day successful. Minutes, questions, and cards above work without targets.</span>
              <a className="gbtn sm" href="#productivity">Choose daily targets</a>
            </div>
          ) : weekDays.length ? (
            <WeeklyTrendChart
              days={weekDays}
              previous={weekPrevious}
              metric={trendMetric}
              target={metricTarget}
              todayKey={s.activeDayKey}
              selected={selectedTrendDay}
              onSelect={setSelectedTrendDay}
            />
          ) : <p className="dim">Not enough scheduled days yet.</p>}
          <div className="report-trend-interpretation">
            <b>{weekSummary ? weekSummary.interpretation : weeklyComparison.interpretation}</b>
            <span>
              {weekSummary
                ? "Bars show each real day; faint bars are the same weekday last week. Hover or focus a bar for details, click it to see the records."
                : `${weeklyComparison.strongestContributor ? `${weeklyComparison.strongestContributor} was the strongest contributor. ` : ""}${weeklyComparison.quietEligibleDays ? `${weeklyComparison.quietEligibleDays} scheduled day${weeklyComparison.quietEligibleDays === 1 ? "" : "s"} had no activity.` : "Only days with scheduled targets are compared."}`}
            </span>
          </div>
        </GlassCard>

        <GlassCard pad className="report-month-card">
          <PanelHeader title="Monthly trend" sub={`${new Date(`${s.activeDayKey}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · each cell is a real calendar day, colored like Productivity`}
            action={<Tag tone={monthActiveDays ? "cyan" : "neutral"}>{monthActiveDays}/{reportTrends.month.length} active</Tag>} />
          <MonthlyTrendCalendar days={reportTrends.month} metric={trendMetric} todayKey={s.activeDayKey} selected={selectedTrendDay} onSelect={setSelectedTrendDay} />
          <div className="report-month-summary">
            <span><b>{trendMetric === "requirements" ? `${monthSummaryValue}%` : formatMetric(monthSummaryValue, trendMetric)}</b> {trendMetric === "requirements" ? "average target completion" : `total ${TREND_METRIC_LABELS[trendMetric].toLowerCase()}`}</span>
            <span><b>{monthBest && reportTrendMetricValue(monthBest, trendMetric) > 0 ? new Date(`${monthBest.dayKey}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</b> best day</span>
            <span><b>{monthScored.length ? `${Math.round((monthMet / monthScored.length) * 100)}%` : hasTargets ? "—" : "No targets"}</b> days with targets met</span>
          </div>
          <div className="report-month-legend">
            {trendMetric === "minutes" ? (
              <>
                {gradeLegend({ minutes: s.profile.dailyMinuteTarget, cards: s.profile.dailyCardTarget }).map((row) => (
                  <span key={row.grade}><i style={{ background: gradeColor(row.grade) }} /> {row.label}</span>
                ))}
              </>
            ) : <span><i style={{ background: "rgb(var(--accent-rgb))" }} /> Logged {TREND_METRIC_LABELS[trendMetric].toLowerCase()}</span>}
            {hasTargets && <span><i className="met" /> dot = daily targets met</span>}
          </div>
        </GlassCard>
        {selectedDay && <DayTrendDetail day={selectedDay} metric={trendMetric} />}
      </section>

      <section className="report-section" aria-labelledby="report-system-title">
        <div className="report-section-heading"><div><span>Learning system</span><h2 id="report-system-title">Study system</h2></div><p>Course progress, question practice, and the work you record.</p></div>
        <div className="grid grid-stats report-card-grid">
          <ReportInsightCard icon={<Layers size={ICON_SIZE.emphasis} />} metric={reportSummary.metrics["tracker-mastery"]} />
          <ReportInsightCard icon={<Activity size={ICON_SIZE.emphasis} />} metric={questionMetric} />
          <ReportInsightCard icon={<Gauge size={ICON_SIZE.emphasis} />} metric={activityMetric} />
        </div>
      </section>

      <details className="report-advanced">
        <summary>More reports and technical detail</summary>
        <div className="stack gap16 report-advanced-body">

      <GlassCard pad className="report-performance-card">
        <PanelHeader title="Performance and confirmed factors" sub="Deterministic calculations with visible local sources."
          action={<Tag tone={performancePreliminary ? "orange" : "green"}>{performancePreliminary ? "Preliminary" : "Enough signal"}</Tag>} />
        {performancePreliminary && (
          <div className="report-prelim">
            <AlertTriangle size={ICON_SIZE.body} />
            <span>Here are preliminary statistics. AXOM needs about 5 days of use before the performance rating becomes meaningfully personalized.</span>
          </div>
        )}
        <div className="report-insight-grid">
          <div>
            <b>Performance</b>
            <span>{performancePreliminary ? `Building baseline · ${reportSummary.activeDates.length}/5 active days with signal` : `${performance.performanceScore}/100 · ${performance.performanceLabel}`}</span>
          </div>
          {readinessEvidenceIds.length > 0 && <div>
            <b>Confirmed factor impact</b>
            <span>{readiness.primarySignal} · {readiness.totalImpact >= 0 ? "+" : ""}{readiness.totalImpact} net · {readiness.carryoverImpact >= 0 ? "+" : ""}{readiness.carryoverImpact} carryover</span>
          </div>}
          {readiness.possibleSignals.length > 0 && <div>
            <b>Possible journal signals</b>
            <span>{readiness.possibleSignals.map((signal) => signal.label).join(", ")} — confirm them in the journal before they count.</span>
          </div>}
        </div>
      </GlassCard>

      <GlassCard pad data-tour="reports-top">
        <PanelHeader title="Effort trend" sub={`Minutes logged per day over the last ${range} days`}
          action={<Tag tone={bestDay && bestDay.minutes > 0 ? "cyan" : "neutral"}>{bestDay && bestDay.minutes > 0 ? `Best: ${bestDay.minutes}m on ${prettyDate(`${bestDay.key}T12:00:00`)}` : "No effort logged yet"}</Tag>} />
        <WeeklyTrendChart
          days={effortDays}
          previous={[]}
          metric="minutes"
          target={trendTarget(s, "minutes")}
          todayKey={s.activeDayKey}
          selected={selectedTrendDay}
          onSelect={setSelectedTrendDay}
        />
        <div className="report-target-line"><span>{reportSummary.metrics["daily-success"].note}</span></div>
      </GlassCard>

      <div className="grid grid-2">
        <GlassCard pad>
          <PanelHeader title="Useful-day distribution" sub={`Grade of each active day in the window`} />
          <div className="stack gap8">
            {(["blue", "green", "orange", "red"] as const).map((g) => {
              const n = dist[g];
              const pct = activeDays.length ? Math.round((n / activeDays.length) * 100) : 0;
              return (
                <div className="report-bar-row" key={g}>
                  <div className="report-bar-label" style={{ color: gradeColor(g) }}>{gradeLabel(g).replace("👑 ", "")}</div>
                  <div className="report-bar-track">
                    <div className="report-bar-fill" style={{ width: `${pct}%`, background: gradeColor(g) }} />
                  </div>
                  <div className="report-bar-val">{n} day{n === 1 ? "" : "s"}</div>
                </div>
              );
            })}
            {!activeDays.length && <div className="dim">No active days in this window yet.</div>}
          </div>
        </GlassCard>

        <GlassCard pad>
          <PanelHeader title="Mastery pipeline" sub="Where your tracker items sit on the pass ladder" />
          {s.tracker.length === 0 ? (
            <div className="dim">No tracker items yet — install a blueprint or import a list.</div>
          ) : (
            <>
              <div className="report-pipeline">
                {stageCounts.map(({ stage, n }) => {
                  const pct = Math.round((n / s.tracker.length) * 100);
                  return (
                    <div className="report-pipe-seg" key={stage} title={`${PASS_LABEL[stage]}: ${n}`}
                      style={{ flexGrow: Math.max(n, 0.001), background: PASS_COLOR[stage] }}>
                      {pct >= 8 ? n : ""}
                    </div>
                  );
                })}
              </div>
              <div className="report-pipe-legend">
                {stageCounts.map(({ stage, n }) => (
                  <span key={stage}><i style={{ background: PASS_COLOR[stage] }} /> {PASS_LABEL[stage]} · {n}</span>
                ))}
              </div>
              <div className="report-yield-row">
                {yieldCounts.filter((x) => x.n > 0).map(({ y, n }) => (
                  <Tag key={y} tone={YIELD_TONE[y]}>{YIELD_LABEL[y]}: {n}</Tag>
                ))}
                {reviewFlags > 0 && <Tag tone="red">{reviewFlags} need review</Tag>}
              </div>
            </>
          )}
        </GlassCard>
      </div>

      <GlassCard pad>
        <PanelHeader title="Coverage by course" sub="Tracker readiness and review pressure mapped onto your course shells" />
        {s.courses.length === 0 ? (
          <div className="dim">No courses yet. Your program's starter structure loads from onboarding or Settings → Personalization.</div>
        ) : (
          <div className="stack gap8">
            {s.courses.map((c) => {
              const cov = courseCoverage(c, s.tracker);
              return (
                <div className="report-course-row" key={c.id}>
                  <div className="report-course-head">
                    <div className="grow">
                      <div className="report-course-code">{c.code}</div>
                      <div className="sub">{c.name || "—"}</div>
                    </div>
                    <Tag tone="cyan">{c.modules.length} modules</Tag>
                    <Tag tone={cov.items ? (cov.ready >= 70 ? "green" : cov.ready >= 35 ? "orange" : "neutral") : "neutral"}>
                      {cov.items ? `${cov.ready}% ready` : "no rows"}
                    </Tag>
                  </div>
                  <div className="report-bar-track">
                    <div className="report-bar-fill" style={{ width: `${cov.ready}%`, background: cov.ready >= 70 ? PASS_COLOR.mastered : cov.ready >= 35 ? PASS_COLOR.young : "color-mix(in srgb, var(--cyan) 34%, transparent)" }} />
                  </div>
                  <div className="report-course-foot sub">
                    {cov.items} tracker row{cov.items === 1 ? "" : "s"}
                    {cov.review ? ` · ${cov.review} need review` : ""}
                    {cov.highYield ? ` · ${cov.highYield} high-yield` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {kindCounts.length > 0 && (
        <GlassCard pad>
          <PanelHeader title="Item mix" sub="What kind of work your tracker is made of" />
          <div className="row wrap gap8">
            {kindCounts.map(({ k, n }) => <Tag key={k} tone="neutral">{k}: {n}</Tag>)}
            <Tag tone="purple">{ankiAnchored} anchored in Anki</Tag>
          </div>
        </GlassCard>
      )}

      <div className="grid grid-2">
        <GlassCard pad>
          <PanelHeader title="Task report" sub="Completed work is the task archive" />
          <div className="stack gap8">
            {completedTasks.length === 0 && <div className="dim">No completed tasks yet.</div>}
            {completedTasks.slice(0, 8).map((t) => (
              <div className="report-row" key={t.id}>
                <div className="grow">
                  <div className="report-course-code">{t.title}</div>
                  <div className="sub">{t.scope || "Unscoped"}{t.completedAt ? ` · completed ${t.completedAt.slice(0, 10)}` : ""}</div>
                </div>
                <Tag tone="green">done</Tag>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard pad>
          <PanelHeader title="Standup report" sub="Latest journal standups" />
          <div className="stack gap8">
            {latestStandups.length === 0 && <div className="dim">No standups yet.</div>}
            {latestStandups.map((j) => (
              <div className="report-row" key={j.id}>
                <div className="grow">
                  <div className="report-course-code">{j.date.slice(0, 10)}</div>
                  <div className="sub">{j.today}</div>
                </div>
                {j.energy && <Tag tone={j.energy === "High" ? "green" : j.energy === "Medium" ? "orange" : "red"}>{j.energy}</Tag>}
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

        </div>
      </details>

    </>
  );
}

function DayTrendDetail({ day, metric }: { day: ReportDayDatum; metric: ReportTrendMetric }) {
  return (
    <div className="report-day-detail" role="status">
      <b>{prettyDate(`${day.dayKey}T12:00:00`)}</b>
      <span>{reportTrendMetricValue(day, metric)} {metric} · {day.eligible ? day.status === "pending" ? "still in progress" : day.status === "met" ? "targets met" : "scheduled target not met" : "not scheduled"}</span>
      <small>{day.minutes} minutes · {day.questions} questions · {day.cards} cards · {day.requirementProgress}% target completion</small>
    </div>
  );
}

function courseCoverage(course: { code: string; name: string; modules: { name: string }[] }, tracker: ReturnType<typeof useStore.getState>["tracker"]) {
  const needles = [course.code, course.name, ...course.modules.map((m) => m.name)]
    .map((v) => v.toLowerCase().replace(/\s+/g, "")).filter(Boolean);
  const items = tracker.filter((item) => {
    const hay = `${item.path} ${item.label}`.toLowerCase().replace(/\s+/g, "");
    return needles.some((needle) => needle && hay.includes(needle));
  });
  const ready = scopeMastery(items);
  const review = items.filter((i) => i.yield === "review" || i.passes < 2).length;
  const highYield = items.filter((i) => i.yield === "high").length;
  return { items: items.length, ready, review, highYield };
}

/** The daily target for a metric, from Daily requirements (or the legacy minute target). */
function trendTarget(state: ReturnType<typeof useStore.getState>, metric: ReportTrendMetric): number | undefined {
  if (metric === "requirements") return 100;
  const requirements = state.profile.dailySuccess?.requirements.filter((requirement) => requirement.enabled) ?? [];
  const kind = metric === "minutes" ? "study-minutes" : metric === "questions" ? "practice-questions" : "cards-reviewed";
  const match = requirements.find((requirement) => requirement.source.kind === kind && requirement.schedule.kind === "daily");
  if (match) return match.target;
  if (!state.profile.dailySuccess && metric === "minutes") return state.profile.dailyMinuteTarget || undefined;
  return undefined;
}
