// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary, isChunkLoadError } from "./RouteErrorBoundary";

function Boom({ error }: { error: Error }): never { throw error; }

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RouteErrorBoundary", () => {
  it("recognises failed lazy chunks from each browser", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://axom.info/assets/DailyWordPage-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of null (reading 'map')"))).toBe(false);
  });

  it("keeps a stale-deploy failure inside the shell and offers a reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new TypeError("Failed to fetch dynamically imported module: x.js")} /></RouteErrorBoundary>);
    expect(screen.getByRole("heading", { name: "This screen needs the latest AXOM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reload AXOM/ })).toBeTruthy();
  });

  it("lets a render failure retry and go home", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onHome = vi.fn();
    let fail = true;
    function Flaky() { if (fail) throw new Error("render broke"); return <p>screen ok</p>; }
    render(<RouteErrorBoundary onHome={onHome}><Flaky /></RouteErrorBoundary>);
    expect(screen.getByRole("heading", { name: "This screen hit a snag" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dashboard/ }));
    expect(onHome).toHaveBeenCalledOnce();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("screen ok")).toBeTruthy();
  });
});
