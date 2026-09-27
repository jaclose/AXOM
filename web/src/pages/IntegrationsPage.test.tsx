// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { IntegrationsPage } from "./IntegrationsPage";

beforeEach(() => {
  const seed = makeSeed();
  seed.tasks = [{ id: "t1", title: "Renal quiz", due: "2999-01-01", done: false, created: "2026-09-01" }];
  useStore.setState(seed);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Integrations", () => {
  it("groups integrations by readiness and states what leaves the device", () => {
    render(<IntegrationsPage />);
    expect(screen.getByRole("heading", { name: "Works today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Experimental" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Planned" })).toBeTruthy();
    expect(screen.getAllByText("What leaves your device:").length).toBeGreaterThan(5);
    expect(screen.queryByText(/Vercel/)).toBeNull();
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
});
