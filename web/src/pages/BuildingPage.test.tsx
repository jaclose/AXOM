// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildingPage } from "./BuildingPage";
afterEach(cleanup);
describe("Building preview", () => {
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
    fireEvent.click(screen.getAllByRole("button", { name: /^See \d+ systems?/ })[0]);
    expect(screen.getByRole("tab", { name: "Systems" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /^Foundation/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Knowledge Graph" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    const card = screen.getByRole("heading", { name: "Knowledge Graph" }).closest(".system-card")!;
    fireEvent.mouseEnter(card);
    expect(screen.getByRole("heading", { name: "Semantic Search" }).closest(".system-card")!.className).toContain("is-related");
    expect(screen.getByRole("heading", { name: "Native AXOM" }).closest(".system-card")!.className).toContain("is-dim");
  });
});
