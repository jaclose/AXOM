import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, BookOpen, CalendarDays, Clock, HelpCircle, History, Layers, Minus, Plus, Target, Timer, TrendingUp, X, Zap } from "lucide-react";
import { useStore } from "../lib/store";
import { dayTotals, gradeTargetsFor, isoDate, prettyDate, productiveTotals, todayGrade, type Grade, type GradeTargets } from "../lib/scoring";
import { previousLocalDateKey } from "../lib/dailyRollover";
import type { StudyLog } from "../lib/types";
import { GlassCard, GButton, PanelHeader, Tag } from "../components/ui/primitives";
import { Pomodoro } from "../components/productivity/Pomodoro";
import { ActivityLabelInput } from "../components/productivity/ActivityLabelInput";
import { DailyProgressVessel } from "../components/productivity/DailyProgressVessel";
import { StudyStreakMonitor } from "../components/productivity/StudyStreakMonitor";
import { DailyRequirementsEditor } from "../components/productivity/DailyRequirementsEditor";
import { TrackerManager } from "../components/productivity/TrackerManager";
import { useInView } from "../lib/useInView";
import { gotoJournalDay } from "../lib/uiStore";
import { evaluateDailySuccess } from "../lib/dailySuccess";
import { frequentActivityShortcuts, recentActivityShortcuts, type ActivityShortcut } from "../lib/activityShortcuts";
import { ModuleTour, type ModuleTourStep } from "../components/shell/ModuleTour";
import { ICON_SIZE } from "../lib/iconSize";
import { canonicalStudyLogs } from "../lib/targetContributions";
import { productivityInsight, formatStudyMinutes, recordedActivityEvidence } from "../lib/productivityInsights";
import { usePomodoro } from "../lib/pomodoro";
import { ActivityIntelligence } from "../components/productivity/ActivityIntelligence";
import { ProductivitySaveStatus, useProductivitySaveStatus } from "../components/productivity/ProductivitySaveStatus";
import "../styles/productivity.css";

export const PRODUCTIVITY_TOUR_STEPS: readonly ModuleTourStep[] = [
  { target: "productivity-log", title: "Log activity", body: "Name what mattered, then add time, quantity, or a note only when it helps. One Log button records the activity." },
  { target: "productivity-targets", title: "Choose targets", body: "Targets are optional signals you chose. AXOM scores only the targets scheduled for the day." },
  { target: "productivity-focus", title: "Use the focus timer", body: "Choose a preset or run a custom session. Completed and meaningful partial sessions can feed the same activity history." },
  { target: "productivity-trends", title: "Read trends", body: "Weekly and monthly views appear after enough real activity. Before then, AXOM keeps the interpretation neutral." },
] as const;

type ManualQuantityType = "cards" | "questions" | "pages" | "repetitions" | "count";

const QUANTITY_META: Record<ManualQuantityType, { label: string; placeholder: string }> = {
  questions: { label: "Questions", placeholder: "20 questions" },
  cards: { label: "Cards", placeholder: "40 cards" },
  pages: { label: "Pages", placeholder: "12 pages" },
  repetitions: { label: "Repetitions", placeholder: "10 repetitions" },
  count: { label: "Count", placeholder: "1" },
};

const SELF_REPORT_TEMPLATES: ReadonlyArray<{ label: string; activity: string; quantity: ManualQuantityType }> = [
  { label: "Study", activity: "Study", quantity: "count" },
  { label: "Questions", activity: "Question Bank", quantity: "questions" },
  { label: "Anki", activity: "Anki review", quantity: "cards" },
  { label: "Reading", activity: "Reading", quantity: "pages" },
  { label: "Exercise", activity: "Exercise", quantity: "count" },
];

export function ProductivityPage() {
  const s = useStore();
  const saveStatus = useProductivitySaveStatus();
  const running = usePomodoro((state) => state.running);
  const logs = useMemo(() => canonicalStudyLogs(s.logs).reverse(), [s.logs]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [manualType, setManualType] = useState("");
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualQuantityKind, setManualQuantityKind] = useState<ManualQuantityType>("count");
  const [manualNote, setManualNote] = useState("");
  const [manualTrackerId, setManualTrackerId] = useState("");
  const [lastSelfReport, setLastSelfReport] = useState(false);
  const [moduleTourOpen, setModuleTourOpen] = useState(false);
  const strip = useInView<HTMLDivElement>();

  const viewKey = pickedDay ?? s.activeDayKey;
  const evidence = recordedActivityEvidence(s, viewKey);
  const totals = dayTotals(logs, viewKey);
  const productive = productiveTotals(logs, viewKey);
  const isActive = viewKey === s.activeDayKey;
  const yesterdayKey = previousLocalDateKey(s.activeDayKey);
  // Cheap selector over the current store snapshot. Memoizing the whole store
  // object here was both unnecessary and dependency-fragile; calculate it on
  // render so new requirements/logs can never leave the period floor stale.
  const trackingFloor = productivityTrackingFloor(s, logs);
  const weekly = useMemo(() => summarizePeriod(logs, daysEndingOn(s.activeDayKey, 7).filter((date) => isoDate(date) >= trackingFloor), "week", s.activeDayKey, gradeTargetsFor(s.profile)), [logs, s.activeDayKey, trackingFloor, s.profile]);
  const monthly = useMemo(() => summarizePeriod(logs, currentMonthDays(s.activeDayKey), "month", s.activeDayKey, gradeTargetsFor(s.profile)), [logs, s.activeDayKey, s.profile]);
  const monthCells = useMemo(() => buildMonthCells(monthly.days), [monthly.days]);
  const calendarToday = s.activeDayKey;
  const visibleTrackers = s.productivityTrackers.filter((tracker) => tracker.visible && !tracker.archived);
  const dailyProgress = useMemo(() => evaluateDailySuccess(s, viewKey, s.activeDayKey), [s, viewKey]);
  const recent = useMemo(() => recentActivityShortcuts(logs, s.profile.hiddenActivityShortcuts), [logs, s.profile.hiddenActivityShortcuts]);
  const recentSignatures = useMemo(() => new Set(recent.map((item) => item.signature)), [recent]);
  const frequent = useMemo(() => frequentActivityShortcuts(logs, s.profile.hiddenActivityShortcuts, 2, 3, recentSignatures), [logs, s.profile.hiddenActivityShortcuts, recentSignatures]);
  const patternDays = new Set(logs.filter((log) => log.dayKey <= s.activeDayKey).map((log) => log.dayKey)).size;

  function logManual() {
    const minutes = Math.max(0, Number(manualMinutes) || 0);
    const quantity = Math.max(0, Number(manualQuantity) || 0);
    if (!manualType.trim()) return;
    s.logActivity({
      label: manualType,
      trackerId: manualTrackerId || undefined,
      minutes,
      quantity,
      quantityKind: quantity ? (manualQuantityKind === "pages" || manualQuantityKind === "repetitions" ? "count" : manualQuantityKind) : undefined,
      quantityLabel: quantity ? manualQuantityKind : undefined,
      note: manualNote || undefined,
    });
    setManualType(""); setManualMinutes(""); setManualQuantity(""); setManualNote(""); setManualTrackerId("");
    setLastSelfReport(true);
  }

  function applySelfReportTemplate(template: typeof SELF_REPORT_TEMPLATES[number]) {
    setManualType(template.activity);
    setManualQuantityKind(template.quantity);
    setManualMinutes("");
    setManualQuantity("");
    setManualTrackerId("");
    setLastSelfReport(false);
  }

  function fillShortcut(shortcut: ActivityShortcut) {
    setLastSelfReport(false);
    setManualType(shortcut.label);
    setManualTrackerId(shortcut.trackerId ?? "");
    setManualMinutes(shortcut.minutes ? String(shortcut.minutes) : "");
    setManualQuantity(shortcut.quantity ? String(shortcut.quantity) : "");
    const semantic = shortcut.quantityLabel?.toLowerCase();
    setManualQuantityKind(
      shortcut.quantityKind === "count" && (semantic === "pages" || semantic === "repetitions")
        ? semantic
        : shortcut.quantityKind ?? "count",
    );
  }

  function fillGoalActivity(label: string, unit: string) {
    const quantity: ManualQuantityType =
      unit === "cards" || unit === "questions" || unit === "pages" || unit === "repetitions"
        ? unit
        : "count";
    setManualType(label);
    setManualQuantityKind(quantity);
    setManualMinutes("");
    setManualQuantity("");
    setManualTrackerId("");
    setManualNote("");
    setLastSelfReport(false);
    document.querySelector<HTMLInputElement>("#productivity-log .fast-activity-label")?.focus();
  }

  function hideShortcut(signature: string) {
    s.updateProfile({
      hiddenActivityShortcuts: [...new Set([...(s.profile.hiddenActivityShortcuts ?? []), signature])].slice(-100),
    });
  }

  return (
    <>
      <div className="productivity-primary-grid">
      <GlassCard pad id="productivity-log" data-tour="log" data-module-tour="productivity-log">
        <PanelHeader
          title="Log an activity"
          headingLevel={2}
          sub={isActive ? "Record study, questions, exercise, reading, or anything else that mattered." : `Viewing ${prettyDate(`${viewKey}T12:00:00`)}. Targets reflect current settings.`}
          action={isActive ? (
            <div className="row wrap gap6">
              <GButton size="sm" onClick={() => setPickedDay(yesterdayKey)}><History size={ICON_SIZE.body} /> Yesterday</GButton>
              <GButton size="sm" onClick={() => gotoJournalDay(yesterdayKey)}><BookOpen size={ICON_SIZE.body} /> Catch-up</GButton>
              <GButton size="sm" onClick={() => setModuleTourOpen(true)} aria-label="Open Productivity help tour"><HelpCircle size={ICON_SIZE.body} /> Help</GButton>
            </div>
          ) : <div className="row wrap gap6"><GButton size="sm" onClick={() => setPickedDay(null)}>Back to today</GButton><GButton size="sm" onClick={() => setModuleTourOpen(true)} aria-label="Open Productivity help tour"><HelpCircle size={ICON_SIZE.body} /> Help</GButton></div>} />
        {isActive ? (
          <>
            <div className="productivity-report-context">
              <span><Activity size={ICON_SIZE.body} aria-hidden="true" /> Self-report</span>
              <small>Self-reported time counts as activity. Avoid logging minutes already covered by an auto-logged focus session.</small>
            </div>
            <form className="fast-activity-logger" aria-label="Log self-reported activity" onSubmit={(event) => { event.preventDefault(); logManual(); }}>
              <ActivityLabelInput value={manualType} onChange={(value) => { setManualType(value); setLastSelfReport(false); }} />
              <div className="self-report-templates" aria-label="Quick self-report templates">
                {SELF_REPORT_TEMPLATES.map((template) => (
                  <button type="button" key={template.label} aria-label={`Use ${template.label} template`}
                    className={manualType === template.activity ? "on" : ""}
                    onClick={() => applySelfReportTemplate(template)}>{template.label}</button>
                ))}
              </div>
              <div className="fast-activity-measures" aria-label="Optional activity measurements">
                <label className="fast-field"><span>How long? (optional)</span><div><input className="field" aria-label="How long in minutes?" type="number" min="0" placeholder="30" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} /><small>min</small></div></label>
                <div className="fast-field quantity"><span>Quantity (optional)</span><div>
                  <input className="field" aria-label={QUANTITY_META[manualQuantityKind].label} type="number" min="0" placeholder={QUANTITY_META[manualQuantityKind].placeholder} value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} />
                  <select className="field" aria-label="Quantity type" value={manualQuantityKind} onChange={(event) => setManualQuantityKind(event.target.value as ManualQuantityType)}>
                    <option value="count">Count</option>
                    <option value="questions">Questions</option>
                    <option value="cards">Cards</option>
                    <option value="pages">Pages</option>
                    <option value="repetitions">Repetitions</option>
                  </select>
                </div></div>
              </div>
              <label className="fast-field fast-activity-note"><span>Note (optional)</span><input className="field" aria-label="Note (optional)" placeholder="Add context if it will help later" value={manualNote} onChange={(event) => setManualNote(event.target.value)} /></label>
              <GButton variant="primary" type="submit" disabled={!manualType.trim()}><Plus size={ICON_SIZE.body} /> Log</GButton>
            </form>
            <ProductivitySaveStatus status={saveStatus} />
            {lastSelfReport && <p className="self-report-confirmation" role="status">
              Activity added. Your save status appears above.
            </p>}
            <details className="activity-category-disclosure">
              <summary>Category and contribution (optional)</summary>
              <label><span>Use existing category</span><select className="field" aria-label="Productivity category" value={manualTrackerId} onChange={(event) => setManualTrackerId(event.target.value)}>
                <option value="">Infer from this activity</option>
                {visibleTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}
              </select></label>
            </details>

            {(recent.length > 0 || frequent.length > 0) && (
              <div className="activity-shortcuts">
                {recent.length > 0 && <ShortcutGroup title="Recent" items={recent} onFill={fillShortcut} onHide={hideShortcut} />}
                {frequent.length > 0 && <ShortcutGroup title="Frequent" items={frequent} onFill={fillShortcut} onHide={hideShortcut} />}
              </div>
            )}
            <DailyProgressVessel result={dailyProgress} dayLabel="Today" />
            <section id="productivity-targets" className="today-targets" aria-labelledby="today-targets-title" data-module-tour="productivity-targets">
              <div>
                <h3 id="today-targets-title">What makes today successful</h3>
                <p>Set one goal in seconds. Change the detailed rules only when you need them.</p>
              </div>
              <DailyRequirementsEditor onFillActivity={fillGoalActivity} />
            </section>
          </>
        ) : (
          <>
            <DailyProgressVessel result={dailyProgress} dayLabel="Selected day" />
            <div className="historical-log-lock">
            <History size={ICON_SIZE.emphasis} aria-hidden="true" />
            <span><b>History is read-only.</b><small>Return to today before logging so an old view cannot change the current day.</small></span>
            </div>
          </>
        )}
        <div className="productivity-evidence">{evidence.cardReviews} in-app card reviews · {evidence.trackerPasses} recorded tracker passes <small>Separate records, dated in your current local time zone. No time or mastery inferred.</small></div>
        <div className="console-totals" aria-label="Viewed day totals">
          <span><Clock size={ICON_SIZE.body} /> {totals.minutes} study minutes</span>
          {totals.cards > 0 && <span><Layers size={ICON_SIZE.body} /> {totals.cards} cards</span>}
          {productive.minutes !== totals.minutes && <span>{productive.minutes} total productive minutes</span>}
        </div>
      </GlassCard>

      <div id="productivity-focus" className="productivity-focus-stack" data-module-tour="productivity-focus">
        <Pomodoro />
        {isActive && <StudyStreakMonitor state={s} result={dailyProgress} />}
      </div>
      </div>
      {isActive && <ActivityIntelligence insight={productivityInsight(s, saveStatus === "failed", running)} />}
      {isActive && <TrackerManager />}

      {patternDays >= 3 && <div className="productivity-analytics" data-module-tour="productivity-trends">
        <GlassCard pad className="productivity-intel" data-tour="insights">
          <PanelHeader title="Weekly activity" sub="Calendar-aligned 7-day view of minutes and optional quantities"
            action={<Tag tone="neutral">{weekly.activeDays}/{weekly.days.length} active</Tag>} />
          <div className="period-metrics">
            <Metric icon={<Clock size={ICON_SIZE.body} />} label="Study time" value={formatStudyMinutes(weekly.minutes)} note={`${weekly.avgMinutes}m / active day`} />
            <Metric icon={<Layers size={ICON_SIZE.body} />} label="Cards" value={`${weekly.cards}`} note={`${weekly.avgCards} / active day`} />
            <Metric icon={<TrendingUp size={ICON_SIZE.body} />} label="Consistency" value={`${weekly.consistency}%`} note="Days with recorded activity" />
            <Metric icon={<Target size={ICON_SIZE.body} />} label="Recorded days" value={`${weekly.activeDays}`} note="Activity recorded in this period" />
          </div>
          <div className={`productivity-strip reveal-bars ${strip.inView ? "in-view" : ""}`} ref={strip.ref}>
            {weekly.days.map((d) => <DayPillar key={d.key} day={d} onPick={() => setPickedDay(d.key)} />)}
          </div>
          <InsightList insights={weekly.insights} />
        </GlassCard>

        <GlassCard pad className="month-intel">
          <PanelHeader title="Monthly activity calendar" sub={`${monthly.label} · each cell follows the real calendar day`}
            action={<Tag tone="neutral">{monthly.activeDays}/{monthly.days.filter((day) => day.key <= s.activeDayKey && day.key >= trackingFloor).length} active</Tag>} />
          <div className="month-summary">
            <Metric icon={<Activity size={ICON_SIZE.body} />} label="Month result" value={formatStudyMinutes(monthly.minutes)} note={`${monthly.cards} cards`} />
            <Metric icon={<CalendarDays size={ICON_SIZE.body} />} label="Best day" value={monthly.bestDay ? shortDate(monthly.bestDay.key) : "None"} note={monthly.bestDay ? `${monthly.bestDay.minutes}m · ${monthly.bestDay.cards} cards` : "log a session"} />
          </div>
          <div className="calendar-month">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span className="cal-head" key={d}>{d}</span>)}
            {monthCells.map((cell, i) => cell
              ? <button key={cell.key} disabled={cell.key > calendarToday} className={`cal-day ${cell.key === viewKey ? "on" : ""} ${cell.key === calendarToday ? "today" : ""}`}
                  style={{ borderColor: cell.active ? "var(--gold-line)" : undefined }}
                  title={cell.key > calendarToday ? `${shortDate(cell.key)}: future date` : `${shortDate(cell.key)}: ${cell.minutes}m, ${cell.cards} cards`}
                  onClick={() => setPickedDay(cell.key)}>
                  <span>{cell.date.getDate()}</span>
                  <i style={{ background: cell.active ? "var(--gold)" : "var(--hairline)" }} />
                </button>
              : <span className="cal-day blank" key={`blank-${i}`} />)}
          </div>
          <InsightList insights={monthly.insights} compact />

        </GlassCard>
      </div>}

      <ActivityLog logs={isActive ? logs : logs.filter((log) => log.dayKey === viewKey)} activeDayKey={s.activeDayKey} />
      {moduleTourOpen && (
        <ModuleTour name="Productivity" route="productivity" steps={PRODUCTIVITY_TOUR_STEPS} onExit={() => setModuleTourOpen(false)} />
      )}
    </>
  );
}

interface PeriodDay {
  key: string;
  date: Date;
  minutes: number;
  cards: number;
  grade: Grade;
  active: boolean;
  intensity: number;
}

interface PeriodSummary {
  label: string;
  days: PeriodDay[];
  minutes: number;
  cards: number;
  activeDays: number;
  avgMinutes: number;
  avgCards: number;
  consistency: number;
  grade: Grade;
  strongDays: PeriodDay[];
  needsWorkDays: PeriodDay[];
  bestDay?: PeriodDay;
  insights: { tone: "green" | "orange" | "red" | "cyan" | "neutral"; title: string; body: string }[];
}

function ShortcutGroup({
  title,
  items,
  onFill,
  onHide,
}: {
  title: string;
  items: ActivityShortcut[];
  onFill: (item: ActivityShortcut) => void;
  onHide: (signature: string) => void;
}) {
  return (
    <section className="activity-shortcut-group" aria-label={`${title} activity shortcuts`}>
      <span>{title}</span>
      <div>
        {items.map((item) => (
          <div className="activity-shortcut" key={item.signature}>
            <button type="button" onClick={() => onFill(item)}>
              <b>{item.label}</b>
              <small>{shortcutDetail(item)}{title === "Frequent" ? ` · ${item.uses} uses` : ""}</small>
            </button>
            <button type="button" aria-label={`Hide ${item.label} shortcut`} onClick={() => onHide(item.signature)}><X size={ICON_SIZE.microInline} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function shortcutDetail(item: ActivityShortcut): string {
  const parts = [];
  if (item.minutes) parts.push(`${item.minutes} min`);
  if (item.quantity) parts.push(`${item.quantity} ${item.quantityLabel ?? item.quantityKind ?? "count"}`);
  return parts.join(" · ") || "One completion";
}

function Metric({
  icon, label, value, note,
}: {
  icon: ReactNode; label: string; value: string; note: string;
}) {
  return (
    <div className="metric-tile">
      <span>{icon}</span>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </div>
  );
}

function DayPillar({ day, onPick }: { day: PeriodDay; onPick: () => void }) {
  const label = day.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
  return (
    <button className="day-pillar" onClick={onPick} title={`${shortDate(day.key)}: ${day.minutes}m, ${day.cards} cards`}>
      <div className="day-pillar-track">
        <div
          className="day-pillar-fill"
          style={{ height: `${day.active ? Math.max(10, day.intensity) : 4}%`, background: day.active ? "var(--gold)" : "var(--hairline)" }}
        />
      </div>
      <span>{label}</span>
      <small>{day.minutes || day.cards ? formatStudyMinutes(day.minutes) : "none"}</small>
    </button>
  );
}

function InsightList({
  insights, compact = false,
}: {
  insights: PeriodSummary["insights"]; compact?: boolean;
}) {
  return (
    <div className={`insight-list ${compact ? "compact" : ""}`}>
      {insights.map((insight) => (
        <div className={`insight insight-${insight.tone}`} key={insight.title}>
          <b>{insight.title}</b>
          <span>{insight.body}</span>
        </div>
      ))}
    </div>
  );
}

function summarizePeriod(logs: ReturnType<typeof useStore.getState>["logs"], dates: Date[], span: "week" | "month", activeDayKey: string, targets?: GradeTargets): PeriodSummary {
  const days = dates.map((date) => {
    const key = isoDate(date);
    const totals = key > activeDayKey ? { minutes: 0, cards: 0 } : dayTotals(logs, key);
    const grade = todayGrade(totals.minutes, totals.cards, targets);
    const recorded = key <= activeDayKey && logs.some((log) => log.dayKey === key);
    const intensity = Math.min(100, Math.max((totals.minutes / 480) * 100, (totals.cards / 350) * 100));
    return { key, date, minutes: totals.minutes, cards: totals.cards, grade, active: recorded, intensity };
  });
  const minutes = days.reduce((sum, d) => sum + d.minutes, 0);
  const cards = days.reduce((sum, d) => sum + d.cards, 0);
  const active = days.filter((d) => d.active);
  const activeDays = active.length;
  const strongDays = days.filter((d) => d.grade === "green" || d.grade === "blue");
  const redActiveDays = days.filter((d) => d.active && d.grade === "red");
  const quietDays = days.filter((d) => !d.active && d.key < activeDayKey);
  const needsWorkDays = [...redActiveDays, ...quietDays];
  const avgMinutes = activeDays ? Math.round(minutes / activeDays) : 0;
  const avgCards = activeDays ? Math.round(cards / activeDays) : 0;
  const elapsedDays = days.filter((day) => day.key <= activeDayKey).length;
  const consistency = Math.round((activeDays / Math.max(elapsedDays, 1)) * 100);
  const grade = todayGrade(avgMinutes, avgCards, targets);
  const bestDay = [...active].sort((a, b) => b.intensity - a.intensity || b.minutes - a.minutes || b.cards - a.cards)[0];
  const monthName = days[0]?.date.toLocaleDateString(undefined, { month: "long", year: "numeric" }) ?? "Month";
  const label = span === "week" ? "Last 7 days" : monthName;

  return {
    label,
    days,
    minutes,
    cards,
    activeDays,
    avgMinutes,
    avgCards,
    consistency,
    grade,
    strongDays,
    needsWorkDays,
    bestDay: bestDay?.active ? bestDay : undefined,
    insights: buildInsights({ span, days, activeDays, strongDays, redActiveDays, quietDays, avgMinutes, avgCards, bestDay }),
  };
}

function buildInsights({
  activeDays, avgMinutes, avgCards, bestDay,
}: {
  span: "week" | "month";
  days: PeriodDay[];
  activeDays: number;
  strongDays: PeriodDay[];
  redActiveDays: PeriodDay[];
  quietDays: PeriodDay[];
  avgMinutes: number;
  avgCards: number;
  bestDay?: PeriodDay;
}): PeriodSummary["insights"] {
  const insights: PeriodSummary["insights"] = [];

  if (bestDay?.active) {
    insights.push({ tone: "cyan", title: "Most activity recorded", body: `${shortDate(bestDay.key)}: ${bestDay.minutes} minutes and ${bestDay.cards} cards.` });
  }

  if (activeDays === 0) {
    insights.push({
      tone: "neutral",
      title: "No logged activity yet",
      body: "Log any named activity and this panel will start building a real weekly and monthly pattern.",
    });
  } else {
    insights.push({
      tone: "cyan",
      title: "Current active-day average",
      body: `${avgMinutes} minutes${avgCards ? ` and ${avgCards} cards` : ""} per active day. These are recorded amounts, not a measure of mastery.`,
    });
  }

  return insights.slice(0, 4);
}

function currentMonthDays(activeDayKey: string): Date[] {
  const now = localDateFromKey(activeDayKey);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days: Date[] = [];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
  for (let d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

function daysEndingOn(activeDayKey: string, count: number): Date[] {
  const end = localDateFromKey(activeDayKey);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (count - index - 1));
    return date;
  });
}

function localDateFromKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function productivityTrackingFloor(state: ReturnType<typeof useStore.getState>, logs: readonly StudyLog[]): string {
  const starts = state.profile.dailySuccess?.requirements
    .filter((requirement) => requirement.enabled)
    .map((requirement) => requirement.trackingStartsAt)
    .filter(Boolean) ?? [];
  const firstLog = [...logs].sort((a, b) => a.dayKey.localeCompare(b.dayKey))[0]?.dayKey;
  return [...starts, ...(firstLog ? [firstLog] : [])].sort()[0] ?? state.activeDayKey;
}

function buildMonthCells(days: PeriodDay[]): Array<PeriodDay | null> {
  const first = days[0];
  const blanks = first ? first.date.getDay() : 0;
  return [...Array.from({ length: blanks }, () => null), ...days];
}

// GitHub-style activity feed: every logged study event as a timeline row,
// grouped by day, newest first — "you logged a lecture at this time".
function ActivityLog({ logs, activeDayKey }: { logs: StudyLog[]; activeDayKey: string }) {
  const [expanded, setExpanded] = useState(false);
  const feedId = useId();
  const previewLimit = 5;
  const expandedLimit = 200;
  const limit = expanded ? expandedLimit : previewLimit;
  const visible = logs.slice(0, limit);
  const groups = useMemo(() => groupLogsByDay(visible), [visible]);
  const todayKey = activeDayKey;
  const canExpand = logs.length > previewLimit || logs.some((log) => log.note);
  const expandLabel = logs.length > expandedLimit
    ? `Show latest ${expandedLimit} events`
    : logs.length > previewLimit ? `Show all ${logs.length} events` : "Expand notes";

  return (
    <GlassCard pad className={`activity-log-card${expanded ? " is-expanded" : " is-preview"}`} role="region" aria-label="Activity Log">
      <PanelHeader title="Activity Log" headingLevel={2} sub="Recent activity, newest first. Your full history stays available."
        action={
          <div className="row gap6">
            <Tag tone={logs.length ? "cyan" : "neutral"}>{logs.length} event{logs.length === 1 ? "" : "s"}</Tag>
            <a className="gbtn sm" href="#activity">View full activity</a>
          </div>
        } />
      {logs.length === 0 ? (
        <div className="activity-empty">
          <History size={ICON_SIZE.control} />
          <div>
            <b>No activity yet</b>
            <span>Log any named activity above and each entry will appear here as a timeline.</span>
          </div>
        </div>
      ) : (
        <>
          <p className="activity-preview-count" aria-live="polite">
            Showing {visible.length} of {logs.length} event{logs.length === 1 ? "" : "s"}
            {logs.length > expandedLimit && expanded ? ". Open full activity for older entries." : "."}
          </p>
          <div className="activity-feed" id={feedId}>
            {groups.map((group) => (
              <div className="activity-day" key={group.key}>
                <div className="activity-day-head">
                  <span>{group.key === todayKey ? "Today" : prettyDate(`${group.key}T12:00:00`)}</span>
                  <small>{group.minutes}m · {group.cards} cards</small>
                </div>
                {group.entries.map((log) => {
                  const meta = describeLog(log);
                  return (
                    <div className="activity-row" key={log.id}>
                      <span className={`activity-dot ${meta.tone}`}>{meta.icon}</span>
                      <div className="activity-main">
                        <span className="activity-text">{meta.text}</span>
                        {log.note && <span className="activity-note">{log.note}</span>}
                      </div>
                      <span className="activity-time">{formatLogTime(log.ts)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {canExpand && (
            <button type="button" className="activity-toggle" aria-expanded={expanded} aria-controls={feedId} onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Show less" : expandLabel}
            </button>
          )}
        </>
      )}
    </GlassCard>
  );
}

interface ActivityGroup { key: string; minutes: number; cards: number; entries: StudyLog[] }

function groupLogsByDay(logs: StudyLog[]): ActivityGroup[] {
  const order: string[] = [];
  const map = new Map<string, ActivityGroup>();
  for (const log of logs) {
    let group = map.get(log.dayKey);
    if (!group) {
      group = { key: log.dayKey, minutes: 0, cards: 0, entries: [] };
      map.set(log.dayKey, group);
      order.push(log.dayKey);
    }
    group.entries.push(log);
    group.minutes += log.minutes;
    group.cards += log.cards;
  }
  return order.map((key) => map.get(key)!);
}

function describeLog(log: StudyLog): { text: string; tone: string; icon: ReactNode } {
  const type = log.type || "Study";
  const lower = type.toLowerCase();
  const parts: string[] = [];
  if (log.cards) parts.push(`${log.cards > 0 ? "+" : ""}${log.cards} card${Math.abs(log.cards) === 1 ? "" : "s"}`);
  if (log.quantity && log.quantityKind && log.quantityKind !== "cards") {
    const unit = log.quantityLabel || log.quantityKind;
    parts.push(`${log.quantity} ${unit}`);
  }
  if (log.minutes) parts.push(`${log.minutes > 0 ? "+" : ""}${log.minutes}m`);
  const detail = parts.length ? ` · ${parts.join(" · ")}` : "";
  const correction = log.minutes < 0 || log.cards < 0;
  let icon: ReactNode = <Clock size={ICON_SIZE.body} />;
  let tone = "neutral";
  if (correction) { icon = <Minus size={ICON_SIZE.body} />; tone = "red"; }
  else if (lower.includes("anki") || lower.includes("card")) { icon = <Layers size={ICON_SIZE.body} />; tone = "green"; }
  else if (lower.includes("pomodoro")) { icon = <Timer size={ICON_SIZE.body} />; tone = "purple"; }
  else if (log.quantityKind === "questions") { icon = <Target size={ICON_SIZE.body} />; tone = "cyan"; }
  else if (lower.includes("lecture")) { icon = <BookOpen size={ICON_SIZE.body} />; tone = "cyan"; }
  else if (lower.includes("deep")) { icon = <Zap size={ICON_SIZE.body} />; tone = "orange"; }
  return { text: `${correction ? "Corrected" : "Logged"} ${type}${detail}`, tone, icon };
}

function formatLogTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortDate(key: string): string {
  return prettyDate(`${key}T00:00:00`);
}
