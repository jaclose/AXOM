// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { ApplicationCheckerPage } from "./ApplicationCheckerPage";

function respond(dataset: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dataset), {
    status: 200, headers: { "content-type": "application/json" },
  })));
}
function openMedicalSchools() {
  fireEvent.click(screen.getByRole("tab", { name: /Medical school/ }));
}
beforeEach(() => { localStorage.clear(); useStore.setState(makeSeed()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Capability coverage remains active without exposing this unfinished route.
describe("Application Checker sourced-data capabilities", () => {
  it("renders source provenance and searches a supplied verified school", async () => {
    respond({ schemaVersion: 1, generatedAt: "2026-08-09T12:00:00Z", schools: [{
      id: "synthetic-med", name: "Synthetic School of Medicine", location: "Test City", degree: "MD",
      applicationPlatform: "Unknown", verificationStatus: "verified",
      sources: [{ url: "https://example.edu/admissions", retrievedAt: "2026-08-08T12:00:00Z" }],
    }] });
    render(<ApplicationCheckerPage />);
    openMedicalSchools();
    expect(await screen.findByText("Synthetic School of Medicine")).toBeTruthy();
    expect(within(screen.getByRole("article")).getByText("Verified", { exact: true })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe("https://example.edu/admissions");
    fireEvent.change(screen.getByLabelText("Search schools"), { target: { value: "no match" } });
    expect(await screen.findByText("No matching schools")).toBeTruthy();
  });

  it("keeps all 271 partial records searchable while limiting cards and filtering program type", async () => {
    const schools = Array.from({ length: 271 }, (_, index) => ({
      id: `school-${index}`, canonicalName: `Synthetic Medical School ${index}`, name: `Synthetic Medical School ${index}`,
      programType: index % 2 ? "md" : "do", location: `State ${index % 10}`,
      verificationStatus: index % 7 === 0 ? "unknown" : "incomplete", sources: [],
    }));
    respond({ schemaVersion: 2, generatedAt: "2026-08-09T12:00:00Z", recordCount: 271, schools });
    render(<ApplicationCheckerPage />);
    openMedicalSchools();
    expect(await screen.findByText("271 schools")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Showing 24 of 271");
    expect(screen.getAllByRole("article")).toHaveLength(24);
    fireEvent.change(screen.getByLabelText("Search schools"), { target: { value: "Synthetic Medical School 270" } });
    expect(await screen.findByRole("heading", { name: "Synthetic Medical School 270" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search schools"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter program type"), { target: { value: "md" } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Synthetic Medical School 1" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Synthetic Medical School 0" })).toBeNull();
  });
});
