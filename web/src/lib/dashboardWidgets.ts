import type {
  DashboardLayoutPreferences,
  DashboardLayoutPresetId,
  DashboardWidgetId,
  DashboardWidgetPreferences,
  DashboardWidgetSize,
} from "./types";

export interface DashboardWidgetFieldDefinition {
  id: string;
  label: string;
  defaultEnabled: boolean;
}

export interface DashboardWidgetCatalogItem {
  id: DashboardWidgetId;
  label: string;
  description: string;
  defaultSize: DashboardWidgetSize;
  supportedSizes: readonly DashboardWidgetSize[];
  fields: readonly DashboardWidgetFieldDefinition[];
  /** Retained for backup compatibility but never offered as a current widget. */
  storageOnly?: boolean;
}

export interface DashboardLayoutPreset {
  id: DashboardLayoutPresetId;
  label: string;
  description: string;
  order: readonly DashboardWidgetId[];
  hiddenWidgetIds: readonly DashboardWidgetId[];
  sizes: Readonly<Partial<Record<DashboardWidgetId, DashboardWidgetSize>>>;
}

const ALL_SIZES = ["small", "medium", "large", "extra-large"] as const;
const COMPACT_SIZES = ["small", "medium", "large"] as const;
const STANDARD_SIZES = ["medium", "large", "extra-large"] as const;

function fields(...values: Array<string | readonly [string, string]>): DashboardWidgetFieldDefinition[] {
  return values.map((value) => {
    const [id, label] = typeof value === "string" ? [value, titleFromId(value)] : value;
    return { id, label, defaultEnabled: true };
  });
}

/**
 * Pure metadata for every widget ID AXOM has persisted or currently plans to
 * render. Keeping the storage-only adapter here makes old backups safe without
 * returning removed UI to the dashboard.
 */
export const DASHBOARD_WIDGET_CATALOG: readonly DashboardWidgetCatalogItem[] = [
  { id: "welcome", label: "Welcome", description: "Date, welcome state, and daily quote.", defaultSize: "large", supportedSizes: STANDARD_SIZES, fields: fields("date", "state", "quote") },
  { id: "commandBrief", label: "Up next", description: "One suggested next step from your real work, with a smaller option.", defaultSize: "large", supportedSizes: STANDARD_SIZES, fields: fields("currentState", "nextAction", "why", "effort", "success", "alternate") },
  { id: "questionBank", label: "Question Bank", description: "Trusted review work and mapping health.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("due", "accuracy", "needsReview", "recent") },
  { id: "courseTracker", label: "Course Tracker", description: "Progress, weak areas, and untouched items.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("progress", "untouched", "weak", "suggestion") },
  { id: "tasks", label: "Tasks", description: "Due, overdue, and completed work.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("due", "overdue", "completed") },
  { id: "readiness", label: "Energy & capacity", description: "How much today can hold, from your own energy checks and recent load.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields(["score", "Capacity"], ["energy", "One-tap energy check"], ["contributors", "Reasons"]) },
  { id: "activity", label: "Activity", description: "Today, recent work, and activity distribution.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("today", "weekly", "recent", "distribution") },
  { id: "journal", label: "Journal", description: "Latest reflection and unfinished loops.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("latest", "energy", "unfinished") },
  { id: "streak", label: "Consistency", description: "Current and best eligible-day streaks.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields("current", "best", "eligibleDays") },
  { id: "dailyWord", label: "Daily Word", description: "Local puzzle state, streak, and next puzzle.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields("board", "streak", "countdown", "distribution") },
  { id: "winDay", label: "Daily Check-In", description: "Set direction and close the daily loop.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("intention", "winConditions", "closeout") },
  { id: "todayScore", label: "Today's targets", description: "Scheduled target progress and provenance.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("progress", "targets", "sources") },
  { id: "examCountdown", label: "Exam countdown", description: "Exam date, phase, and daily question target.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields("days", "phase", "questionTarget") },
  { id: "pomodoro", label: "Focus timer", description: "Current focus session and timer controls.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields("timer", "intention", "sessions") },
  { id: "soundscapes", label: "Soundscape", description: "Play, pause, and switch your study sound next to the timer.", defaultSize: "small", supportedSizes: COMPACT_SIZES, fields: fields(["quickPicks", "Quick picks"], ["followTimer", "Follow my Pomodoro"]) },
  { id: "weekly", label: "Weekly overview", description: "Seven-day effort and active-day rhythm.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("minutes", "activeDays", "trend") },
  { id: "suggested", label: "Suggested moves", description: "Merged into Up next; retained for old layouts.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("actions", "reasons", "effort"), storageOnly: true },
  { id: "schedule", label: "Schedule", description: "Legacy calendar widget retained for old layouts.", defaultSize: "large", supportedSizes: STANDARD_SIZES, fields: fields("calendar", "tasks", "activity"), storageOnly: true },
  { id: "termMap", label: "Term map", description: "Merged into Course Tracker; retained for old layouts.", defaultSize: "large", supportedSizes: STANDARD_SIZES, fields: fields("terms", "courses", "progress"), storageOnly: true },
  { id: "localData", label: "Local data", description: "Workspace and backup health.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("status", "backup", "storage") },
  { id: "latestStandup", label: "Latest standup", description: "Merged into Journal; retained for old layouts.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("date", "summary", "energy"), storageOnly: true },
  { id: "productivityTrend", label: "Productivity trend", description: "Merged into Activity; retained for old layouts.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("trend", "contributors", "comparison"), storageOnly: true },
  { id: "premedHours", label: "Pre-Med hours", description: "Clinical, service, and research hours.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("clinical", "service", "research") },
  { id: "resourceFocus", label: "Resource focus", description: "Legacy resource widget retained for old layouts.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("pinned", "recent", "status"), storageOnly: true },
  { id: "boardBlueprint", label: "Blueprint pulse", description: "Merged into Course Tracker; retained for old layouts.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: fields("lane", "progress", "priority"), storageOnly: true },
  { id: "aiActions", label: "Legacy AI actions", description: "Removed widget metadata retained for old backups.", defaultSize: "medium", supportedSizes: ALL_SIZES, fields: [], storageOnly: true },
] as const;

export const DASHBOARD_WIDGET_CATALOG_IDS = DASHBOARD_WIDGET_CATALOG.map((item) => item.id);
export const CURRENT_DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGET_CATALOG
  .filter((item) => !item.storageOnly)
  .map((item) => item.id);

const CATALOG_BY_ID = new Map<string, DashboardWidgetCatalogItem>(
  DASHBOARD_WIDGET_CATALOG.map((item) => [item.id, item]),
);

/**
 * JD (Ideas 1): check-in first, then the timer with soundscapes beside it,
 * then the rest by how often a student reaches for them. Welcome and Up next
 * render above the grid, so their slots here only matter to the editor.
 */
const FOCUSED_ORDER: DashboardWidgetId[] = [
  "welcome", "commandBrief", "winDay", "pomodoro", "soundscapes", "todayScore", "questionBank",
  "courseTracker", "weekly", "dailyWord", "tasks", "journal", "examCountdown", "readiness",
  "activity", "streak", "localData", "premedHours",
];

/** Bump when default orders gain widgets; upgradeDashboardLayout carries saved layouts forward. */
export const DASHBOARD_DEFAULTS_REVISION = 2;

const STUDY_HEAVY_VISIBLE = new Set<DashboardWidgetId>([
  "welcome", "commandBrief", "todayScore", "tasks", "courseTracker", "questionBank",
  "pomodoro", "soundscapes", "weekly", "examCountdown", "activity", "streak",
]);

const WELLBEING_VISIBLE = new Set<DashboardWidgetId>([
  "welcome", "commandBrief", "winDay", "todayScore", "readiness", "activity", "journal",
  "streak", "pomodoro", "soundscapes", "weekly", "dailyWord",
]);

function hiddenExcept(visible: ReadonlySet<DashboardWidgetId>): DashboardWidgetId[] {
  return CURRENT_DASHBOARD_WIDGET_IDS.filter((id) => !visible.has(id));
}

export const DASHBOARD_LAYOUT_PRESETS: readonly DashboardLayoutPreset[] = [
  {
    id: "focused",
    label: "Focused",
    description: "Direction, focus timer and sound, targets, and core study work.",
    order: FOCUSED_ORDER,
    hiddenWidgetIds: hiddenExcept(new Set(["welcome", "commandBrief", "winDay", "pomodoro", "soundscapes", "todayScore", "questionBank", "courseTracker", "weekly"])),
    sizes: { welcome: "large", commandBrief: "large", winDay: "large", pomodoro: "small", soundscapes: "small", todayScore: "medium", questionBank: "medium", courseTracker: "medium", weekly: "medium" },
  },
  {
    id: "study-heavy",
    label: "Study-heavy",
    description: "More course, question, task, and trend detail.",
    order: FOCUSED_ORDER,
    hiddenWidgetIds: hiddenExcept(STUDY_HEAVY_VISIBLE),
    sizes: { welcome: "medium", commandBrief: "large", courseTracker: "large", questionBank: "large", tasks: "medium", pomodoro: "small", soundscapes: "small" },
  },
  {
    id: "wellbeing-balanced",
    label: "Wellbeing-balanced",
    description: "Daily direction, readiness, reflection, and sustainable rhythm.",
    order: FOCUSED_ORDER,
    hiddenWidgetIds: hiddenExcept(WELLBEING_VISIBLE),
    sizes: { welcome: "large", commandBrief: "large", winDay: "medium", readiness: "small", activity: "medium", journal: "large", weekly: "medium", pomodoro: "small", soundscapes: "small" },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Keep the user's own order, visibility, sizes, and fields.",
    order: [],
    hiddenWidgetIds: [],
    sizes: {},
  },
] as const;

const PRESET_BY_ID = new Map(DASHBOARD_LAYOUT_PRESETS.map((preset) => [preset.id, preset]));

/** Three XL widgets are supported without a warning; the fourth is a soft prompt. */
export const RECOMMENDED_EXTRA_LARGE_WIDGET_LIMIT = 3;

export function dashboardWidgetCatalogItem(id: string): DashboardWidgetCatalogItem & { unavailable?: boolean } {
  const known = CATALOG_BY_ID.get(id);
  if (known) return known;
  return {
    id: id as DashboardWidgetId,
    label: titleFromId(id || "Unknown widget"),
    description: "This widget was saved by another AXOM version.",
    defaultSize: "medium",
    supportedSizes: ALL_SIZES,
    fields: [],
    unavailable: true,
  };
}

export function defaultDashboardWidgetPreferences(id: string): DashboardWidgetPreferences {
  const item = dashboardWidgetCatalogItem(id);
  return {
    size: item.defaultSize,
    enabledFields: item.fields.filter((field) => field.defaultEnabled).map((field) => field.id),
    preferences: {},
  };
}

export function adaptLegacyDashboardLayout(options: {
  order?: unknown;
  hiddenWidgetIds?: unknown;
  preset?: DashboardLayoutPresetId;
  updatedAt?: string;
} = {}): DashboardLayoutPreferences {
  const order = normalizeIdList(options.order, CURRENT_DASHBOARD_WIDGET_IDS);
  const hiddenWidgetIds = normalizeIdList(options.hiddenWidgetIds, []);
  return normalizeDashboardLayoutPreferences({
    version: 1,
    preset: options.preset ?? "custom",
    order,
    hiddenWidgetIds,
    widgets: Object.fromEntries(order.map((id) => [id, defaultDashboardWidgetPreferences(id)])),
    updatedAt: options.updatedAt,
  })!;
}

export function normalizeDashboardLayoutPreferences(
  value: unknown,
  fallback?: { order?: unknown; hiddenWidgetIds?: unknown },
): DashboardLayoutPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const preserved = sanitizeRecord(value);
  const preset = isDashboardLayoutPreset(value.preset) ? value.preset : "custom";
  const order = normalizeIdList(value.order, normalizeIdList(fallback?.order, CURRENT_DASHBOARD_WIDGET_IDS));
  const hiddenWidgetIds = normalizeIdList(value.hiddenWidgetIds, normalizeIdList(fallback?.hiddenWidgetIds, []));
  const rawWidgets = isRecord(value.widgets) ? value.widgets : {};
  const widgetIds = normalizeIdList([...order, ...Object.keys(rawWidgets)], CURRENT_DASHBOARD_WIDGET_IDS);
  const widgets: Record<string, DashboardWidgetPreferences> = {};
  for (const id of widgetIds) widgets[id] = normalizeWidgetPreferences(id, rawWidgets[id]);
  return {
    ...preserved,
    version: 1,
    preset,
    order,
    hiddenWidgetIds,
    widgets,
    dismissedExtraLargeRecommendation: typeof value.dismissedExtraLargeRecommendation === "boolean"
      ? value.dismissedExtraLargeRecommendation
      : undefined,
    updatedAt: validTimestamp(value.updatedAt),
  };
}

/** Current-profile values win conflicts; imported-only IDs and future fields fill gaps. */
export function mergeDashboardLayoutPreferences(
  currentValue: unknown,
  importedValue: unknown,
): DashboardLayoutPreferences | undefined {
  const current = normalizeDashboardLayoutPreferences(currentValue);
  const imported = normalizeDashboardLayoutPreferences(importedValue);
  if (!current) return imported;
  if (!imported) return current;

  const currentIds = new Set([...current.order, ...Object.keys(current.widgets)]);
  const order = normalizeIdList([...current.order, ...imported.order], CURRENT_DASHBOARD_WIDGET_IDS);
  const hiddenWidgetIds = normalizeIdList([
    ...current.hiddenWidgetIds,
    ...imported.hiddenWidgetIds.filter((id) => !currentIds.has(id)),
  ], []);
  const widgetIds = [...new Set([...Object.keys(imported.widgets), ...Object.keys(current.widgets)])].sort();
  const widgets: Record<string, DashboardWidgetPreferences> = {};
  for (const id of widgetIds) {
    const importedWidget = imported.widgets[id];
    const currentWidget = current.widgets[id];
    widgets[id] = normalizeWidgetPreferences(id, {
      ...importedWidget,
      ...currentWidget,
      preferences: {
        ...(importedWidget?.preferences ?? {}),
        ...(currentWidget?.preferences ?? {}),
      },
    });
  }
  return normalizeDashboardLayoutPreferences({
    ...imported,
    ...current,
    order,
    hiddenWidgetIds,
    widgets,
    dismissedExtraLargeRecommendation: current.dismissedExtraLargeRecommendation
      ?? imported.dismissedExtraLargeRecommendation,
  });
}

export function applyDashboardLayoutPreset(
  value: unknown,
  presetId: DashboardLayoutPresetId,
  updatedAt = new Date().toISOString(),
): DashboardLayoutPreferences {
  const current = normalizeDashboardLayoutPreferences(value) ?? adaptLegacyDashboardLayout();
  if (presetId === "custom") return { ...current, preset: "custom", updatedAt };
  const preset = PRESET_BY_ID.get(presetId)!;
  const widgets = { ...current.widgets };
  for (const id of preset.order) {
    widgets[id] = normalizeWidgetPreferences(id, {
      ...(widgets[id] ?? defaultDashboardWidgetPreferences(id)),
      size: preset.sizes[id] ?? dashboardWidgetCatalogItem(id).defaultSize,
    });
  }
  return normalizeDashboardLayoutPreferences({
    ...current,
    preset: presetId,
    order: preset.order,
    hiddenWidgetIds: preset.hiddenWidgetIds,
    widgets,
    dismissedExtraLargeRecommendation: false,
    defaultsRevision: DASHBOARD_DEFAULTS_REVISION,
    updatedAt,
  })!;
}

/**
 * Carries a saved layout forward to the current defaults without undoing the
 * learner's own choices. Any edit turns a layout "custom", so a named preset
 * here means an untouched one: it takes the preset's new order. A custom
 * layout only gains the new widget, placed where the defaults put it and
 * shown only if its neighbour (the timer) is showing.
 */
export function upgradeDashboardLayout(layout: DashboardLayoutPreferences): DashboardLayoutPreferences {
  if ((layout.defaultsRevision ?? 1) >= DASHBOARD_DEFAULTS_REVISION) return layout;
  const hidden = new Set(layout.hiddenWidgetIds);
  const widgets = { ...layout.widgets };
  let order = [...layout.order];
  const preset = layout.preset === "custom" ? undefined : PRESET_BY_ID.get(layout.preset);
  if (preset) {
    order = [...preset.order, ...order.filter((id) => !preset.order.includes(id as DashboardWidgetId))];
    if (preset.hiddenWidgetIds.includes("soundscapes")) hidden.add("soundscapes");
    else hidden.delete("soundscapes");
    widgets.soundscapes ??= normalizeWidgetPreferences("soundscapes", { size: preset.sizes.soundscapes });
  } else if (!order.includes("soundscapes")) {
    const timer = order.indexOf("pomodoro");
    order.splice(timer < 0 ? order.length : timer + 1, 0, "soundscapes");
    if (timer < 0 || hidden.has("pomodoro")) hidden.add("soundscapes");
    widgets.soundscapes ??= defaultDashboardWidgetPreferences("soundscapes");
  }
  return { ...layout, order, hiddenWidgetIds: [...hidden], widgets, defaultsRevision: DASHBOARD_DEFAULTS_REVISION };
}

export function countExtraLargeWidgets(value: unknown): number {
  const layout = normalizeDashboardLayoutPreferences(value);
  if (!layout) return 0;
  const hidden = new Set(layout.hiddenWidgetIds);
  return layout.order.filter((id) => !hidden.has(id) && layout.widgets[id]?.size === "extra-large").length;
}

export function extraLargeWidgetRecommendation(value: unknown, limit = RECOMMENDED_EXTRA_LARGE_WIDGET_LIMIT) {
  const layout = normalizeDashboardLayoutPreferences(value);
  const count = countExtraLargeWidgets(layout);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RECOMMENDED_EXTRA_LARGE_WIDGET_LIMIT;
  return {
    count,
    limit: safeLimit,
    exceedsRecommendation: count > safeLimit,
    dismissed: layout?.dismissedExtraLargeRecommendation === true,
    shouldShow: count > safeLimit && layout?.dismissedExtraLargeRecommendation !== true,
  };
}

function normalizeWidgetPreferences(id: string, value: unknown): DashboardWidgetPreferences {
  const record = isRecord(value) ? value : {};
  const preserved = sanitizeRecord(record);
  const item = dashboardWidgetCatalogItem(id);
  const size = isDashboardWidgetSize(record.size) && item.supportedSizes.includes(record.size)
    ? record.size
    : item.defaultSize;
  const enabledFields = Array.isArray(record.enabledFields)
    ? normalizeStringList(record.enabledFields, 100)
    : item.fields.filter((field) => field.defaultEnabled).map((field) => field.id);
  return {
    ...preserved,
    size,
    enabledFields,
    preferences: isRecord(record.preferences) ? sanitizeRecord(record.preferences) : {},
  };
}

function normalizeIdList(value: unknown, fallback: readonly string[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return normalizeStringList(source, 100);
}

function normalizeStringList(value: readonly unknown[], limit: number): string[] {
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean))].slice(0, limit);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    const sanitized = sanitizeJson(item, 0);
    if (sanitized !== undefined) output[key.slice(0, 120)] = sanitized;
  }
  return output;
}

function sanitizeJson(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeJson(item, depth + 1)).filter((item) => item !== undefined);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      const sanitized = sanitizeJson(item, depth + 1);
      if (sanitized !== undefined) output[key.slice(0, 120)] = sanitized;
    }
    return output;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardWidgetSize(value: unknown): value is DashboardWidgetSize {
  return value === "small" || value === "medium" || value === "large" || value === "extra-large";
}

function isDashboardLayoutPreset(value: unknown): value is DashboardLayoutPresetId {
  return value === "focused" || value === "study-heavy" || value === "wellbeing-balanced" || value === "custom";
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function titleFromId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
