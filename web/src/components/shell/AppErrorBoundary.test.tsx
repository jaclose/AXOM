// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps a recovery screen and useful diagnostics when a screen throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never { throw new Error("guide-render-failed"); }
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
  expect(screen.getByRole("alert").textContent).toContain("Your local data has not been cleared");
  expect(screen.getByRole("button", { name: "Reopen AXOM" })).toBeTruthy();
  expect(screen.getByText("guide-render-failed")).toBeTruthy();
});
