// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/brand";
import { ThemeToggle } from "../ui/ThemeToggle";
import { QuickThemeControl } from "./QuickThemeControl";

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  document.head.innerHTML = '<meta name="theme-color" content="#0d0d0e">';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.removeAttribute("style");
});

describe("QuickThemeControl", () => {
  it("offers Light, Dark, and System through the canonical persisted preference", () => {
    render(<QuickThemeControl />);
    const trigger = screen.getByRole("button", { name: "Theme: System. Choose appearance" });
    expect(trigger.querySelector(".lucide-monitor")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Appearance" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBe(dialog);
    expect(within(within(dialog).getByRole("group", { name: "Theme" })).getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "light", "dark", "system",
    ]);
    const palettes = within(dialog).getByRole("radiogroup", { name: "Accent palette" });
    expect(within(palettes).getAllByRole("radio").length).toBeGreaterThanOrEqual(9);
    expect(within(palettes).getByRole("radio", { name: /AXOM Classic/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("radio", { name: /System/ }));

    fireEvent.click(within(dialog).getByRole("radio", { name: /Dark/ }));
    expect(localStorage.getItem(STORAGE_KEYS.themePreference)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByRole("dialog", { name: "Appearance" })).toBeNull();
    const updated = screen.getByRole("button", { name: "Theme: Dark. Choose appearance" });
    expect(updated.querySelector(".lucide-moon")).toBeTruthy();
    expect(document.activeElement).toBe(updated);
  });

  it("stays synchronized with the full Personalization control without a second theme state", () => {
    render(<><QuickThemeControl /><ThemeToggle /></>);
    fireEvent.click(screen.getByRole("radio", { name: /Light/ }));
    expect(screen.getByRole("button", { name: "Theme: Light. Choose appearance" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light. Choose appearance" }));
    const quickDialog = screen.getByRole("dialog", { name: "Appearance" });
    fireEvent.click(within(quickDialog).getByRole("radio", { name: /System/ }));
    expect((screen.getByRole("radio", { name: /System/ }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.themePreference)).toBe("system");
  });

  it("closes on Escape or outside input and restores focus to its compact trigger", () => {
    render(<div><QuickThemeControl /><button type="button">Outside</button></div>);
    const trigger = screen.getByRole("button", { name: /Theme: System/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
