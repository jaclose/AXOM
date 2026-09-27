// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AXOM_QUOTES } from "../../data/quotes";
import { STORAGE_KEYS } from "../../lib/brand";
import { TopBarQuote } from "./TopBarQuote";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function currentQuoteText() {
  return document.querySelector(".tb-quote-text")?.textContent ?? "";
}

describe("TopBarQuote", () => {
  it("shows a stable non-guilt quote with honest attribution and working actions", () => {
    render(<TopBarQuote dayKey="2026-09-26" route="dashboard" />);
    const first = currentQuoteText();
    const source = AXOM_QUOTES.find((quote) => quote.text === first);
    expect(source).toBeTruthy();
    expect(source?.guilt).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(first.slice(0, 12)) }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.querySelector(".tb-quote-full")?.textContent).toContain(first);

    fireEvent.click(screen.getByRole("button", { name: "Next quote" }));
    expect(currentQuoteText()).not.toBe(first);

    fireEvent.click(screen.getByRole("button", { name: /Favorite/ }));
    expect(screen.getByRole("button", { name: /Favorited/ }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(STORAGE_KEYS.quotePreferences)).toContain("favoriteQuoteIds");
    expect(localStorage.getItem(STORAGE_KEYS.quotePreferences)).not.toContain(first);

    const beforeHide = currentQuoteText();
    fireEvent.click(screen.getByRole("button", { name: /Hide/ }));
    expect(currentQuoteText()).not.toBe(beforeHide);
  });

  it("changes the quote per section when rotation is set to every section", () => {
    const { rerender } = render(<TopBarQuote dayKey="2026-09-26" route="dashboard" />);
    fireEvent.click(screen.getByRole("button", { name: "Quote settings" }));
    fireEvent.click(screen.getByLabelText(/Every section/));
    const onDashboard = currentQuoteText();
    rerender(<TopBarQuote dayKey="2026-09-26" route="reports" />);
    const onReports = currentQuoteText();
    rerender(<TopBarQuote dayKey="2026-09-26" route="journal" />);
    expect(new Set([onDashboard, onReports, currentQuoteText()]).size).toBeGreaterThan(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quotePreferences)!).rotation).toBe("navigation");
  });

  it("can be hidden and brought back from the quote button, and narrows to AXOM Originals", () => {
    render(<TopBarQuote dayKey="2026-09-26" route="dashboard" />);
    fireEvent.click(screen.getByRole("button", { name: "Quote settings" }));
    fireEvent.click(screen.getByLabelText("Show a quote in the top bar"));
    expect(document.querySelector(".tb-quote-text")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show a quote in the top bar"));
    expect(document.querySelector(".tb-quote-text")).toBeTruthy();

    // Narrow to originals only: turn off every other on-by-default category.
    for (const label of ["Discipline", "Perspective", "Ambition", "Brutal reality"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.quotePreferences)!);
    expect(saved.categories).toEqual(["axom-original"]);
    const shown = AXOM_QUOTES.find((quote) => quote.text === currentQuoteText());
    expect(shown?.category).toBe("axom-original");
  });
});
