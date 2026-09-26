import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BookText, ArrowRight,
  Database, Download, ShieldCheck, PackageCheck,
  Sunrise, Trophy, Check, Circle, ArrowRightCircle, ExternalLink,
  SlidersHorizontal, GripVertical, PlusCircle, X,
  AlertTriangle, CalendarClock,
  BookOpenCheck, ListTodo, BatteryMedium, Activity, Flame, Gamepad2,
  ChevronUp, ChevronDown, GraduationCap, Target, Gauge, Timer, BarChart3, Sparkles,
  CalendarDays, Map as MapIcon, TrendingUp, Stethoscope, Link2, LayoutGrid,
} from "lucide-react";
import { ICON_SIZE } from "../lib/iconSize";
import { useLuster } from "../lib/useLuster";
import { useStore } from "../lib/store";
import { dayTotals, productiveTotals, todayGrade, gradeLabel, gradeColor, prettyDate, lastNDays, isoDate } from "../lib/scoring";
import { missedStandupDays, planForDay } from "../lib/journal";
import type {
  TrackerItem, DashboardLayoutPreferences, DashboardWidgetId,
  DashboardWidgetPreferences, DashboardWidgetSize,
} from "../lib/types";
import { exportState } from "../lib/backup";
import { gotoJournalDay, useUi } from "../lib/uiStore";
import { useInView } from "../lib/useInView";
import { DEFAULT_DASHBOARD_WIDGETS, DEFAULT_HIDDEN_DASHBOARD_WIDGETS } from "../lib/seed";
import { calculateReadiness } from "../lib/energy";
import { pickFocusExam, buildExamCountdown, countdownHeadline, type PrepIntensity } from "../lib/examPlan";
import { AnimatedProgressBar } from "../components/ui/motion";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag } from "../components/ui/primitives";
import { Pomodoro } from "../components/productivity/Pomodoro";
import { CommandBrief } from "../components/brief/CommandBrief";
import { CloseoutModal } from "../components/brief/CloseoutModal";
import { DailyProgressVessel } from "../components/productivity/DailyProgressVessel";
import { evaluateDailySuccess, type DailySuccessResult } from "../lib/dailySuccess";
import { closeoutForDay } from "../lib/closeout";
import { dailyLoopReminderLedger, normalizeDailyLoopReminderPreferences } from "../lib/dailyLoopReminders";
import {
  CURRENT_DASHBOARD_WIDGET_IDS,
  DASHBOARD_LAYOUT_PRESETS,
  adaptLegacyDashboardLayout,
  applyDashboardLayoutPreset,
  dashboardWidgetCatalogItem,
  defaultDashboardWidgetPreferences,
  extraLargeWidgetRecommendation,
  normalizeDashboardLayoutPreferences,
} from "../lib/dashboardWidgets";
import {
  DashboardWidgetFrame,
  type DashboardWidgetFrameSettings,
} from "../components/dashboard/DashboardWidgetFrame";
import { Modal } from "../components/ui/Modal";
import { dueQuestions, questionMappingStatus, summarizeQuestionMappings } from "../lib/questions";
import { deriveDailyWordStatsFromNormalizedHistory } from "../lib/dailyWordStats";

const HOSTED_ALPHA_URL = "https://noctyrium-cktjdhuhw-jacloses-projects.vercel.app/#dashboard";

const FIXED_DASHBOARD_SURFACES = new Set<DashboardWidgetId>(["welcome", "commandBrief"]);
const CURRENT_DASHBOARD_ID_SET = new Set<string>(CURRENT_DASHBOARD_WIDGET_IDS);

export function DashboardPage() {
  const s = useStore();
  const [editDashboard, setEditDashboard] = useState(false);
  const luster = useLuster();
  const [pendingExtraLargeLayout, setPendingExtraLargeLayout] = useState<DashboardLayoutPreferences | null>(null);
  const dailyProgress = useMemo(() => evaluateDailySuccess(s, s.activeDayKey, s.activeDayKey), [s]);
  const week = weeklySummary(s);
  const readiness = useMemo(() => calculateReadiness({
    date: s.activeDayKey,
    factors: s.energyFactors ?? [],
    journal: s.journal,
    logs: s.logs,
    tasks: s.tasks,
    dayPlans: s.dayPlans,
    productivityTrackers: s.productivityTrackers,
  }), [s.activeDayKey, s.energyFactors, s.journal, s.logs, s.tasks, s.dayPlans, s.productivityTrackers]);
  const layout = useMemo(
    () => resolveDashboardLayout(s.profile.dashboardLayout, s.profile.dashboardWidgetOrder, s.profile.hiddenDashboardWidgets),
    [s.profile.dashboardLayout, s.profile.dashboardWidgetOrder, s.profile.hiddenDashboardWidgets],
  );
  const hiddenWidgets = new Set(layout.hiddenWidgetIds);
  const visibleWidgetIds = layout.order.filter((id, index, order) => (
    CURRENT_DASHBOARD_ID_SET.has(id)
    && !FIXED_DASHBOARD_SURFACES.has(id as DashboardWidgetId)
    && !hiddenWidgets.has(id)
    && order.indexOf(id) === index
  )) as DashboardWidgetId[];

  function saveLayout(nextValue: DashboardLayoutPreferences) {
    const next = normalizeDashboardLayoutPreferences(nextValue) ?? nextValue;
    s.updateProfile({ dashboardLayout: next });
  }

  function saveWidgetSettings(widgetId: DashboardWidgetId, settings: DashboardWidgetFrameSettings) {
    const current = layout.widgets[widgetId] ?? defaultDashboardWidgetPreferences(widgetId);
    const next: DashboardLayoutPreferences = {
      ...layout,
      preset: "custom",
      widgets: {
        ...layout.widgets,
        [widgetId]: {
          ...current,
          size: settings.size,
          enabledFields: Object.entries(settings.fields).filter(([, enabled]) => enabled).map(([id]) => id),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    const recommendation = extraLargeWidgetRecommendation(next);
    if (current.size !== "extra-large" && settings.size === "extra-large" && recommendation.shouldShow) {
      setPendingExtraLargeLayout(next);
      return;
    }
    saveLayout(next);
  }

  function renderWidget(widgetId: DashboardWidgetId) {
    const meta = dashboardWidgetCatalogItem(widgetId);
    const preferences = layout.widgets[widgetId] ?? defaultDashboardWidgetPreferences(widgetId);
    const enabledFields = new Set(preferences.enabledFields ?? []);
    const configurableFields = widgetConfigurableFields(widgetId, preferences);
    const content = renderDashboardWidget({
      widgetId,
      size: preferences.size,
      enabledFields,
      dailyProgress,
      week,
      readiness,
      activeDayKey: s.activeDayKey,
      state: s,
    });
    if (!content) return null;
    return (
      <DashboardWidgetFrame
        key={widgetId}
        widgetId={widgetId}
        title={meta.label}
        size={preferences.size}
        allowedSizes={meta.supportedSizes}
        fields={configurableFields}
        settingsDescription="Choose the amount of space and detail this widget deserves."
        onSave={(settings) => saveWidgetSettings(widgetId, settings)}
      >
        {content}
      </DashboardWidgetFrame>
    );
  }

  return (
    <>
      <AlphaBuildBanner
        profileName={s.profile.name}
        activeDayKey={s.activeDayKey}
      />

      <CommandBrief readiness={readiness} />

      <StandupPrompt />

      <div className="dashboard-edit-toolbar">
        <GhostButton
          className="dashboard-edit-toggle"
          aria-expanded={editDashboard}
          onClick={() => setEditDashboard((open) => !open)}
        >
          <SlidersHorizontal size={ICON_SIZE.body} /> {editDashboard ? "Done editing" : "Edit dashboard"}
        </GhostButton>
      </div>
      {editDashboard && (
        <GlassCard pad className="dashboard-editor-panel">
          <DashboardWidgetEditor layout={layout} onChange={saveLayout} />
        </GlassCard>
      )}

      <section className="dashboard-widget-grid" aria-label="Dashboard widgets" {...luster}>
        {visibleWidgetIds.map(renderWidget)}
      </section>

      {pendingExtraLargeLayout && (
        <Modal
          title="Keep the dashboard readable?"
          onClose={() => setPendingExtraLargeLayout(null)}
          footer={(
            <>
              <GButton onClick={() => setPendingExtraLargeLayout(null)}>Keep recommended layout</GButton>
              <GButton variant="primary" onClick={() => {
                saveLayout(pendingExtraLargeLayout);
                setPendingExtraLargeLayout(null);
              }}>Add anyway</GButton>
              <GhostButton onClick={() => {
                saveLayout({ ...pendingExtraLargeLayout, dismissedExtraLargeRecommendation: true });
                setPendingExtraLargeLayout(null);
              }}>Do not ask again</GhostButton>
            </>
          )}
        >
          <p>AXOM usually recommends no more than three extra-large widgets to keep the dashboard readable. Continue anyway?</p>
        </Modal>
      )}
    </>
  );
}

function AlphaBuildBanner({
  profileName, activeDayKey,
}: {
  profileName: string;
  activeDayKey: string;
}) {
  const updateProfile = useStore((state) => state.updateProfile);
  const displayName = explicitDisplayName(profileName);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dailyState = dailyDashboardMessage(activeDayKey);
  const date = new Date(`${activeDayKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  function saveName(event: FormEvent) {
    event.preventDefault();
    updateProfile({ name: nameDraft.trim().slice(0, 120) });
    setEditingName(false);
    setNameDraft("");
  }

  return (
    <div className="alpha-build-banner">
      <div className="alpha-build-copy">
        <span>{date}</span>
        <div className="alpha-build-title" aria-live="polite">
          {displayName ? `Welcome, ${displayName}` : "Welcome"}
        </div>
        {!displayName && !editingName && (
          <button
            type="button"
            className="alpha-add-name"
            onClick={() => setEditingName(true)}
          >
            Add your name
          </button>
        )}
        {!displayName && editingName && (
          <form className="alpha-name-form" onSubmit={saveName}>
            <label htmlFor="dashboard-display-name">Display name</label>
            <input
              ref={nameInputRef}
              id="dashboard-display-name"
              value={nameDraft}
              maxLength={120}
              autoComplete="name"
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <GButton size="tiny" variant="primary" type="submit"><Check size={ICON_SIZE.body} /> Save</GButton>
            <GhostButton type="button" onClick={() => {
              setEditingName(false);
              setNameDraft("");
            }}><X size={ICON_SIZE.body} /> Cancel</GhostButton>
          </form>
        )}
        <p>{dailyState}</p>
      </div>
    </div>
  );
}

/** A display name must be explicitly user-authored, never a seed or initials. */
export function explicitDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || /^(axom|noctyrium)$/i.test(name)) return null;
  return name.slice(0, 120);
}

const DASHBOARD_MESSAGES = [
  "Do the honest block. Then do the next one.",
  "A clean hour beats a noisy day.",
  "Protect the floor; the ceiling takes care of itself.",
  "Questions reveal the map. Review repairs it.",
  "You are not behind if you return with a plan.",
  "Make today legible: effort, evidence, next move.",
  "Small retrieval done daily is not small.",
  "The goal is not panic. The goal is contact with the work.",
  "Good medicine starts with good attention.",
  "Be precise, be kind, keep moving.",
];

function dailyDashboardMessage(key: string) {
  const code = key.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return DASHBOARD_MESSAGES[code % DASHBOARD_MESSAGES.length];
}

const WRAP_MESSAGES = [
  "Close the loop while the day is still fresh.",
  "A short honest review is enough.",
  "Record the signal before memory edits it.",
  "Name the blocker, keep the useful part.",
  "End clean so tomorrow starts lighter.",
];

function wrapUpMessage(key: string) {
  const code = key.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return WRAP_MESSAGES[code % WRAP_MESSAGES.length];
}

function DashboardWidgetEditor({
  layout,
  onChange,
}: {
  layout: DashboardLayoutPreferences;
  onChange: (next: DashboardLayoutPreferences) => void;
}) {
  const s = useStore();
  const [dragId, setDragId] = useState<DashboardWidgetId | null>(null);
  const [overId, setOverId] = useState<DashboardWidgetId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hidden = new Set(layout.hiddenWidgetIds);
  const orderedIds = [
    ...layout.order.filter((id): id is DashboardWidgetId => CURRENT_DASHBOARD_ID_SET.has(id)),
    ...CURRENT_DASHBOARD_WIDGET_IDS.filter((id) => !layout.order.includes(id)),
  ].filter((id, index, values) => values.indexOf(id) === index && !FIXED_DASHBOARD_SURFACES.has(id));
  const visible = orderedIds.filter((id) => !hidden.has(id));
  const experimentalIds = new Set<DashboardWidgetId>(["dailyWord"]);
  const hiddenIds = orderedIds.filter((id) => hidden.has(id));
  const suggested = hiddenIds.filter((id) => !experimentalIds.has(id) && widgetIsSuggested(id, s));
  const available = hiddenIds.filter((id) => !experimentalIds.has(id) && !layout.order.includes(id));
  const hiddenCatalog = hiddenIds.filter((id) => !experimentalIds.has(id) && !suggested.includes(id) && !available.includes(id));
  const experimental = orderedIds.filter((id) => experimentalIds.has(id));

  function update(patch: Partial<DashboardLayoutPreferences>) {
    onChange({
      ...layout,
      ...patch,
      preset: patch.preset ?? "custom",
      updatedAt: new Date().toISOString(),
    });
  }

  function remove(id: DashboardWidgetId) {
    const next = new Set(hidden);
    next.add(id);
    update({ hiddenWidgetIds: [...next] });
    setAnnouncement(`${dashboardWidgetCatalogItem(id).label} removed. Its data was kept.`);
  }

  function add(id: DashboardWidgetId) {
    const next = new Set(hidden);
    next.delete(id);
    const order = layout.order.includes(id) ? layout.order : [...layout.order, id];
    update({ hiddenWidgetIds: [...next], order });
    setAnnouncement(`${dashboardWidgetCatalogItem(id).label} added to the dashboard.`);
  }

  function move(id: DashboardWidgetId, direction: -1 | 1) {
    const visibleIndex = visible.indexOf(id);
    const neighbor = visible[visibleIndex + direction];
    if (!neighbor) return;
    const current = [...layout.order];
    const from = current.indexOf(id);
    const to = current.indexOf(neighbor);
    if (from < 0 || to < 0) return;
    [current[from], current[to]] = [current[to], current[from]];
    update({ order: current });
    setAnnouncement(`${dashboardWidgetCatalogItem(id).label} moved ${direction < 0 ? "earlier" : "later"}.`);
  }

  function handleDrop(targetId: DashboardWidgetId) {
    if (!dragId || dragId === targetId) return;
    const current = [...layout.order];
    const from = current.indexOf(dragId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update({ order: next });
    setAnnouncement(`${dashboardWidgetCatalogItem(dragId).label} moved to position ${to + 1}.`);
    setDragId(null);
    setOverId(null);
  }

  return (
    <div className="dashboard-widget-editor">
      <div className="widget-editor-head">
        <div>
          <span className="widget-library-eyebrow">Edit dashboard</span>
          <b>Build your dashboard</b>
          <span>Choose what deserves your attention. Hidden widgets keep their data.</span>
        </div>
        <div className="dashboard-preset-picker" aria-label="Dashboard presets">
          {DASHBOARD_LAYOUT_PRESETS.filter((preset) => preset.id !== "custom").map((preset) => (
            <button
              type="button"
              className={layout.preset === preset.id ? "on" : ""}
              key={preset.id}
              title={preset.description}
              onClick={() => {
                onChange(applyDashboardLayoutPreset(layout, preset.id));
                setAnnouncement(`${preset.label} dashboard preset applied.`);
              }}
            >{preset.label}</button>
          ))}
        </div>
      </div>

      <p className="dashboard-fixed-surfaces"><ShieldCheck size={ICON_SIZE.body} /> Welcome and Command Brief stay at the top so orientation and the best next action are never lost.</p>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      <div className="widget-editor-zones">
        <section className="widget-editor-zone">
          <div className="widget-zone-title">On your dashboard</div>
          {visible.length === 0 && <div className="widget-zone-empty">Your fixed welcome and Command Brief remain visible. Add a widget when it earns the space.</div>}
          {visible.map((id, index) => {
            const meta = dashboardWidgetCatalogItem(id);
            return (
              <article className={`widget-library-row draggable ${overId === id ? "drop-target" : ""}`} key={id}
                draggable
                onDragStart={() => setDragId(id)}
                onDragOver={(event) => { event.preventDefault(); setOverId(id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDrop={(event) => { event.preventDefault(); handleDrop(id); }}>
                <GripVertical size={ICON_SIZE.emphasis} className="widget-grip" />
                <WidgetPreview kind={id} />
                <div className="grow">
                  <b>{meta.label}</b>
                  <span>{meta.description}</span>
                  <small>{preferencesSizeLabel(layout.widgets[id]?.size ?? meta.defaultSize)} · {widgetDataStatus(id, s)}</small>
                </div>
                <div className="widget-row-actions">
                  <button type="button" aria-label={`Move ${meta.label} up`} disabled={index === 0} onClick={() => move(id, -1)}><ChevronUp size={ICON_SIZE.body} /></button>
                  <button type="button" aria-label={`Move ${meta.label} down`} disabled={index === visible.length - 1} onClick={() => move(id, 1)}><ChevronDown size={ICON_SIZE.body} /></button>
                  <button type="button" aria-label={`Remove ${meta.label}`} onClick={() => remove(id)}><X size={ICON_SIZE.body} /></button>
                </div>
              </article>
            );
          })}
        </section>

        <WidgetCatalogSection title="Suggested" ids={suggested} layout={layout} state={s} onAdd={add} />
        <WidgetCatalogSection title="Available" ids={available} layout={layout} state={s} onAdd={add} />
        <WidgetCatalogSection title="Experimental" ids={experimental} layout={layout} state={s} onAdd={add} />
        <WidgetCatalogSection title="Hidden" ids={hiddenCatalog} layout={layout} state={s} onAdd={add} />
      </div>

      <div className="row">
        <GButton size="sm" onClick={() => {
          onChange(applyDashboardLayoutPreset(layout, "focused"));
          setAnnouncement("Focused dashboard restored. No source data changed.");
        }}>
          Restore focused defaults
        </GButton>
        <span className="sub">Saved locally with your profile and included in portable backups.</span>
      </div>
    </div>
  );
}

function WidgetCatalogSection({
  title,
  ids,
  layout,
  state,
  onAdd,
}: {
  title: string;
  ids: DashboardWidgetId[];
  layout: DashboardLayoutPreferences;
  state: ReturnType<typeof useStore.getState>;
  onAdd: (id: DashboardWidgetId) => void;
}) {
  return (
    <section className="widget-editor-zone available">
      <div className="widget-zone-title">{title}</div>
      {ids.length === 0 && <div className="widget-zone-empty">Nothing here right now.</div>}
      {ids.map((id) => {
        const meta = dashboardWidgetCatalogItem(id);
        const visible = !layout.hiddenWidgetIds.includes(id);
        return (
          <article className={`widget-library-row off ${visible ? "already-on" : ""}`} key={id}>
            <PlusCircle size={ICON_SIZE.emphasis} className="widget-grip" />
            <WidgetPreview kind={id} />
            <div className="grow">
              <b>{meta.label}</b>
              <span>{meta.description}</span>
              <small>{meta.supportedSizes.map(preferencesSizeLabel).join(" · ")} · {widgetDataStatus(id, state)}</small>
            </div>
            {visible
              ? <Tag tone="green">On dashboard</Tag>
              : <GButton size="sm" onClick={() => onAdd(id)}>Add</GButton>}
          </article>
        );
      })}
    </section>
  );
}

/** Each widget gets its own glyph and tint so the library scans at a glance. */
const WIDGET_GLYPHS: Record<DashboardWidgetId, { icon: typeof Database; tone: string }> = {
  welcome: { icon: Sunrise, tone: "gold" },
  commandBrief: { icon: ArrowRightCircle, tone: "gold" },
  questionBank: { icon: BookOpenCheck, tone: "violet" },
  courseTracker: { icon: GraduationCap, tone: "cool" },
  tasks: { icon: ListTodo, tone: "green" },
  readiness: { icon: BatteryMedium, tone: "green" },
  activity: { icon: Activity, tone: "cool" },
  journal: { icon: BookText, tone: "rose" },
  streak: { icon: Flame, tone: "orange" },
  dailyWord: { icon: Gamepad2, tone: "violet" },
  winDay: { icon: Target, tone: "gold" },
  todayScore: { icon: Gauge, tone: "green" },
  examCountdown: { icon: CalendarClock, tone: "rose" },
  pomodoro: { icon: Timer, tone: "orange" },
  weekly: { icon: BarChart3, tone: "cool" },
  suggested: { icon: Sparkles, tone: "gold" },
  aiActions: { icon: Sparkles, tone: "violet" },
  schedule: { icon: CalendarDays, tone: "cool" },
  termMap: { icon: MapIcon, tone: "cool" },
  localData: { icon: Database, tone: "green" },
  latestStandup: { icon: Sunrise, tone: "gold" },
  productivityTrend: { icon: TrendingUp, tone: "cool" },
  premedHours: { icon: Stethoscope, tone: "rose" },
  resourceFocus: { icon: Link2, tone: "cool" },
  boardBlueprint: { icon: LayoutGrid, tone: "violet" },
};

function WidgetPreview({ kind }: { kind: DashboardWidgetId }) {
  const glyph = WIDGET_GLYPHS[kind] ?? { icon: LayoutGrid, tone: "cool" };
  const Icon = glyph.icon;
  return (
    <span className={`widget-preview widget-glyph tone-${glyph.tone}`} aria-hidden="true">
      <Icon size={ICON_SIZE.control} />
    </span>
  );
}

function resolveDashboardLayout(
  stored: unknown,
  legacyOrder: unknown,
  legacyHidden: unknown,
): DashboardLayoutPreferences {
  const normalized = normalizeDashboardLayoutPreferences(stored, {
    order: legacyOrder,
    hiddenWidgetIds: legacyHidden,
  });
  if (normalized) return normalized;
  const legacy = adaptLegacyDashboardLayout({ order: legacyOrder, hiddenWidgetIds: legacyHidden });
  const isUntouchedLegacyDefault = sameStringList(legacyOrder, DEFAULT_DASHBOARD_WIDGETS)
    && sameStringList(legacyHidden, DEFAULT_HIDDEN_DASHBOARD_WIDGETS);
  return isUntouchedLegacyDefault
    ? applyDashboardLayoutPreset(legacy, "focused", "1970-01-01T00:00:00.000Z")
    : legacy;
}

function sameStringList(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function preferencesSizeLabel(size: DashboardWidgetSize) {
  return size === "extra-large" ? "Extra large" : `${size.slice(0, 1).toUpperCase()}${size.slice(1)}`;
}

const WIDGET_FIELDS_IMPLEMENTED = new Set<DashboardWidgetId>([
  "questionBank", "courseTracker", "tasks", "readiness", "activity", "journal",
  "streak", "dailyWord", "todayScore", "weekly",
]);

function widgetConfigurableFields(widgetId: DashboardWidgetId, preferences: DashboardWidgetPreferences) {
  if (!WIDGET_FIELDS_IMPLEMENTED.has(widgetId)) return [];
  const enabled = new Set(preferences.enabledFields ?? []);
  return dashboardWidgetCatalogItem(widgetId).fields.map((field) => ({
    id: field.id,
    label: field.label,
    checked: enabled.has(field.id),
  }));
}

interface DashboardWidgetRenderContext {
  widgetId: DashboardWidgetId;
  size: DashboardWidgetSize;
  enabledFields: Set<string>;
  dailyProgress: DailySuccessResult;
  week: ReturnType<typeof weeklySummary>;
  readiness: ReturnType<typeof calculateReadiness>;
  activeDayKey: string;
  state: ReturnType<typeof useStore.getState>;
}

function renderDashboardWidget(context: DashboardWidgetRenderContext) {
  const { widgetId, size, enabledFields, dailyProgress, week, readiness, activeDayKey, state } = context;
  if (widgetId === "winDay") return <WinTheDay />;
  if (widgetId === "todayScore") return <TodayScoreWidget result={dailyProgress} activeDayKey={activeDayKey} enabledFields={enabledFields} />;
  if (widgetId === "examCountdown") return <ExamCountdownWidget />;
  if (widgetId === "pomodoro") return <Pomodoro compact />;
  if (widgetId === "weekly") return <WeeklyWidget week={week} enabledFields={enabledFields} />;
  if (widgetId === "questionBank") return <QuestionBankWidget size={size} enabledFields={enabledFields} />;
  if (widgetId === "courseTracker") return <CourseTrackerDashboardWidget size={size} enabledFields={enabledFields} />;
  if (widgetId === "tasks") return <TasksDashboardWidget size={size} enabledFields={enabledFields} />;
  if (widgetId === "readiness") return <ReadinessDashboardWidget readiness={readiness} enabledFields={enabledFields} />;
  if (widgetId === "activity") return <ActivityDashboardWidget activeDayKey={activeDayKey} week={week} enabledFields={enabledFields} />;
  if (widgetId === "journal") return <JournalDashboardWidget activeDayKey={activeDayKey} enabledFields={enabledFields} />;
  if (widgetId === "streak") return <ConsistencyDashboardWidget state={state} enabledFields={enabledFields} />;
  if (widgetId === "dailyWord") return <DailyWordDashboardWidget activeDayKey={activeDayKey} enabledFields={enabledFields} />;
  if (widgetId === "localData") return <LocalDataWidget state={state} />;
  if (widgetId === "premedHours") return <PremedHoursWidget />;
  return null;
}

function widgetDataStatus(id: DashboardWidgetId, s: ReturnType<typeof useStore.getState>) {
  if (id === "questionBank") {
    const summary = summarizeQuestionMappings(s.questions);
    return s.questions.length ? `${summary.ready} ready · ${summary.issueCount} to review` : "No questions imported";
  }
  if (id === "courseTracker") {
    const rows = realTrackerRows(s.tracker);
    return rows.length ? `${rows.length} real study items` : "Waiting for your first real item";
  }
  if (id === "tasks") {
    const open = realTasks(s.tasks).filter((task) => !task.done && !task.archived).length;
    return open ? `${open} open` : "No real open tasks";
  }
  if (id === "readiness") return s.energyFactors.length || s.journal.length ? "Local signals available" : "No confirmed signal yet";
  if (id === "activity") return s.logs.some((log) => log.dayKey === s.activeDayKey) ? "Activity logged today" : "No activity today";
  if (id === "journal") return s.journal.length ? `${s.journal.length} local entr${s.journal.length === 1 ? "y" : "ies"}` : "No entries yet";
  if (id === "dailyWord") return s.profile.experimentalFlags?.dailyGames ? "Daily Games enabled" : "Optional module is off";
  if (id === "todayScore") return s.profile.dailySuccess?.requirements.some((item) => item.enabled) ? "Targets configured" : "No targets selected";
  if (id === "examCountdown") return pickFocusExam(s.boardPrep) ? "Exam focus available" : "No exam focus yet";
  if (id === "premedHours") return s.premedExperiences.length ? `${s.premedExperiences.length} experiences` : "No experience entries yet";
  if (id === "localData") return "Stored on this device";
  if (id === "winDay") return s.dayPlans.some((plan) => plan.dayKey === s.activeDayKey) ? "Checked in today" : "Ready for today";
  if (id === "weekly" || id === "streak") return s.logs.length ? "History available" : "Learning your rhythm";
  if (id === "pomodoro") return "Ready to focus";
  return "Available";
}

function widgetIsSuggested(id: DashboardWidgetId, s: ReturnType<typeof useStore.getState>) {
  if (id === "winDay" || id === "todayScore" || id === "pomodoro") return true;
  if (id === "questionBank") return s.questions.length > 0;
  if (id === "courseTracker") return realTrackerRows(s.tracker).length > 0;
  if (id === "tasks") return realTasks(s.tasks).some((task) => !task.done && !task.archived);
  if (id === "readiness") return s.energyFactors.length > 0 || s.journal.length > 0;
  if (id === "activity" || id === "weekly" || id === "streak") return s.logs.length > 0;
  if (id === "journal") return s.journal.length > 0;
  if (id === "examCountdown") return Boolean(pickFocusExam(s.boardPrep));
  if (id === "premedHours") return s.premedExperiences.length > 0;
  return false;
}

function realTrackerRows(rows: TrackerItem[]) {
  return rows.filter((row) => !/^example(?:[:\s]|$)/i.test(row.label.trim()));
}

function realTasks(tasks: ReturnType<typeof useStore.getState>["tasks"]) {
  const starter = new Set([
    "create today's standup",
    "add your real lecture/dla/pq list",
    "save progress from settings",
  ]);
  return tasks.filter((task) => !starter.has(task.title.trim().toLowerCase()));
}

function QuestionBankWidget({
  size,
  enabledFields,
}: {
  size: DashboardWidgetSize;
  enabledFields: Set<string>;
}) {
  const questions = useStore((s) => s.questions);
  const mapping = summarizeQuestionMappings(questions);
  const ready = questions.filter((question) => questionMappingStatus(question) === "ready");
  const due = dueQuestions(ready);
  const attempts = ready.flatMap((question) => question.attempts);
  const scored = attempts.filter((attempt) => attempt.status === "correct" || attempt.status === "incorrect");
  const accuracy = scored.length ? Math.round((scored.filter((attempt) => attempt.status === "correct").length / scored.length) * 100) : null;
  return (
    <GlassCard pad className="dashboard-core-widget question-bank-widget">
      <PanelHeader title="Question Bank" sub="Only trusted mappings can enter a scored block"
        action={<a className="gbtn sm primary" href="#questions"><BookOpenCheck size={ICON_SIZE.body} /> Open</a>} />
      {questions.length === 0 ? (
        <div className="dashboard-widget-empty"><BookOpenCheck size={ICON_SIZE.control} /><b>No practice questions yet</b><span>Import a source or save the document first. AXOM will not invent an answer key.</span></div>
      ) : (
        <>
          <div className="dashboard-widget-focal"><b>{mapping.ready}</b><span>ready to practice</span></div>
          <div className="dashboard-widget-metrics">
            {enabledFields.has("due") && <span><b>{due.length}</b> due</span>}
            {enabledFields.has("needsReview") && <span><b>{mapping.issueCount}</b> mapping review</span>}
            {enabledFields.has("accuracy") && <span><b>{accuracy === null ? "—" : `${accuracy}%`}</b> attempt accuracy</span>}
          </div>
          {size !== "small" && mapping.issueCount > 0 && <p className="dashboard-widget-note">Review uncertain answer evidence before those questions become runnable.</p>}
        </>
      )}
    </GlassCard>
  );
}

function CourseTrackerDashboardWidget({
  size,
  enabledFields,
}: {
  size: DashboardWidgetSize;
  enabledFields: Set<string>;
}) {
  const tracker = useStore((s) => s.tracker);
  const rows = realTrackerRows(tracker);
  const untouched = rows.filter((row) => row.passes === 0);
  const weak = rows.filter((row) => row.yield === "review" || (row.passes > 0 && row.passes < 2));
  const progress = rows.length ? Math.round(rows.reduce((sum, row) => sum + Math.min(4, row.passes), 0) / (rows.length * 4) * 100) : 0;
  return (
    <GlassCard pad className="dashboard-core-widget course-tracker-widget">
      <PanelHeader title="Course Tracker" sub="Real course items, passes, and untouched work"
        action={<a className="gbtn sm primary" href="#tracker"><ArrowRight size={ICON_SIZE.body} /> Open</a>} />
      {rows.length === 0 ? (
        <div className="dashboard-widget-empty"><BookText size={ICON_SIZE.control} /><b>Add or import your first study item</b><span>Shipped examples teach the interface but never count as your workload.</span></div>
      ) : (
        <>
          {enabledFields.has("progress") && <div className="dashboard-widget-focal"><b>{progress}%</b><span>pass progress</span></div>}
          <div className="dashboard-widget-metrics">
            {enabledFields.has("untouched") && <span><b>{untouched.length}</b> untouched</span>}
            {enabledFields.has("weak") && <span><b>{weak.length}</b> need another pass</span>}
            <span><b>{rows.length}</b> real items</span>
          </div>
          {size !== "small" && enabledFields.has("suggestion") && <p className="dashboard-widget-note">{untouched[0] ? `Start with ${untouched[0].label}.` : weak[0] ? `Revisit ${weak[0].label}.` : "Your tracked items have at least one pass."}</p>}
        </>
      )}
    </GlassCard>
  );
}

function TasksDashboardWidget({
  size,
  enabledFields,
}: {
  size: DashboardWidgetSize;
  enabledFields: Set<string>;
}) {
  const tasks = realTasks(useStore((s) => s.tasks));
  const today = isoDate(new Date());
  const open = tasks.filter((task) => !task.done && !task.archived);
  const overdue = open.filter((task) => task.due && task.due.slice(0, 10) < today);
  const completed = tasks.filter((task) => task.done).length;
  return (
    <GlassCard pad className="dashboard-core-widget tasks-widget">
      <PanelHeader title="Tasks" sub="Due work without the setup examples"
        action={<a className="gbtn sm primary" href="#tasks"><ListTodo size={ICON_SIZE.body} /> Open</a>} />
      <div className="dashboard-widget-focal"><b>{open.length}</b><span>open</span></div>
      <div className="dashboard-widget-metrics">
        {enabledFields.has("overdue") && <span><b>{overdue.length}</b> overdue</span>}
        {enabledFields.has("due") && <span><b>{open.filter((task) => task.due?.slice(0, 10) === today).length}</b> due today</span>}
        {enabledFields.has("completed") && <span><b>{completed}</b> completed</span>}
      </div>
      {size !== "small" && open.slice(0, 3).map((task) => <div className="dashboard-widget-list-row" key={task.id}><Circle size={ICON_SIZE.body} /><span>{task.title}</span>{task.due && <small>{task.due.slice(0, 10)}</small>}</div>)}
      {!open.length && <p className="dashboard-widget-note">No real open tasks. Add one only when it helps make the next action concrete.</p>}
    </GlassCard>
  );
}

function ReadinessDashboardWidget({
  readiness,
  enabledFields,
}: {
  readiness: ReturnType<typeof calculateReadiness>;
  enabledFields: Set<string>;
}) {
  const hasEvidence = readiness.contributions.length > 0 || readiness.selfReportedEnergy.label !== "Unlogged";
  return (
    <GlassCard pad className="dashboard-core-widget readiness-widget">
      <PanelHeader title="Readiness" sub="A deterministic estimate from local, confirmed signals"
        action={<a className="gbtn sm" href="#reports">Why?</a>} />
      {hasEvidence ? (
        <>
          {enabledFields.has("score") && <div className="dashboard-widget-focal"><b>{readiness.estimatedReadiness}</b><span>{readiness.readinessLabel}</span></div>}
          {enabledFields.has("energy") && <p className="dashboard-widget-note">Reported energy: {readiness.selfReportedEnergy.label}</p>}
          {enabledFields.has("contributors") && readiness.contributions[0] && <p className="dashboard-widget-note">Strongest contributor: {readiness.contributions[0].label} ({readiness.contributions[0].appliedDelta > 0 ? "+" : ""}{readiness.contributions[0].appliedDelta})</p>}
        </>
      ) : <div className="dashboard-widget-empty"><BatteryMedium size={ICON_SIZE.control} /><b>No readiness signal yet</b><span>Log energy or a confirmed factor before AXOM interprets capacity.</span></div>}
    </GlassCard>
  );
}

function ActivityDashboardWidget({
  activeDayKey,
  week,
  enabledFields,
}: {
  activeDayKey: string;
  week: ReturnType<typeof weeklySummary>;
  enabledFields: Set<string>;
}) {
  const logs = useStore((s) => s.logs);
  const today = dayTotals(logs, activeDayKey);
  const recent = logs.filter((log) => log.dayKey === activeDayKey).slice(0, 3);
  return (
    <GlassCard pad className="dashboard-core-widget activity-widget">
      <PanelHeader title="Activity" sub="What you recorded, not an inferred score"
        action={<a className="gbtn sm primary" href="#productivity"><Activity size={ICON_SIZE.body} /> Log</a>} />
      {enabledFields.has("today") && <div className="dashboard-widget-focal"><b>{today.minutes}m</b><span>today · {today.cards} cards</span></div>}
      {enabledFields.has("weekly") && <div className="dashboard-widget-metrics"><span><b>{week.minutes}m</b> this week</span><span><b>{week.activeDays}</b> active days</span></div>}
      {enabledFields.has("recent") && recent.map((log) => <div className="dashboard-widget-list-row" key={log.id}><Activity size={ICON_SIZE.body} /><span>{log.type}</span><small>{log.minutes ? `${log.minutes}m` : `${log.quantity ?? 0} ${log.quantityLabel ?? "count"}`}</small></div>)}
      {!recent.length && <p className="dashboard-widget-note">No activity logged today. One honest record is enough to create signal.</p>}
    </GlassCard>
  );
}

function JournalDashboardWidget({
  activeDayKey,
  enabledFields,
}: {
  activeDayKey: string;
  enabledFields: Set<string>;
}) {
  const entries = useStore((s) => s.journal);
  const current = entries.find((entry) => entry.date.slice(0, 10) === activeDayKey) ?? entries[0];
  return (
    <GlassCard pad className="dashboard-core-widget journal-widget">
      <PanelHeader title="Journal" sub="A private, device-local record of the day"
        action={<a className="gbtn sm primary" href="#journal"><BookText size={ICON_SIZE.body} /> Open</a>} />
      {current ? (
        <>
          {enabledFields.has("latest") && <div className="dashboard-widget-journal-excerpt"><b>{current.date.slice(0, 10) === activeDayKey ? "Today" : prettyDate(current.date)}</b><p>{truncateText(current.today, 120)}</p></div>}
          <div className="dashboard-widget-metrics">
            {enabledFields.has("energy") && <span><b>{current.energy || "—"}</b> energy</span>}
            {enabledFields.has("unfinished") && <span><b>{current.tomorrow ? "1+" : "0"}</b> next-day loops</span>}
          </div>
        </>
      ) : <div className="dashboard-widget-empty"><BookText size={ICON_SIZE.control} /><b>Your notebook is ready</b><span>Write freely or close the loop with a short reflection.</span></div>}
    </GlassCard>
  );
}

function ConsistencyDashboardWidget({
  state,
  enabledFields,
}: {
  state: ReturnType<typeof useStore.getState>;
  enabledFields: Set<string>;
}) {
  const summary = consistencySummary(state);
  return (
    <GlassCard pad className="dashboard-core-widget consistency-widget">
      <PanelHeader title="Consistency" sub="Only eligible days after tracking began" action={<a className="gbtn sm" href="#reports">Trend</a>} />
      {summary.eligibleDays ? (
        <>
          {enabledFields.has("current") && <div className="dashboard-widget-focal"><b>{summary.current}</b><span>current streak</span></div>}
          <div className="dashboard-widget-metrics">
            {enabledFields.has("best") && <span><b>{summary.best}</b> best</span>}
            {enabledFields.has("eligibleDays") && <span><b>{summary.eligibleDays}</b> eligible days</span>}
          </div>
        </>
      ) : <div className="dashboard-widget-empty"><Flame size={ICON_SIZE.control} /><b>No eligible history yet</b><span>AXOM will not count dates before your targets started.</span></div>}
    </GlassCard>
  );
}

function DailyWordDashboardWidget({
  activeDayKey,
  enabledFields,
}: {
  activeDayKey: string;
  enabledFields: Set<string>;
}) {
  const enabled = useStore((s) => s.profile.experimentalFlags?.dailyGames === true);
  const puzzles = useStore((s) => s.dailyWordPuzzles);
  const stats = deriveDailyWordStatsFromNormalizedHistory(puzzles);
  const today = puzzles.find((puzzle) => puzzle.puzzleDate === activeDayKey);
  return (
    <GlassCard pad className="dashboard-core-widget daily-word-widget">
      <PanelHeader title="Daily Word" sub="Deterministic, local, and offline after first load"
        action={<a className="gbtn sm primary" href="#daily-word"><Gamepad2 size={ICON_SIZE.body} /> {enabled ? "Play" : "Enable"}</a>} />
      {!enabled ? <div className="dashboard-widget-empty"><Gamepad2 size={ICON_SIZE.control} /><b>Daily Games is optional</b><span>Open Daily Word to enable it explicitly. No puzzle data is deleted while hidden.</span></div> : (
        <>
          <div className="dashboard-widget-focal"><b>{today?.completed ? (today.won ? "Won" : "Complete") : today ? `${today.guesses.length}/6` : "Ready"}</b><span>today's puzzle</span></div>
          <div className="dashboard-widget-metrics">
            {enabledFields.has("streak") && <span><b>{stats.currentStreak}</b> streak</span>}
            {enabledFields.has("distribution") && <span><b>{stats.wins}/{stats.gamesPlayed}</b> wins</span>}
          </div>
        </>
      )}
    </GlassCard>
  );
}

function consistencySummary(s: ReturnType<typeof useStore.getState>) {
  const days = lastNDays(30)
    .map((date) => isoDate(date))
    .filter((key) => key < s.activeDayKey)
    .map((key) => evaluateDailySuccess(s, key, s.activeDayKey))
    .filter((result) => result.eligibleCount > 0);
  let current = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].status !== "met") break;
    current += 1;
  }
  let best = 0;
  let run = 0;
  for (const day of days) {
    run = day.status === "met" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best, eligibleDays: days.length };
}

function TodayScoreWidget({
  result, activeDayKey, enabledFields,
}: {
  result: DailySuccessResult;
  activeDayKey: string;
  enabledFields: Set<string>;
}) {
  return (
    <GlassCard pad data-tour="requirements">
      <div className="panel-head">
        <div>
          <div className="panel-title">Today's targets</div>
          <div className="panel-sub">Only the signals you selected for {prettyDate(`${activeDayKey}T12:00:00`)}</div>
        </div>
        <a className="gbtn sm" href="#productivity">Adjust</a>
      </div>
      {enabledFields.has("progress") && <DailyProgressVessel result={result} compact />}
      {enabledFields.has("targets") && result.requirements.filter((item) => item.eligible && item.status !== "unavailable").length > 0 && (
        <div className="dashboard-requirement-list">
          {result.requirements.filter((item) => item.eligible && item.status !== "unavailable").map((item) => (
            <div key={item.requirement.id}>
              <span>{item.requirement.label}</span>
              <b>{item.calculation}</b>
              <Tag tone={item.status === "met" ? "green" : item.status === "awaiting" ? "neutral" : "cyan"}>{item.status === "met" ? "Met" : item.status === "awaiting" ? "Awaiting" : "In progress"}</Tag>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function WeeklyWidget({
  week,
  enabledFields,
}: {
  week: ReturnType<typeof weeklySummary>;
  enabledFields: Set<string>;
}) {
  const reveal = useInView<HTMLDivElement>();
  const [selectedKey, setSelectedKey] = useState(() => week.days.at(-1)?.key ?? "");
  const selected = week.days.find((day) => day.key === selectedKey) ?? week.days.at(-1) ?? week.days[0];
  return (
    <GlassCard pad className="weekly-card">
      <PanelHeader title="Weekly Overview" sub="Last 7 calendar days from your local study log"
        action={<Tag tone={week.activeDays >= 5 ? "green" : week.activeDays >= 3 ? "orange" : "neutral"}>{week.activeDays}/7 active</Tag>} />
      {(enabledFields.has("minutes") || enabledFields.has("activeDays")) && <div className="weekly-hero">
        <div>
          {enabledFields.has("minutes") && <div className="week-total">{Math.round(week.minutes / 60)}h</div>}
          <div className="sub">{week.minutes} minutes · {week.cards} cards · {week.tasksDone} tasks done</div>
        </div>
        {enabledFields.has("activeDays") && <div className="weekly-score">
          <span style={{ color: gradeColor(week.grade) }}>{gradeLabel(week.grade).replace("👑 ", "")}</span>
          <small>week result</small>
        </div>}
      </div>}
      {enabledFields.has("trend") && <div className={`week-bars reveal-bars ${reveal.inView ? "in-view" : ""}`} ref={reveal.ref}>
        {week.days.map((d) => (
          <button type="button" className={`week-day ${selected?.key === d.key ? "on" : ""}`} key={d.key}
            title={`${d.key}: ${d.minutes}m, ${d.cards} cards, readiness ${d.readiness}`}
            onMouseEnter={() => setSelectedKey(d.key)}
            onFocus={() => setSelectedKey(d.key)}
            onClick={() => setSelectedKey(d.key)}>
            <div className="week-bar-shell">
              <div className="week-bar-fill" style={{ height: `${Math.max(8, d.intensity)}%`, background: gradeColor(d.grade) }} />
            </div>
            <span>{d.label}</span>
          </button>
        ))}
      </div>}
      {enabledFields.has("trend") && selected && (
        <div className="weekly-day-detail">
          <div className="weekly-day-head">
            <div>
              <b>{selected.dateLabel}</b>
              <span>{selected.key}</span>
            </div>
            <Tag tone={selected.readiness >= 78 ? "green" : selected.readiness >= 58 ? "cyan" : selected.readiness >= 38 ? "orange" : "red"}>
              Readiness {selected.readiness}
            </Tag>
          </div>
          <div className="weekly-detail-grid">
            <DetailMetric label="Study" value={`${selected.minutes}m · ${selected.cards} cards`} />
            <DetailMetric label="Productive" value={`${selected.productiveMinutes}m`} />
            <DetailMetric label="Tasks" value={`${selected.tasksDone} done · ${selected.openTasksDue} due`} />
            <DetailMetric label="Journal" value={selected.journalSummary} />
            <DetailMetric label="Top activity" value={selected.topActivity} />
            <DetailMetric label="Strongest action" value={selected.strongestAction} />
          </div>
          <div className="weekly-correction"><ArrowRightCircle size={ICON_SIZE.body} /> {selected.suggestedCorrection}</div>
        </div>
      )}
    </GlassCard>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="weekly-detail-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function LocalDataWidget({ state }: { state: ReturnType<typeof useStore.getState> }) {
  return (
    <GlassCard pad className="local-data-card" data-tour="data-safety-settings">
      <PanelHeader title="Local data & backup" sub="Your workspace stays on this device; exported backups are portable copies"
        action={<GButton size="sm" onClick={() => exportState(state)}><Download size={ICON_SIZE.body} /> Export backup</GButton>} />
      <div className="alpha-notice">
        <span className="alpha-pill">ALPHA</span>
        <span>Web redeployments keep this browser vault intact. Export backups before switching devices, browsers, or domains.</span>
      </div>
      <div className="local-data-grid">
        <div className="local-data-item">
          <Database size={ICON_SIZE.emphasis} />
          <div>
            <b>Local Vault</b>
            <span>IndexedDB with localStorage fallback. Seed updates will not overwrite your saved profile.</span>
          </div>
        </div>
        <div className="local-data-item">
          <ShieldCheck size={ICON_SIZE.emphasis} />
          <div>
            <b>Private by default</b>
            <span>No account server is required. Data stays on the current browser/device unless exported.</span>
          </div>
        </div>
        <div className="local-data-item">
          <PackageCheck size={ICON_SIZE.emphasis} />
          <div>
          <b>Recovery and portable copies</b>
            <span>Settings → Backup shows automatic local recovery snapshots and exported backup controls.</span>
          </div>
        </div>
        <a className="local-data-item" href={HOSTED_ALPHA_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={ICON_SIZE.emphasis} />
          <div>
            <b>Hosted Alpha</b>
            <span>Open the hosted preview. It uses its own browser-local workspace unless you import a portable backup.</span>
          </div>
        </a>
      </div>
    </GlassCard>
  );
}

function PremedHoursWidget() {
  const entries = useStore((state) => state.premedExperiences ?? []);
  const total = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const clinical = entries.filter((entry) => entry.kind === "Clinical" || entry.kind === "Shadowing").reduce((sum, entry) => sum + entry.hours, 0);
  const service = entries.filter((entry) => entry.kind === "Service").reduce((sum, entry) => sum + entry.hours, 0);
  const verified = entries.filter((entry) => entry.verified).reduce((sum, entry) => sum + entry.hours, 0);
  return (
    <GlassCard pad>
      <PanelHeader title="Pre-Med Hours" sub="Clinical, service, research, and verification evidence"
        action={<a className="gbtn sm" href="#premed">Open <ArrowRight size={ICON_SIZE.body} /></a>} />
      <div className="trend-widget">
        <div><b>{total}</b><span>total</span></div>
        <div><b>{clinical}</b><span>clinical/shadow</span></div>
        <div><b>{verified}</b><span>verified</span></div>
      </div>
      <div className="premed-mini-bars">
        <ProgressBar label="Clinical + shadowing" value={clinical} target={150} pct={Math.min(100, Math.round((clinical / 150) * 100))} color="var(--green)" />
        <ProgressBar label="Service" value={service} target={100} pct={Math.min(100, Math.round((service / 100) * 100))} color="var(--cyan)" />
      </div>
    </GlassCard>
  );
}

// Exam countdown + adaptive daily-question goal (directive §20 + §21). Reads the
// existing boardPrep data; self-hides when the user has no exam date or content
// progress on any board lane, so it only appears when it's useful.
function ExamCountdownWidget() {
  const boardPrep = useStore((s) => s.boardPrep);
  const focusId = pickFocusExam(boardPrep);
  if (!focusId) return null;
  const prep = boardPrep[focusId];
  const intensity: PrepIntensity = prep.confidence === "low" ? "gentle" : prep.confidence === "high" ? "intense" : "balanced";
  const c = buildExamCountdown(focusId, prep, intensity);
  const hasDate = c.daysUntil !== null;
  const examPast = c.awaitingPostExam;

  return (
    <GlassCard pad className={`exam-countdown ${examPast ? "past" : ""}`}>
      <PanelHeader
        title={`${c.meta.short} countdown`}
        sub={c.examDate ? `Exam ${prettyDate(`${c.examDate.slice(0, 10)}T12:00:00`)}` : "No exam date set yet"}
        action={<a className="gbtn sm" href={`#${c.meta.route}`}><CalendarClock size={ICON_SIZE.body} /> Open prep</a>}
      />
      <div className="exam-countdown-grid">
        <div className="exam-countdown-num">
          <b>{hasDate ? Math.abs(c.daysUntil as number) : "—"}</b>
          <span>{!hasDate ? "set a date" : examPast ? "days since exam" : (c.daysUntil === 1 ? "day to go" : "days to go")}</span>
        </div>
        <div className="exam-countdown-meta">
          <span className="exam-phase-pill">{c.phaseLabel} phase</span>
          {c.milestone && <span className="exam-milestone">{c.milestone.label}</span>}
        </div>
      </div>

      {c.recommendedDaily > 0 && !examPast && (
        <>
          <div className="exam-q-line">
            <span>Today's questions</span>
            <b>{c.answeredToday}/{c.recommendedDaily}{c.correctToday > 0 ? ` · ${Math.round((c.correctToday / Math.max(1, c.answeredToday)) * 100)}% correct` : ""}</b>
          </div>
          <AnimatedProgressBar
            value={c.answeredToday}
            max={c.recommendedDaily}
            tone={c.questionProgress >= 100 ? "green" : "cyan"}
            glow={c.questionProgress >= 100}
            label={`${c.questionProgress}% of daily target`}
          />
        </>
      )}
      <div className="trend-comment">{countdownHeadline(c)}</div>
    </GlassCard>
  );
}

const OUTCOMES: { key: "won" | "partial" | "missed"; label: string; tone: "green" | "orange" | "red" }[] = [
  { key: "won", label: "Won it", tone: "green" },
  { key: "partial", label: "Partial", tone: "orange" },
  { key: "missed", label: "Missed", tone: "red" },
];

// Conditional dashboard banner: shows the standup prompt inside the review
// window, or a "you missed your standup" remediation strip once it lapses. It
// disappears entirely when there's nothing to do.
function StandupPrompt() {
  const s = useStore();
  const dailyLoopRequest = useUi((state) => state.dailyLoopRequest);
  const clearDailyLoopRequest = useUi((state) => state.clearDailyLoopRequest);
  const missed = missedStandupDays(s);
  const preferences = normalizeDailyLoopReminderPreferences(s.profile.dailyLoopReminders);
  const today = s.activeDayKey;
  const closeoutDone = Boolean(closeoutForDay(s.closeouts ?? [], today));
  const closeoutDue = preferences.closeoutEnabled && !closeoutDone && isAfterLocalTime(preferences.closeoutTime);
  const [showCloseout, setShowCloseout] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    const entry = dailyLoopReminderLedger.read(today).closeout;
    return entry.disposition !== "pending"
      || Boolean(entry.snoozedUntil && Date.parse(entry.snoozedUntil) > Date.now());
  });
  const [editingTime, setEditingTime] = useState(false);

  useEffect(() => {
    const entry = dailyLoopReminderLedger.read(today).closeout;
    setDismissed(entry.disposition !== "pending"
      || Boolean(entry.snoozedUntil && Date.parse(entry.snoozedUntil) > Date.now()));
    setShowCloseout(false);
    setEditingTime(false);
  }, [today]);

  useEffect(() => {
    if (dailyLoopRequest?.kind !== "closeout" || dailyLoopRequest.dayKey !== today) return;
    setDismissed(false);
    setShowCloseout(true);
    clearDailyLoopRequest();
  }, [clearDailyLoopRequest, dailyLoopRequest, today]);

  if (!missed.length && (!closeoutDue || dismissed)) return null;

  if (closeoutDue && !dismissed) {
    return (
      <>
        <GlassCard pad className="standup-prompt-card due daily-closeout-card">
          <div className="standup-prompt-head">
            <span className="standup-prompt-mark"><BookText size={ICON_SIZE.emphasis} /></span>
            <div className="grow">
              <b>Close the loop on today?</b>
              <span>Review your intention, activity, targets, focus sessions, questions, tasks, and energy. A short closeout is optional.</span>
            </div>
          </div>
          <div className="row wrap gap8 daily-closeout-actions">
            <GButton size="sm" variant="primary" onClick={() => gotoJournalDay(today)}>Open today’s journal</GButton>
            <GButton size="sm" onClick={() => setShowCloseout(true)}>Quick closeout</GButton>
            <GhostButton onClick={() => {
              const now = new Date();
              dailyLoopReminderLedger.snooze(today, "closeout", new Date(now.getTime() + 30 * 60_000), now);
              setDismissed(true);
            }}>Remind me later</GhostButton>
            <GhostButton onClick={() => {
              dailyLoopReminderLedger.skip(today, "closeout");
              setDismissed(true);
            }}>Skip tonight</GhostButton>
            <GhostButton aria-expanded={editingTime} onClick={() => setEditingTime((value) => !value)}>Change reminder time</GhostButton>
          </div>
          {editingTime && (
            <label className="daily-closeout-time">
              <span>Evening closeout reminder</span>
              <input className="field" type="time" value={preferences.closeoutTime} onChange={(event) => s.updateProfile({
                dailyLoopReminders: { ...preferences, closeoutTime: event.target.value },
              })} />
            </label>
          )}
        </GlassCard>
        {showCloseout && <CloseoutModal onClose={() => setShowCloseout(false)} />}
      </>
    );
  }

  if (missed.length) {
    return (
      <GlassCard pad className="standup-prompt-card missed">
        <div className="standup-prompt-head">
          <span className="standup-prompt-mark warn"><AlertTriangle size={ICON_SIZE.emphasis} /></span>
          <div className="grow">
            <b>{missed.length} prior reflection{missed.length === 1 ? " is" : "s are"} still open</b>
            <span>Catch up only if it would help. Existing journal content is never overwritten.</span>
          </div>
        </div>
        <div className="standup-prompt-days">
          {missed.map((key) => {
            const plan = planForDay(s.dayPlans, key);
            return (
              <button key={key} type="button" className="standup-day-chip remediable" onClick={() => gotoJournalDay(key)}>
                <CalendarClock size={ICON_SIZE.body} />
                <span>{prettyDate(`${key}T12:00:00`)}</span>
                {plan && <em>“{plan.intention.length > 26 ? `${plan.intention.slice(0, 26)}…` : plan.intention}”</em>}
              </button>
            );
          })}
        </div>
      </GlassCard>
    );
  }

  return null;
}

// Daily Check-In: optional first-open direction plus a gentle carry-over nudge.
// It never infers an intention and never steals focus on app launch.
function WinTheDay() {
  const s = useStore();
  const dailyLoopRequest = useUi((state) => state.dailyLoopRequest);
  const clearDailyLoopRequest = useUi((state) => state.clearDailyLoopRequest);
  const today = s.activeDayKey;
  const todayPlan = s.dayPlans.find((p) => p.dayKey === today);
  const pendingPast = s.dayPlans
    .filter((p) => p.dayKey < today && !p.reviewedAt)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))[0];

  const [intention, setIntention] = useState("");
  const [wins, setWins] = useState("");
  const [note, setNote] = useState("");
  const [expectedMinutes, setExpectedMinutes] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [priority, setPriority] = useState("");
  const [obstacle, setObstacle] = useState("");
  const [commitment, setCommitment] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [showContext, setShowContext] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(() => (
    dailyLoopReminderLedger.read(today).checkIn.disposition !== "pending"
  ));
  const [showWrapPrompt, setShowWrapPrompt] = useState(false);

  const openTasks = s.tasks.filter((t) => !t.done && !t.archived).slice(0, 3);
  const reviewDue = isAfterLocalTime(s.profile.journalReviewTime ?? "20:00");
  const selectedTargets = useMemo(
    () => evaluateDailySuccess(s, today, today).requirements
      .filter((item) => item.eligible && item.status !== "unavailable")
      .map((item) => item.requirement.label),
    [s, today],
  );

  useEffect(() => {
    if (todayPlan && !todayPlan.outcome && reviewDue) setShowWrapPrompt(true);
  }, [reviewDue, todayPlan]);

  useEffect(() => {
    setPromptDismissed(dailyLoopReminderLedger.read(today).checkIn.disposition !== "pending");
    setIntention("");
    setWins("");
    setNote("");
    setExpectedMinutes("");
    setPersonalNote("");
    setPriority("");
    setObstacle("");
    setCommitment(3);
    setShowContext(false);
    setShowWrapPrompt(false);
  }, [today]);

  useEffect(() => {
    if (dailyLoopRequest?.kind !== "check-in" || dailyLoopRequest.dayKey !== today) return;
    setPromptDismissed(false);
    clearDailyLoopRequest();
  }, [clearDailyLoopRequest, dailyLoopRequest, today]);

  function save() {
    if (!intention.trim()) return;
    s.setDayPlan(
      today,
      intention.trim(),
      wins.split("\n").map((w) => w.trim()).filter(Boolean).slice(0, 3),
      {
        expectedStudyMinutes: expectedMinutes ? Math.max(0, Number(expectedMinutes) || 0) : undefined,
        personalNote: personalNote.trim() || undefined,
        priority: priority.trim() || undefined,
        anticipatedObstacle: obstacle.trim() || undefined,
        commitmentLevel: commitment,
      },
    );
    dailyLoopReminderLedger.markShown(today, "check-in");
    setIntention(""); setWins("");
  }

  function useTargets() {
    if (!selectedTargets.length) {
      location.hash = "productivity";
      return;
    }
    s.setDayPlan(today, "Complete today’s chosen targets", selectedTargets.slice(0, 3), { commitmentLevel: commitment });
    dailyLoopReminderLedger.markShown(today, "check-in");
  }

  function skipCheckIn() {
    dailyLoopReminderLedger.skip(today, "check-in");
    setPromptDismissed(true);
  }

  return (
    <GlassCard pad className="win-day" data-tour="intention">
      {showWrapPrompt && todayPlan && !todayPlan.outcome && (
        <div className="journal-wrap-popover">
          <button className="ghost-btn" onClick={() => setShowWrapPrompt(false)} title="Dismiss"><X size={ICON_SIZE.body} /></button>
          <div className="journal-wrap-mark"><BookText size={ICON_SIZE.emphasis} /></div>
          <div>
            <b>Wrap up the day</b>
            <span>{wrapUpMessage(today)} Review “{todayPlan.intention}”, then turn it into a useful standup.</span>
          </div>
          <a className="gbtn sm primary" href="#journal">Open Journal</a>
        </div>
      )}
      {pendingPast && (
        <div className="carry-over">
          <ArrowRightCircle size={ICON_SIZE.emphasis} />
          <div className="grow">
            <b>You planned {prettyDate(`${pendingPast.dayKey}T12:00:00`)} but never closed it out.</b>
            <span>“{pendingPast.intention}” — did you get it done?</span>
          </div>
          <div className="row gap6">
            {OUTCOMES.map((o) => (
              <button key={o.key} className={`gbtn tiny ${o.tone === "green" ? "primary" : ""}`}
                onClick={() => s.reviewDayPlan(pendingPast.dayKey, o.key)}>{o.label}</button>
            ))}
          </div>
        </div>
      )}

      {!todayPlan && promptDismissed ? (
        <div className="daily-checkin-collapsed">
          <div>
            <div className="panel-title">Daily Check-In</div>
            <div className="panel-sub">Optional. Add direction whenever it would help.</div>
          </div>
          <GButton size="sm" onClick={() => setPromptDismissed(false)}>Open check-in</GButton>
        </div>
      ) : !todayPlan ? (
        <>
          <PanelHeader title="Daily Check-In" sub="Before the day runs away from you, what would make today count?" />
          <div className="stack gap8">
            <label className="stack gap6"><span className="field-label">Primary intention</span><input className="field" placeholder="e.g. Finish the renal review before lunch"
              value={intention} onChange={(e) => setIntention(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} /></label>
            <label className="stack gap6"><span className="field-label">One to three win conditions (optional)</span><textarea className="field" rows={2} placeholder="One per line"
              value={wins} onChange={(e) => setWins(e.target.value)} />
            </label>
            <details className="daily-checkin-context" open={showContext} onToggle={(event) => setShowContext(event.currentTarget.open)}>
              <summary>Add context (optional)</summary>
              <div className="daily-checkin-context-grid">
                <label><span>Expected study block</span><input className="field" type="number" min="0" inputMode="numeric" placeholder="minutes" value={expectedMinutes} onChange={(event) => setExpectedMinutes(event.target.value)} /></label>
                <label><span>Priority course or topic</span><input className="field" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
                <label><span>Anticipated obstacle</span><input className="field" value={obstacle} onChange={(event) => setObstacle(event.target.value)} /></label>
                <label><span>Personal note</span><input className="field" value={personalNote} onChange={(event) => setPersonalNote(event.target.value)} /></label>
                <fieldset><legend>Commitment level</legend><div className="row gap6">{([1, 2, 3, 4, 5] as const).map((level) => <button key={level} type="button" className={`filter-pill ${commitment === level ? "on" : ""}`} aria-pressed={commitment === level} onClick={() => setCommitment(level)}>{level}</button>)}</div></fieldset>
              </div>
            </details>
            <div className="row wrap gap8 daily-checkin-actions">
              <GButton variant="primary" onClick={save} disabled={!intention.trim()}><Sunrise size={ICON_SIZE.body} /> Set today’s focus</GButton>
              <GButton onClick={useTargets}>Use my targets</GButton>
              <GhostButton onClick={skipCheckIn}>Skip for now</GhostButton>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="panel-head">
            <div>
              <div className="panel-title">Daily Check-In</div>
              <div className="panel-sub">“{todayPlan.intention}”</div>
            </div>
            {todayPlan.outcome
              ? <Tag tone={OUTCOMES.find((o) => o.key === todayPlan.outcome)?.tone ?? "neutral"}>
                  <Trophy size={ICON_SIZE.microInline} /> {OUTCOMES.find((o) => o.key === todayPlan.outcome)?.label}
                </Tag>
              : <button className="gbtn tiny" onClick={() => s.setDayPlan(today, "", [])}>Reset</button>}
          </div>

          {todayPlan.wins.length > 0 && (
            <div className="win-conditions">
              {todayPlan.wins.map((w, i) => <span key={i} className="win-cond"><Check size={ICON_SIZE.microInline} /> {w}</span>)}
            </div>
          )}

          {(todayPlan.priority || todayPlan.expectedStudyMinutes || todayPlan.anticipatedObstacle) && (
            <div className="daily-checkin-snapshot">
              {todayPlan.priority && <span><b>Priority</b>{todayPlan.priority}</span>}
              {todayPlan.expectedStudyMinutes ? <span><b>Expected block</b>{todayPlan.expectedStudyMinutes} min</span> : null}
              {todayPlan.anticipatedObstacle && <span><b>Watch for</b>{todayPlan.anticipatedObstacle}</span>}
            </div>
          )}

          {openTasks.length > 0 && (
            <div className="win-tasks">
              <div className="field-label" style={{ marginBottom: 6 }}>Check off as you go</div>
              {openTasks.map((t) => (
                <button key={t.id} className="win-task" onClick={() => s.toggleTask(t.id)}>
                  <Circle size={ICON_SIZE.body} /> <span>{t.title}</span>
                  {t.scope && <Tag tone="neutral">{t.scope}</Tag>}
                </button>
              ))}
            </div>
          )}

          {!todayPlan.outcome && (
            <div className="win-review">
              <input className="field grow" placeholder="End-of-day note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {OUTCOMES.map((o) => (
                <GButton key={o.key} size="sm" variant={o.tone === "green" ? "primary" : "default"}
                  onClick={() => s.reviewDayPlan(today, o.key, note.trim() || undefined)}>{o.label}</GButton>
              ))}
            </div>
          )}
          {!todayPlan.outcome && reviewDue && (
            <div className="journal-follow-nudge">
              <BookText size={ICON_SIZE.body} />
              <span>It is past your journal follow-up time. Review today’s intention, then write the standup.</span>
              <a className="gbtn tiny" href="#journal">Open Journal</a>
            </div>
          )}
          {todayPlan.outcome && (
            <div className="row gap8" style={{ marginTop: 10 }}>
              <GhostButton onClick={() => s.reviewDayPlan(today, undefined)} title="Re-open review"><ArrowRight size={ICON_SIZE.body} /></GhostButton>
              <span className="sub">Reviewed{todayPlan.reviewNote ? ` — “${todayPlan.reviewNote}”` : ""}. Want to log it as a standup? Open Journal.</span>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}

function ProgressBar({
  label, value, target, pct, color,
}: { label: string; value: number; target: number; pct: number; color: string }) {
  return (
    <div className="stack gap6">
      <div className="spread" style={{ fontSize: 12 }}>
        <span className="muted" style={{ fontWeight: 700 }}>{label}</span>
        <span className="dim">{value} / {target}</span>
      </div>
      <div className="track"><div className="track-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

function weeklySummary(s: ReturnType<typeof useStore.getState>) {
  const days = lastNDays(7).map((d) => {
    const key = isoDate(d);
    const totals = dayTotals(s.logs, key);
    const productive = productiveTotals(s.logs, key);
    const grade = todayGrade(totals.minutes, totals.cards);
    const intensity = Math.min(100, Math.max((totals.minutes / 480) * 100, (totals.cards / 350) * 100));
    const readiness = calculateReadiness({
      date: key,
      factors: s.energyFactors ?? [],
      journal: s.journal,
      logs: s.logs,
      tasks: s.tasks,
      dayPlans: s.dayPlans,
      productivityTrackers: s.productivityTrackers,
    });
    const tasksDone = s.tasks.filter((task) => task.done && task.completedAt?.startsWith(key)).length;
    const openTasksDue = s.tasks.filter((task) => !task.done && !task.archived && task.due?.slice(0, 10) === key).length;
    return {
      key,
      dateLabel: d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
      minutes: totals.minutes,
      cards: totals.cards,
      productiveMinutes: productive.minutes,
      tasksDone,
      openTasksDue,
      journalSummary: journalSummaryForDay(s.journal, key),
      topActivity: topActivityForDay(s.logs, key),
      strongestAction: strongestActionForDay({ logs: s.logs, dayPlans: s.dayPlans, tasksDone, key }),
      suggestedCorrection: correctionForDay({ minutes: totals.minutes, cards: totals.cards, openTasksDue, readiness: readiness.estimatedReadiness }),
      readiness: readiness.estimatedReadiness,
      grade,
      intensity,
    };
  });
  const minutes = days.reduce((a, d) => a + d.minutes, 0);
  const cards = days.reduce((a, d) => a + d.cards, 0);
  const activeDays = days.filter((d) => d.minutes > 0 || d.cards > 0).length;
  return {
    days,
    minutes,
    cards,
    activeDays,
    tasksDone: days.reduce((sum, day) => sum + day.tasksDone, 0),
    grade: todayGrade(Math.round(minutes / Math.max(activeDays, 1)), Math.round(cards / Math.max(activeDays, 1))),
  };
}

function journalSummaryForDay(journal: ReturnType<typeof useStore.getState>["journal"], key: string) {
  const entry = journal.find((item) => item.date.slice(0, 10) === key);
  if (!entry) return "No standup";
  const text = [entry.today, entry.blockers, entry.rating].find((part) => part.trim()) ?? "";
  return truncateText(text || `${entry.energy || "Logged"} standup`, 58);
}

function topActivityForDay(logs: ReturnType<typeof useStore.getState>["logs"], key: string) {
  const totals = new Map<string, number>();
  for (const log of logs.filter((item) => item.dayKey === key)) {
    totals.set(log.type, (totals.get(log.type) ?? 0) + Math.max(log.minutes, Number(log.quantity ?? 0), log.cards));
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} (${Math.round(top[1])})` : "No logged activity";
}

function strongestActionForDay({
  logs, dayPlans, tasksDone, key,
}: {
  logs: ReturnType<typeof useStore.getState>["logs"];
  dayPlans: ReturnType<typeof useStore.getState>["dayPlans"];
  tasksDone: number;
  key: string;
}) {
  const plan = dayPlans.find((item) => item.dayKey === key);
  if (plan?.outcome === "won") return "Won the plan";
  if (tasksDone > 0) return `${tasksDone} task${tasksDone === 1 ? "" : "s"} closed`;
  const totals = dayTotals(logs, key);
  if (totals.cards >= 120) return "Card floor cleared";
  if (totals.minutes >= 120) return "Study block protected";
  return "Needs one clear win";
}

function correctionForDay({
  minutes, cards, openTasksDue, readiness,
}: {
  minutes: number;
  cards: number;
  openTasksDue: number;
  readiness: number;
}) {
  if (readiness < 45) return "Tomorrow: lower the load and close one small loop.";
  if (openTasksDue > 0) return "Tomorrow: clear the oldest due task before adding volume.";
  if (minutes === 0 && cards === 0) return "Tomorrow: create signal with one 25-minute block.";
  if (cards < 60) return "Tomorrow: add a small retrieval/card pass.";
  return "Tomorrow: keep the same floor and add only one precision target.";
}

function truncateText(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function isAfterLocalTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [, hh, mm] = match;
  const now = new Date();
  const target = new Date();
  target.setHours(Number(hh), Number(mm), 0, 0);
  return now >= target;
}
