// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { FeedbackForm } from "./HelpPage";

beforeEach(() => {
  const seed = makeSeed();
  seed.profile.name = "Private Name";
  seed.journal = [{ id: "private-journal", date: "2026-07-12", today: "private journal text", tomorrow: "", blockers: "", energy: "Low", rating: "" }];
  seed.logs = [{ id: "private-log", dayKey: seed.activeDayKey, ts: "2026-07-12T12:00:00.000Z", type: "Private activity", minutes: 30, cards: 0, academic: true, productive: true }];
  useStore.setState(seed);
  location.hash = "#help";
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Help feedback", () => {
  it("constructs a safe local draft with the correct urgent subject", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<FeedbackForm />);
    fireEvent.change(screen.getByLabelText("Feedback type"), { target: { value: "Urgent" } });
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "Question Bank" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "The import is blocked." } });

    const link = screen.getByRole("link", { name: "Open email draft" });
    const draft = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(draft).toContain("mailto:jafardabbagh@gmail.com");
    expect(draft).toContain("subject=[AXOM Urgent]&");
    expect(draft).toContain("Page or feature: Question Bank");
    expect(draft).toContain("Schema version: 34");
    expect(draft).toContain("Route: #help");
    expect(draft).not.toContain("Private Name");
    expect(draft).not.toContain("private journal text");
    expect(draft).not.toContain("Private activity");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("AXOM support is not an emergency service.")).toBeTruthy();
  });

  it("does not expose a destination before the user writes a message", () => {
    render(<FeedbackForm />);
    const link = screen.getByText("Open email draft").closest("a")!;
    expect(link.getAttribute("href")).toBeNull();
    expect(link.getAttribute("aria-disabled")).toBe("true");
  });
});
