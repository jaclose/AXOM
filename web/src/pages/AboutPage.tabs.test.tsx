// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutPage } from "./AboutPage";

afterEach(cleanup);

describe("About page accessible tabs", () => {
  it("has one roving tab stop and a labelled, keyboard-focusable panel", () => {
    render(<AboutPage />);
    const about = screen.getByRole("tab", { name: "About AXOM" });
    const developer = screen.getByRole("tab", { name: "The developer" });
    const panel = screen.getByRole("tabpanel");
    expect(about.tabIndex).toBe(0);
    expect(developer.tabIndex).toBe(-1);
    expect(about.getAttribute("aria-selected")).toBe("true");
    expect(developer.getAttribute("aria-selected")).toBe("false");
    expect(about.getAttribute("aria-controls")).toBe(panel.id);
    expect(developer.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(about.id);
    expect(panel.tabIndex).toBe(0);
  });

  it("moves selection and focus with arrows, Home, and End", () => {
    render(<AboutPage />);
    const about = screen.getByRole("tab", { name: "About AXOM" });
    const developer = screen.getByRole("tab", { name: "The developer" });
    const panel = screen.getByRole("tabpanel");
    about.focus();
    fireEvent.keyDown(about, { key: "ArrowRight" });
    expect(document.activeElement).toBe(developer);
    expect(developer.tabIndex).toBe(0);
    expect(about.tabIndex).toBe(-1);
    expect(panel.getAttribute("aria-labelledby")).toBe(developer.id);
    expect(screen.getByTitle("Live site preview")).toBeTruthy();

    fireEvent.keyDown(developer, { key: "ArrowRight" });
    expect(document.activeElement).toBe(about);
    expect(about.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(about, { key: "End" });
    expect(document.activeElement).toBe(developer);
    fireEvent.keyDown(developer, { key: "Home" });
    expect(document.activeElement).toBe(about);
    fireEvent.keyDown(about, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(developer);
    expect(developer.getAttribute("aria-selected")).toBe("true");
  });

  it("does not destroy a live developer preview after thirty minutes", () => {
    // An unseen iframe key change destroys remote scroll, navigation and unsent forms.
    // Use identity rather than mocking the remote site, which is a separate origin.
    vi.useFakeTimers();
    try {
      render(<AboutPage />);
      fireEvent.click(screen.getByRole("tab", { name: "The developer" }));
      const frame = screen.getByTitle("Live site preview");
      frame.setAttribute("data-unsubmitted-interaction", "in-progress");
      act(() => { vi.advanceTimersByTime(30 * 60 * 1000 + 1000); });
      expect(screen.getByTitle("Live site preview")).toBe(frame);
      expect(frame.getAttribute("data-unsubmitted-interaction")).toBe("in-progress");
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes hosted shared media from unverified personal attachment recovery", () => {
    render(<AboutPage />);
    expect(screen.getByText(/Approved shared-course figures use a separate authenticated download path/)).toBeTruthy();
    expect(screen.getByText(/Personal cross-device image recovery still needs independent live account acceptance/)).toBeTruthy();
    expect(screen.queryByText(/Question images are device-only today/)).toBeNull();
  });

  it("leaves modified shortcuts untouched and still supports pointer clicks", () => {
    render(<AboutPage />);
    const about = screen.getByRole("tab", { name: "About AXOM" });
    const developer = screen.getByRole("tab", { name: "The developer" });
    about.focus();
    for (const init of [
      { key: "ArrowLeft", altKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "Home", ctrlKey: true },
      { key: "End", metaKey: true },
      { key: "ArrowRight", shiftKey: true },
    ]) {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      fireEvent(about, event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(about);
      expect(about.getAttribute("aria-selected")).toBe("true");
    }
    fireEvent.click(developer);
    // External preview must not transmit AXOM route or query details.
    expect(screen.getByTitle("Live site preview").getAttribute("referrerpolicy")).toBe("no-referrer");
    // Keep the preview in an opaque origin even after self-navigation; scripts and
    // forms can run, but popup/top-level navigation still require Open site.
    expect(screen.getByTitle("Live site preview").getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    const openSite = screen.getByRole("link", { name: /Open site/ });
    expect(openSite.getAttribute("href")).toBe("https://www.jafardabbagh.com/");
    expect(openSite.getAttribute("target")).toBe("_blank");
    expect(openSite.getAttribute("rel")).toContain("noopener");
    expect(document.activeElement).toBe(developer);
    expect(developer.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(developer.id);
  });
});
