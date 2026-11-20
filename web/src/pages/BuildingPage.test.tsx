// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildingPage } from "./BuildingPage";
import { SYSTEM_PREVIEWS } from "../lib/buildingSystems";
afterEach(cleanup);
describe("Building preview", () => {
  it("gives each overview horizon a unique descriptive accessible action name", () => {
    render(<BuildingPage />);
    const actions = [
      screen.getByRole("button", { name: /^See \d+ systems? in Now roadmap$/i }),
      screen.getByRole("button", { name: /^See \d+ systems? in Next roadmap$/i }),
      screen.getByRole("button", { name: /^See \d+ systems? in Later roadmap$/i }),
    ];
    const names = actions.map((button) => button.getAttribute("aria-label"));
    expect(actions.every((button) => button.getAttribute("aria-label")?.includes(button.textContent?.trim() ?? ""))).toBe(true);
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(3);
  });
  it("labels concepts honestly and exposes the system map", () => {
    render(<BuildingPage />);
    expect(screen.getByText(/direction, not shipped capability/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    expect(screen.getByRole("heading", { name: "Accounts & Sync" })).toBeTruthy();
    expect(screen.getAllByText("RESEARCH").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /launch|open|try/i })).toBeNull();
  });
  it("filters by status from the overview and lights up connected systems", () => {
    render(<BuildingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^See \d+ systems? in Now roadmap$/i }));
    expect(screen.getByRole("tab", { name: "Systems" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /^Foundation/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Knowledge Graph" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    const card = screen.getByRole("heading", { name: "Knowledge Graph" }).closest(".system-card")!;
    fireEvent.mouseEnter(card);
    expect(screen.getByRole("heading", { name: "Semantic Search" }).closest(".system-card")!.className).toContain("is-related");
    expect(screen.getByRole("heading", { name: "Native AXOM" }).closest(".system-card")!.className).toContain("is-dim");
  });
  it("shows exactly the planned and in-development systems when opening the Next horizon", () => {
    render(<BuildingPage />);
    const nextSystems = SYSTEM_PREVIEWS.filter((system) => system.status === "planned" || system.status === "in-development");
    const nextCard = screen.getByRole("heading", { name: "Next" }).closest<HTMLElement>(".building-horizon")!;
    fireEvent.click(within(nextCard).getByRole("button", { name: `See ${nextSystems.length} systems in Next roadmap` }));

    const shown = [...document.querySelectorAll(".system-card h3")]
      .map((element) => element.textContent).sort();
    expect(shown).toEqual(nextSystems.map((system) => system.name).sort());
    expect(screen.getByRole("button", { name: /^Next / }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^All / }));
    expect(document.querySelectorAll(".system-card")).toHaveLength(SYSTEM_PREVIEWS.length);
  });

  it("exposes a roving tablist with arrow, Home and End navigation and an associated panel", () => {
    render(<BuildingPage />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const systems = screen.getByRole("tab", { name: "Systems" });
    expect(overview.tabIndex).toBe(0);
    expect(systems.tabIndex).toBe(-1);
    expect(overview.getAttribute("aria-controls")).toBe("building-active-panel");
    expect(systems.getAttribute("aria-controls")).toBe("building-active-panel");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(overview.id);

    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(document.activeElement).toBe(systems);
    expect(systems.getAttribute("aria-selected")).toBe("true");
    expect(overview.tabIndex).toBe(-1);
    expect(systems.tabIndex).toBe(0);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(systems.id);

    fireEvent.keyDown(systems, { key: "ArrowRight" });
    expect(document.activeElement).toBe(overview);
    expect(overview.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(overview, { key: "End" });
    expect(document.activeElement).toBe(systems);
    fireEvent.keyDown(systems, { key: "Home" });
    expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(systems);
  });

  it("moves focus to the Systems tab when a focused overview horizon is replaced", () => {
    render(<BuildingPage />);
    const nextCard = screen.getByRole("heading", { name: "Next" }).closest<HTMLElement>(".building-horizon")!;
    const link = within(nextCard).getByRole("button", { name: /^See \d+ systems? in Next roadmap$/i });
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.click(link);
    const systems = screen.getByRole("tab", { name: "Systems" });
    expect(document.activeElement).toBe(systems);
    expect(systems.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(systems.id);
    expect(screen.getByRole("button", { name: /^Next / }).getAttribute("aria-pressed")).toBe("true");
  });

  it("clears stale connected-system emphasis after leaving and returning to Systems", () => {
    render(<BuildingPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    const first = screen.getByRole("heading", { name: "Accounts & Sync" }).closest<HTMLElement>(".system-card")!;
    const unrelated = screen.getByRole("heading", { name: "Knowledge Graph" }).closest<HTMLElement>(".system-card")!;
    fireEvent.mouseEnter(first);
    expect(first.className).toContain("is-focus");
    expect(unrelated.className).toContain("is-dim");

    // Simulate keyboard tab activation while the pointer remains over the old card.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    const restored = screen.getByRole("heading", { name: "Accounts & Sync" }).closest<HTMLElement>(".system-card")!;
    const restoredOther = screen.getByRole("heading", { name: "Knowledge Graph" }).closest<HTMLElement>(".system-card")!;
    expect(restored.className).not.toContain("is-focus");
    expect(restoredOther.className).not.toContain("is-dim");

    fireEvent.mouseEnter(restored);
    expect(restored.className).toContain("is-focus");
    fireEvent.click(screen.getByRole("button", { name: /^Foundation/ }));
    expect(screen.getByRole("button", { name: /^Foundation/ }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".system-card.is-focus, .system-card.is-related, .system-card.is-dim")).toHaveLength(0);
  });

  it("keeps system relationships highlighted while either pointer hover or keyboard focus remains", () => {
    render(<BuildingPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    const card = screen.getByRole("heading", { name: "Accounts & Sync" }).closest<HTMLElement>(".system-card")!;
    const unrelated = screen.getByRole("heading", { name: "Knowledge Graph" }).closest<HTMLElement>(".system-card")!;

    // Mouse leaves a focused card: keyboard focus must still control emphasis.
    fireEvent.focus(card);
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(card.className).toContain("is-focus");
    expect(unrelated.className).toContain("is-dim");
    fireEvent.blur(card);
    expect(card.className).not.toContain("is-focus");
    expect(unrelated.className).not.toContain("is-dim");

    // Focus leaves a hovered card: pointer hover must still control emphasis.
    fireEvent.mouseEnter(card);
    fireEvent.focus(card);
    fireEvent.blur(card);
    expect(card.className).toContain("is-focus");
    expect(unrelated.className).toContain("is-dim");
    fireEvent.mouseLeave(card);
    expect(card.className).not.toContain("is-focus");
    expect(unrelated.className).not.toContain("is-dim");
  });

  it("announces the filtered system count and preserves filter-button focus", () => {
    render(<BuildingPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe(`Showing ${SYSTEM_PREVIEWS.length} systems (all statuses).`);

    const next = screen.getByRole("button", { name: /^Next / });
    next.focus();
    fireEvent.click(next);
    const nextCount = SYSTEM_PREVIEWS.filter((item) => item.status === "planned" || item.status === "in-development").length;
    expect(document.activeElement).toBe(next);
    expect(status.textContent).toBe(`Showing ${nextCount} systems (Next roadmap).`);
    expect(document.querySelectorAll(".system-card")).toHaveLength(nextCount);

    const foundation = screen.getByRole("button", { name: /^Foundation / });
    foundation.focus();
    fireEvent.click(foundation);
    expect(document.activeElement).toBe(foundation);
    expect(status.textContent).toBe("Showing 1 system (foundation).");
    expect(document.querySelectorAll(".system-card")).toHaveLength(1);

    const research = screen.getByRole("button", { name: /^Research / });
    research.focus();
    fireEvent.click(research);
    const researchCount = SYSTEM_PREVIEWS.filter((item) => item.status === "research").length;
    expect(document.activeElement).toBe(research);
    expect(status.textContent).toBe(`Showing ${researchCount} systems (research).`);
    expect(document.querySelectorAll(".system-card")).toHaveLength(researchCount);

    fireEvent.click(screen.getByRole("button", { name: /^All / }));
    expect(status.textContent).toBe(`Showing ${SYSTEM_PREVIEWS.length} systems (all statuses).`);
  });

  it("gives each keyboard-focusable system preview a named group tied to its heading", () => {
    render(<BuildingPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Systems" }));
    for (const item of SYSTEM_PREVIEWS) {
      const card = screen.getByRole("group", { name: item.name });
      expect(card.classList.contains("system-card")).toBe(true);
      expect(card.tabIndex).toBe(0);
      expect(card.getAttribute("aria-labelledby")).toBe(within(card).getByRole("heading", { name: item.name }).id);
    }
  });

});
