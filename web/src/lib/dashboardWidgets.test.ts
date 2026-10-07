import { describe, expect, it } from "vitest";
import {
  CURRENT_DASHBOARD_WIDGET_IDS,
  DASHBOARD_LAYOUT_PRESETS,
  DASHBOARD_WIDGET_CATALOG,
  adaptLegacyDashboardLayout,
  applyDashboardLayoutPreset,
  countExtraLargeWidgets,
  dashboardWidgetCatalogItem,
  dashboardWidgetOptions,
  extraLargeWidgetRecommendation,
  mergeDashboardLayoutPreferences,
  normalizeDashboardLayoutPreferences,
  upgradeDashboardLayout,
} from "./dashboardWidgets";
import { STORED_DASHBOARD_WIDGET_IDS } from "./seed";

describe("dashboard widget layout model", () => {
  it("provides a stable adapter for every current, legacy, and storage-only widget ID", () => {
    expect(new Set(DASHBOARD_WIDGET_CATALOG.map((item) => item.id)).size).toBe(DASHBOARD_WIDGET_CATALOG.length);
    for (const id of STORED_DASHBOARD_WIDGET_IDS) {
      expect(dashboardWidgetCatalogItem(id).id).toBe(id);
      expect(dashboardWidgetCatalogItem(id).unavailable).not.toBe(true);
    }
    expect(CURRENT_DASHBOARD_WIDGET_IDS).toEqual(expect.arrayContaining([
      "welcome", "commandBrief", "questionBank", "courseTracker", "tasks", "readiness",
      "activity", "journal", "streak", "dailyWord",
    ]));
    expect(CURRENT_DASHBOARD_WIDGET_IDS).not.toContain("aiActions");
    expect(dashboardWidgetCatalogItem("future-widget")).toMatchObject({ id: "future-widget", unavailable: true });
  });

  it("adapts legacy order and visibility without deleting unknown IDs", () => {
    const layout = adaptLegacyDashboardLayout({
      order: ["todayScore", "future-widget", "todayScore"],
      hiddenWidgetIds: ["future-widget", "aiActions"],
      updatedAt: "2026-07-13T12:00:00.000Z",
    });
    expect(layout.preset).toBe("custom");
    expect(layout.order).toEqual(["todayScore", "future-widget"]);
    expect(layout.hiddenWidgetIds).toEqual(["future-widget", "aiActions"]);
    expect(layout.widgets["future-widget"]).toMatchObject({ size: "medium", enabledFields: [] });
    expect(layout.updatedAt).toBe("2026-07-13T12:00:00.000Z");
  });

  it("normalizes sizes and lists while preserving serializable future fields", () => {
    const layout = normalizeDashboardLayoutPreferences({
      version: 99,
      preset: "future-preset",
      order: ["readiness", "future-widget", "readiness", ""],
      hiddenWidgetIds: ["future-hidden"],
      dismissedExtraLargeRecommendation: true,
      futureLayoutOption: { density: "calm" },
      widgets: {
        readiness: {
          size: "extra-large",
          enabledFields: [],
          preferences: { colorMode: "quiet" },
          futureWidgetOption: "preserve-me",
        },
        "future-widget": {
          size: "extra-large",
          enabledFields: ["alpha", "alpha", "future-field"],
          preferences: { nested: { safe: true }, invalid: Number.NaN },
        },
      },
    })!;

    expect(layout.version).toBe(1);
    expect(layout.preset).toBe("custom");
    expect(layout.futureLayoutOption).toEqual({ density: "calm" });
    expect(layout.widgets.readiness).toMatchObject({
      size: "small",
      enabledFields: [],
      preferences: { colorMode: "quiet" },
      futureWidgetOption: "preserve-me",
    });
    expect(layout.widgets["future-widget"]).toMatchObject({
      size: "extra-large",
      enabledFields: ["alpha", "future-field"],
      preferences: { nested: { safe: true } },
    });
  });

  it("applies each named preset deterministically and leaves custom layouts intact", () => {
    expect(DASHBOARD_LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([
      "focused", "study-heavy", "wellbeing-balanced", "custom",
    ]);
    const legacy = adaptLegacyDashboardLayout({
      order: ["future-widget", "todayScore"],
      hiddenWidgetIds: ["future-widget"],
    });
    legacy.widgets["future-widget"].preferences = { preserved: true };
    const focused = applyDashboardLayoutPreset(legacy, "focused", "2026-07-13T12:00:00.000Z");
    expect(focused.preset).toBe("focused");
    expect(focused.order[0]).toBe("welcome");
    expect(focused.widgets["future-widget"].preferences).toEqual({ preserved: true });
    expect(focused.updatedAt).toBe("2026-07-13T12:00:00.000Z");

    const custom = applyDashboardLayoutPreset(focused, "custom", "2026-07-13T13:00:00.000Z");
    expect(custom).toMatchObject({
      preset: "custom",
      order: focused.order,
      hiddenWidgetIds: focused.hiddenWidgetIds,
      widgets: focused.widgets,
      updatedAt: "2026-07-13T13:00:00.000Z",
    });
  });

  it("merges imported-only metadata while current layout choices win conflicts", () => {
    const current = normalizeDashboardLayoutPreferences({
      version: 1,
      preset: "custom",
      order: ["todayScore"],
      hiddenWidgetIds: [],
      widgets: {
        todayScore: { size: "large", enabledFields: ["progress"], preferences: { current: true, shared: "current" } },
      },
      currentOnly: "kept",
    });
    const imported = normalizeDashboardLayoutPreferences({
      version: 1,
      preset: "study-heavy",
      order: ["todayScore", "future-widget"],
      hiddenWidgetIds: ["todayScore", "future-widget"],
      widgets: {
        todayScore: { size: "small", enabledFields: ["sources"], preferences: { imported: true, shared: "imported" } },
        "future-widget": { size: "extra-large", enabledFields: ["future-field"], futureOnly: 1 },
      },
      importedOnly: "filled",
    });

    const merged = mergeDashboardLayoutPreferences(current, imported)!;
    expect(merged.preset).toBe("custom");
    expect(merged.order).toEqual(["todayScore", "future-widget"]);
    expect(merged.hiddenWidgetIds).toEqual(["future-widget"]);
    expect(merged.widgets.todayScore).toMatchObject({
      size: "large",
      enabledFields: ["progress"],
      preferences: { imported: true, current: true, shared: "current" },
    });
    expect(merged.widgets["future-widget"]).toMatchObject({ size: "extra-large", futureOnly: 1 });
    expect(merged).toMatchObject({ currentOnly: "kept", importedOnly: "filled" });
  });

  it("counts only visible extra-large widgets and exposes a dismissible soft recommendation", () => {
    const layout = normalizeDashboardLayoutPreferences({
      version: 1,
      preset: "custom",
      order: ["welcome", "commandBrief", "questionBank", "journal"],
      hiddenWidgetIds: [],
      widgets: {
        welcome: { size: "extra-large" },
        commandBrief: { size: "extra-large" },
        questionBank: { size: "extra-large" },
        journal: { size: "extra-large" },
      },
    })!;
    expect(countExtraLargeWidgets(layout)).toBe(4);
    expect(extraLargeWidgetRecommendation(layout)).toEqual({
      count: 4,
      limit: 3,
      exceedsRecommendation: true,
      dismissed: false,
      shouldShow: true,
    });
    expect(extraLargeWidgetRecommendation({ ...layout, dismissedExtraLargeRecommendation: true }).shouldShow).toBe(false);
  });
});

describe("dashboard defaults revision 2: check-in, timer, soundscapes", () => {
  const gridOrder = (layout: { order: string[]; hiddenWidgetIds: string[] }) =>
    layout.order.filter((id) => !layout.hiddenWidgetIds.includes(id) && id !== "welcome" && id !== "commandBrief");

  it("leads a new Focused dashboard with the check-in, then the timer with soundscapes beside it", () => {
    const focused = applyDashboardLayoutPreset(adaptLegacyDashboardLayout(), "focused", "2026-09-30T12:00:00.000Z");
    expect(gridOrder(focused).slice(0, 3)).toEqual(["winDay", "pomodoro", "soundscapes"]);
    expect(focused.widgets.pomodoro.size).toBe("small");
    expect(focused.widgets.soundscapes.size).toBe("small");
    expect(upgradeDashboardLayout(focused)).toBe(focused);
  });

  it("moves an untouched preset layout onto the new order without hiding anything it showed", () => {
    const oldFocused = normalizeDashboardLayoutPreferences({
      version: 1,
      preset: "focused",
      order: ["welcome", "commandBrief", "winDay", "todayScore", "tasks", "courseTracker", "questionBank", "pomodoro", "weekly"],
      hiddenWidgetIds: ["journal", "dailyWord"],
      widgets: { tasks: { size: "large" } },
    })!;
    const upgraded = upgradeDashboardLayout(oldFocused);
    expect(gridOrder(upgraded).slice(0, 3)).toEqual(["winDay", "pomodoro", "soundscapes"]);
    expect(gridOrder(upgraded)).toContain("tasks");
    expect(upgraded.widgets.tasks.size).toBe("large");
    expect(upgraded.defaultsRevision).toBe(2);
    expect(upgradeDashboardLayout(upgraded)).toBe(upgraded);
  });

  it("keeps a custom order and slots soundscapes in right after the timer", () => {
    const custom = normalizeDashboardLayoutPreferences({
      version: 1,
      preset: "custom",
      order: ["questionBank", "pomodoro", "journal", "winDay"],
      hiddenWidgetIds: [],
      widgets: {},
    })!;
    expect(upgradeDashboardLayout(custom).order).toEqual(["questionBank", "pomodoro", "soundscapes", "journal", "winDay"]);
  });

  it("adds soundscapes hidden when the learner hid or never had the timer", () => {
    const hiddenTimer = normalizeDashboardLayoutPreferences({
      version: 1, preset: "custom", order: ["winDay", "pomodoro"], hiddenWidgetIds: ["pomodoro"], widgets: {},
    })!;
    expect(upgradeDashboardLayout(hiddenTimer).hiddenWidgetIds).toContain("soundscapes");
    const noTimer = normalizeDashboardLayoutPreferences({
      version: 1, preset: "custom", order: ["winDay"], hiddenWidgetIds: [], widgets: {},
    })!;
    const upgraded = upgradeDashboardLayout(noTimer);
    expect(upgraded.order).toEqual(["winDay", "soundscapes"]);
    expect(upgraded.hiddenWidgetIds).toContain("soundscapes");
  });

  it("never re-adds soundscapes after the learner removes it", () => {
    const custom = upgradeDashboardLayout(normalizeDashboardLayoutPreferences({
      version: 1, preset: "custom", order: ["pomodoro"], hiddenWidgetIds: [], widgets: {},
    })!);
    const removed = normalizeDashboardLayoutPreferences({ ...custom, hiddenWidgetIds: ["soundscapes"] })!;
    expect(upgradeDashboardLayout(removed).hiddenWidgetIds).toEqual(["soundscapes"]);
  });

  it("reads widget options from saved preferences, falling back to their defaults", () => {
    expect(dashboardWidgetCatalogItem("winDay").defaultSize).toBe("large");
    expect(dashboardWidgetOptions("winDay")).toEqual({ writing: false });
    expect(dashboardWidgetOptions("winDay", { size: "large", preferences: { writing: true } })).toEqual({ writing: true });
    expect(dashboardWidgetOptions("winDay", { size: "large", preferences: { writing: "yes" } })).toEqual({ writing: false });
    expect(dashboardWidgetOptions("tasks")).toEqual({});
  });
});
