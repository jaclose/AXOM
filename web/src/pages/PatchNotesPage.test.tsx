// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { APP_RELEASE_VERSION } from "../lib/brand";
import { PatchNotesPage } from "./PatchNotesPage";

afterEach(cleanup);

describe("PatchNotesPage", () => {
  it("shows the actual build version and lets a reader find a recorded change", async () => {
    const user = userEvent.setup();
    render(<PatchNotesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "What changed." })).toBeTruthy();
    expect(screen.getAllByText(`v${APP_RELEASE_VERSION}`).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "AXOM Orb" }).getAttribute("src")).toContain("axom-orb-512.png");
    expect(screen.getByText(/release[s]? in this view/).textContent).not.toMatch(/^0 /);

    await user.click(screen.getByRole("button", { name: "This version" }));
    expect(screen.getByRole("button", { name: "This version" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 release in this view")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: /^Search patch notes$/ }), "no-matching-release-term");
    expect(screen.getByRole("heading", { name: "No matching notes" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: /^Search patch notes$/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show all releases" }));
    expect(screen.getByRole("button", { name: "All releases" }).getAttribute("aria-pressed")).toBe("true");
    const search = screen.getByRole("searchbox", { name: /^Search patch notes$/ }) as HTMLInputElement;
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);

    await user.type(search, "Tutor");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
  });
});
