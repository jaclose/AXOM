// @vitest-environment jsdom
import { Component, Suspense, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyWithFallback } from "./lazyWithFallback";

class Catch extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p>caught: {this.state.error}</p> : this.props.children; }
}

afterEach(cleanup);

describe("lazyWithFallback", () => {
  it("renders the fallback when a deploy removed the chunk", async () => {
    const Part = lazyWithFallback(
      () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://axom.info/assets/ReleaseNotesHistory-old.js")),
      () => <p>notes after refresh</p>,
    );
    render(<Catch><Suspense fallback={<p>loading</p>}><Part /></Suspense></Catch>);
    expect(await screen.findByText("notes after refresh")).toBeTruthy();
  });

  it("still throws real bugs to the nearest boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Part = lazyWithFallback(() => Promise.reject(new Error("boom")), () => <p>fallback</p>);
    render(<Catch><Suspense fallback={<p>loading</p>}><Part /></Suspense></Catch>);
    expect(await screen.findByText("caught: boom")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
