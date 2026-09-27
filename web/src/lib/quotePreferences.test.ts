import { describe, expect, it } from "vitest";
import { AXOM_QUOTES } from "../data/quotes";
import { STORAGE_KEYS } from "./brand";
import {
  DEFAULT_QUOTE_PREFERENCES,
  hideQuote,
  normalizeQuotePreferences,
  readQuotePreferences,
  msUntilNextSlot,
  quoteSlotKey,
  selectQuoteForDay,
  selectQuoteForSlot,
  toggleFavoriteQuote,
  writeQuotePreferences,
} from "./quotePreferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("bounded device-only quote preferences", () => {
  it("defaults guilt/shame off and selects a stable daily quote", () => {
    const first = selectQuoteForDay(AXOM_QUOTES, DEFAULT_QUOTE_PREFERENCES, "2026-07-12");
    const repeated = selectQuoteForDay(AXOM_QUOTES, DEFAULT_QUOTE_PREFERENCES, "2026-07-12");
    expect(first).toEqual(repeated);
    expect(first?.guilt).toBe(false);
    for (let offset = 0; offset < 100; offset += 1) {
      expect(selectQuoteForDay(AXOM_QUOTES, DEFAULT_QUOTE_PREFERENCES, "2026-07-12", offset)?.guilt).toBe(false);
    }
  });

  it("bounds and validates favorite/hidden ids", () => {
    const ids = Array.from({ length: 140 }, (_, index) => `quote-${String(index).padStart(3, "0")}`);
    const normalized = normalizeQuotePreferences({ favoriteQuoteIds: [...ids, "bad id", 4], hiddenQuoteIds: ids });
    // quote-000 is not a valid id; 001–139 are.
    expect(normalized.favoriteQuoteIds).toHaveLength(139);
    expect(normalized.hiddenQuoteIds).toHaveLength(139);
    expect(normalized.favoriteQuoteIds.every((id) => /^quote-\d{3}$/.test(id))).toBe(true);
    const many = Array.from({ length: 999 }, (_, index) => `quote-${String(index + 1).padStart(3, "0")}`);
    expect(normalizeQuotePreferences({ hiddenQuoteIds: many }).hiddenQuoteIds).toHaveLength(400);
  });

  it("normalizes rotation and categories, defaulting to a daily quote from every category", () => {
    expect(normalizeQuotePreferences({}).rotation).toBe("daily");
    expect(normalizeQuotePreferences({ rotation: "every-2h" }).rotation).toBe("every-2h");
    expect(normalizeQuotePreferences({ rotation: "weekly" }).rotation).toBe("daily");
    expect(normalizeQuotePreferences({ categories: ["discipline", "nope", "discipline"] }).categories).toEqual(["discipline"]);
  });

  it("derives stable rotation slots and filters by category", () => {
    const now = new Date(2026, 8, 26, 14, 30);
    expect(quoteSlotKey("daily", { dayKey: "2026-09-26", now })).toBe("2026-09-26");
    expect(quoteSlotKey("every-6h", { dayKey: "2026-09-26", now })).toBe("2026-09-26#6h-2");
    expect(quoteSlotKey("every-2h", { dayKey: "2026-09-26", now })).toBe("2026-09-26#2h-7");
    expect(quoteSlotKey("navigation", { dayKey: "2026-09-26", now, navigationCount: 3 })).toBe("2026-09-26#nav-3");
    expect(msUntilNextSlot("every-2h", now)).toBe(90 * 60_000);
    expect(msUntilNextSlot("hourly", now)).toBe(30 * 60_000);
    expect(msUntilNextSlot("navigation", now)).toBeNull();
    const originals = { ...DEFAULT_QUOTE_PREFERENCES, categories: ["axom-original" as const] };
    for (let offset = 0; offset < 20; offset += 1) {
      expect(selectQuoteForSlot(AXOM_QUOTES, originals, "slot", offset)?.category).toBe("axom-original");
    }
  });

  it("persists only bounded ids and toggles, never quote or workspace content", () => {
    const storage = memoryStorage();
    let preferences = toggleFavoriteQuote(DEFAULT_QUOTE_PREFERENCES, "quote-001");
    preferences = hideQuote(preferences, "quote-002");
    writeQuotePreferences(preferences, storage);
    const raw = storage.getItem(STORAGE_KEYS.quotePreferences)!;
    expect(readQuotePreferences(storage)).toEqual(preferences);
    expect(raw).toContain("quote-001");
    expect(raw).not.toContain(AXOM_QUOTES[0].text);
    expect(raw).not.toContain("profile");
  });

  it("never resurrects a hidden quote when every eligible quote is hidden", () => {
    const eligibleIds = AXOM_QUOTES.filter((quote) => !quote.guilt).map((quote) => quote.id);
    expect(selectQuoteForDay(AXOM_QUOTES, {
      ...DEFAULT_QUOTE_PREFERENCES,
      hiddenQuoteIds: eligibleIds,
    }, "2026-07-12")).toBeNull();
  });
});
