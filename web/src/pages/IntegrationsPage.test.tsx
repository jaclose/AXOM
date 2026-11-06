// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
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
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    const panel = screen.getByText(/event.*from today onward/).closest(".calendar-export") as HTMLElement;
    expect(within(panel).getByText(/^1 event/)).toBeTruthy();
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
  it("surfaces invalid dates instead of downloading a malformed calendar, then recovers", () => {
    const createObjectURL = vi.fn(() => "blob:ics");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const task = useStore.getState().tasks[0];
    useStore.setState({ tasks: [{ ...task, due: "2999-02-31" }] });
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/invalid date or identifier/i);
    expect(createObjectURL).not.toHaveBeenCalled();

    act(() => useStore.setState({ tasks: [{ ...task, due: "2999-03-01" }] }));
    // Editing a task occurs outside the export panel. Reopen it to exercise the
    // actual return journey, not an impossible in-panel date editor.
    fireEvent.click(screen.getByRole("button", { name: /Hide options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    expect(screen.getByText(/^1 event/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("reports a browser download failure separately and clears the error after changing choices", () => {
    const createObjectURL = vi.fn(() => { throw new Error("downloads blocked"); });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Create calendar file/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download .ics/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be downloaded/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /Open tasks with due dates/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    vi.unstubAllGlobals();
  });

});
