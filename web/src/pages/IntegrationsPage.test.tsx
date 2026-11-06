// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { buildIcs, calendarEvents } from "../lib/calendarExport";
import { useStore } from "../lib/store";
import { useAccount } from "../lib/account/accountStore";
import { useUi } from "../lib/uiStore";
import { IntegrationsPage } from "./IntegrationsPage";

beforeEach(() => {
  const seed = makeSeed();
  seed.tasks = [{ id: "t1", title: "Renal quiz", due: "2999-01-01", done: false, created: "2026-09-01" }];
  useStore.setState(seed);
  useAccount.setState({ phase: "unconfigured", user: null });
  useUi.getState().clearSettingsRequest();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Keep URL constructible for app/library consumers while replacing only the
// browser object-URL surface exercised by the calendar download action.
function stubCalendarObjectUrl(createObjectURL: (blob: Blob | MediaSource) => string) {
  const NativeURL = globalThis.URL;
  class DownloadURL extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", DownloadURL);
}

describe("Integrations", () => {
  it("groups integrations by readiness and states what leaves the device", () => {
    render(<IntegrationsPage />);
    expect(screen.getByRole("heading", { name: "Works today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Experimental" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unavailable in this build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Planned" })).toBeTruthy();
    expect(screen.getAllByText("What leaves your device:").length).toBeGreaterThan(5);
    expect(screen.queryByText(/Vercel/)).toBeNull();
  });

  it("offers local recovery when the account service is unconfigured", () => {
    render(<IntegrationsPage />);
    expect(screen.getByText(/Sign-in and cloud copies are switched off/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open recovery options/ }));
    expect(useUi.getState().settingsRequest).toBe("backup");
  });

  it("keeps the configured account in experimental readiness without an empty unavailable group", () => {
    useAccount.setState({ phase: "signed-out" });
    render(<IntegrationsPage />);
    expect(screen.getByRole("button", { name: /Check account status/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Unavailable in this build" })).toBeNull();
    expect(screen.getByText("Check each connection’s status before relying on it.")).toBeTruthy();
    expect(screen.getByText(/optional account connection you control/)).toBeTruthy();
  });

  it("builds a calendar file from chosen items", () => {
    const createObjectURL = vi.fn(() => "blob:ics");
    stubCalendarObjectUrl(createObjectURL);
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    const panel = screen.getByText(/event.*from today onward/).closest(".calendar-export") as HTMLElement;
    expect(within(panel).getByText(/^1 event/)).toBeTruthy();
    expect(within(panel).getByText(/file export, not live sync/i)).toBeTruthy();
    expect(within(panel).getByText(/may skip, update, or duplicate events/i)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /Download .ics/ }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("explains an empty calendar export and points to a dated task", () => {
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    const panel = screen.getByText(/event.*from today onward/).closest(".calendar-export") as HTMLElement;
    fireEvent.click(within(panel).getByRole("checkbox", { name: /Open tasks with due dates/ }));
    expect(within(panel).getByRole("button", { name: /Download .ics/ }).hasAttribute("disabled")).toBe(true);
    expect(within(panel).getByRole("link", { name: /Add a task with a due date/ }).getAttribute("href")).toBe("#productivity");
  });
  it("surfaces invalid dates instead of downloading a malformed calendar, then recovers", async () => {
    const createObjectURL = vi.fn((_blob: Blob | MediaSource) => "blob:ics");
    stubCalendarObjectUrl(createObjectURL);
    const task = useStore.getState().tasks[0];
    useStore.setState({ tasks: [{ ...task, due: "2999-02-31" }] });
    let calendarCommits = 0;
    const onCalendarCommit = () => { calendarCommits++; };
    const { rerender } = render(
      <Profiler id="calendar-recovery" onRender={onCalendarCommit}>
        <IntegrationsPage />
      </Profiler>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/invalid date or identifier/i);
    expect(createObjectURL).not.toHaveBeenCalled();

    // An unrelated store revision must not discard a still-applicable error.
    // Keeping the exact tasks reference simulates a non-calendar state update.
    const unchangedTasks = useStore.getState().tasks;
    act(() => useStore.setState({ tasks: unchangedTasks }));
    expect(screen.getByRole("alert").textContent).toMatch(/invalid date or identifier/i);

    // Use the actual learner task-update action rather than mutating the
    // persisted Zustand store directly from the harness. Verify that it emits
    // a new tasks reference for the mounted calendar subscriber.
    const commitsBeforeRepair = calendarCommits;
    const tasksBeforeRepair = useStore.getState().tasks;
    let taskChangeNotifications = 0;
    const unsubscribeTaskCheck = useStore.subscribe((state, previous) => {
      if (state.tasks !== previous.tasks) taskChangeNotifications++;
    });
    // Await React's full external-store/effect flush, not only synchronous
    // Zustand notification, before asserting the mounted panel's update.
    await act(async () => {
      useStore.getState().updateTask(task.id, { due: "2999-03-01" });
    });
    unsubscribeTaskCheck();
    expect(taskChangeNotifications).toBe(1);
    expect(useStore.getState().tasks).not.toBe(tasksBeforeRepair);
    // An external task edit must commit a mounted React update, not merely
    // notify Zustand listeners while leaving the calendar UI stale.
    expect(calendarCommits).toBeGreaterThan(commitsBeforeRepair);
    // Exercise React's mounted update boundary after the task action.
    // The real-browser E2E separately proves automatic subscription refresh.
    rerender(
      <Profiler id="calendar-recovery" onRender={onCalendarCommit}>
        <IntegrationsPage />
      </Profiler>,
    );
    // The learner repairs the task elsewhere while this panel remains open.
    // Retrying must use the updated store values, download valid bytes and
    // clear the stale validation error without reloading or remounting.
    expect(useStore.getState().tasks.map((entry) => entry.due)).toEqual(["2999-03-01"]);
    const current = useStore.getState();
    const eligible = calendarEvents(current, {
      tasks: true, exams: true, dayPlans: false, fromDay: current.activeDayKey,
    });
    expect(eligible).toEqual([expect.objectContaining({ uid: "task-t1", day: "2999-03-01" })]);
    expect(buildIcs(eligible)).toContain("DTSTART;VALUE=DATE:29990301");
    expect(screen.getByText(/^1 event/)).toBeTruthy();
    // Source errors refer to the old data and must disappear as soon as the
    // canonical task is repaired, even when the panel is never remounted.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    const retry = screen.getByRole("button", { name: /Download .ics/ });
    expect(retry.hasAttribute("disabled")).toBe(false);
    fireEvent.click(retry);
    expect(useStore.getState().tasks[0].due).toBe("2999-03-01");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    // Inspect the real generated file, not only whether the browser was asked
    // to download something. The repaired task date must replace the old one.
    const exported = createObjectURL.mock.calls[0][0] as Blob;
    const wire = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(exported);
    });
    expect(wire).toContain("DTSTART;VALUE=DATE:29990301");
    expect(wire).not.toContain("29990231");
    vi.unstubAllGlobals();
  });

  it("reports a browser download failure separately and clears the error after changing choices", () => {
    const createObjectURL = vi.fn(() => { throw new Error("downloads blocked"); });
    stubCalendarObjectUrl(createObjectURL);
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be downloaded/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /Open tasks with due dates/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("releases a generated URL and temporary link when the browser refuses the click", () => {
    const createObjectURL = vi.fn(() => "blob:ics");
    stubCalendarObjectUrl(createObjectURL);
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const browserClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => { throw new Error("download blocked after URL allocation"); });

    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));

    expect(screen.getByRole("alert").textContent).toMatch(/could not be downloaded/i);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(browserClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ics");
    expect(document.querySelector('a[download="axom-study-plan.ics"]')).toBeNull();
  });

});
