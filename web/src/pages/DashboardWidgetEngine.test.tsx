// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDashboardLayoutPreset, adaptLegacyDashboardLayout } from "../lib/dashboardWidgets";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { DashboardPage } from "./DashboardPage";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const seed = makeSeed();
  seed.profile.dashboardLayout = applyDashboardLayoutPreset(adaptLegacyDashboardLayout(), "focused", "2026-07-13T12:00:00.000Z");
  seed.tasks.push({
    id: "real-task",
    title: "Review renal physiology",
    done: false,
    archived: false,
    created: "2026-07-13T10:00:00.000Z",
    due: "2026-07-13",
  });
  useStore.setState(seed);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Focused hides Tasks now (it left the sidebar defaults too); these flows start from a student who added it back. */
function showTasksWidget() {
  const layout = structuredClone(useStore.getState().profile.dashboardLayout!);
  layout.hiddenWidgetIds = layout.hiddenWidgetIds.filter((id) => id !== "tasks");
  useStore.getState().updateProfile({ dashboardLayout: layout });
}

describe("Dashboard widget engine", () => {
  it("renders the focused core grid and a catalog that omits removed recommendation widgets", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    expect(screen.getByRole("region", { name: "Dashboard widgets" })).toBeTruthy();
    expect(screen.getByText("Question Bank", { selector: ".panel-title" })).toBeTruthy();
    expect(screen.getByText("Course Tracker", { selector: ".panel-title" })).toBeTruthy();
    expect(screen.getByText("Soundscape", { selector: ".panel-title" })).toBeTruthy();
    expect(screen.queryByText("Tasks", { selector: ".panel-title" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit dashboard" }));
    expect(screen.getAllByText("Build your dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("On your dashboard")).toBeTruthy();
    expect(screen.getByText("Suggested")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Experimental")).toBeTruthy();
    expect(screen.getByText("Hidden")).toBeTruthy();
    expect(screen.queryByText("AI Suggested Actions")).toBeNull();
    expect(screen.queryByText("Suggested moves", { exact: true })).toBeNull();
  });

  it("removes, restores, and keyboard-reorders widgets without deleting source data", async () => {
    const user = userEvent.setup();
    showTasksWidget();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Edit dashboard" }));
    const beforeTasks = structuredClone(useStore.getState().tasks);

    await user.click(screen.getByRole("button", { name: "Remove Tasks" }));
    expect(useStore.getState().profile.dashboardLayout?.hiddenWidgetIds).toContain("tasks");
    expect(useStore.getState().tasks).toEqual(beforeTasks);

    const taskCatalogRow = screen.getAllByText("Tasks", { selector: "b" })
      .map((node) => node.closest("article"))
      .find((node) => node?.querySelector("button"));
    expect(taskCatalogRow).toBeTruthy();
    await user.click(within(taskCatalogRow!).getByRole("button", { name: "Add" }));
    expect(useStore.getState().profile.dashboardLayout?.hiddenWidgetIds).not.toContain("tasks");

    const before = useStore.getState().profile.dashboardLayout!;
    const visibleBefore = before.order.filter((id) => !before.hiddenWidgetIds.includes(id));
    const neighbour = visibleBefore[visibleBefore.indexOf("tasks") - 1];
    await user.click(screen.getByRole("button", { name: "Move Tasks up" }));
    const afterOrder = useStore.getState().profile.dashboardLayout?.order ?? [];
    expect(afterOrder.indexOf("tasks")).toBeLessThan(afterOrder.indexOf(neighbour));
    expect(useStore.getState().tasks).toEqual(beforeTasks);
  });

  it("persists meaningful per-widget size and field settings atomically", async () => {
    const user = userEvent.setup();
    showTasksWidget();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Customize Tasks" }));
    const panel = screen.getByRole("region", { name: "Customize Tasks" });
    await user.click(within(panel).getByRole("radio", { name: /Large/ }));
    await user.click(within(panel).getByRole("checkbox", { name: "Completed" }));
    await user.click(within(panel).getByRole("button", { name: "Save" }));

    expect(useStore.getState().profile.dashboardLayout?.widgets.tasks).toMatchObject({
      size: "large",
      enabledFields: ["due", "overdue"],
    });
  });

  it("warns on a fourth extra-large widget but never hard-blocks the override", async () => {
    const user = userEvent.setup();
    const layout = structuredClone(useStore.getState().profile.dashboardLayout!);
    for (const id of ["welcome", "commandBrief", "todayScore"]) layout.widgets[id].size = "extra-large";
    layout.widgets.tasks.size = "medium";
    layout.hiddenWidgetIds = layout.hiddenWidgetIds.filter((id) => !["welcome", "commandBrief", "todayScore", "tasks"].includes(id));
    useStore.getState().updateProfile({ dashboardLayout: layout });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Customize Tasks" }));
    await user.click(screen.getByRole("radio", { name: /Extra large/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/no more than three extra-large widgets/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep recommended layout" }));
    expect(useStore.getState().profile.dashboardLayout?.widgets.tasks.size).toBe("medium");

    await user.click(screen.getByRole("button", { name: "Customize Tasks" }));
    await user.click(screen.getByRole("radio", { name: /Extra large/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Add anyway" }));
    expect(useStore.getState().profile.dashboardLayout?.widgets.tasks.size).toBe("extra-large");

    const reset = structuredClone(useStore.getState().profile.dashboardLayout!);
    reset.widgets.tasks.size = "medium";
    reset.dismissedExtraLargeRecommendation = false;
    useStore.getState().updateProfile({ dashboardLayout: reset });
    await user.click(screen.getByRole("button", { name: "Customize Tasks" }));
    await user.click(screen.getByRole("radio", { name: /Extra large/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Do not ask again" }));
    expect(useStore.getState().profile.dashboardLayout).toMatchObject({
      dismissedExtraLargeRecommendation: true,
      widgets: { tasks: { size: "extra-large" } },
    });
  });

  it("applies a dashboard preset without mutating tasks, questions, logs, or journal", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    const before = {
      tasks: structuredClone(useStore.getState().tasks),
      questions: structuredClone(useStore.getState().questions),
      logs: structuredClone(useStore.getState().logs),
      journal: structuredClone(useStore.getState().journal),
    };
    fireEvent.click(screen.getByRole("button", { name: "Wellbeing-balanced" }));

    expect(useStore.getState().profile.dashboardLayout?.preset).toBe("wellbeing-balanced");
    expect(useStore.getState().tasks).toEqual(before.tasks);
    expect(useStore.getState().questions).toEqual(before.questions);
    expect(useStore.getState().logs).toEqual(before.logs);
    expect(useStore.getState().journal).toEqual(before.journal);
  });
});
