import { AXOM_ORIGINALS_V3, type AxomQuote, type QuoteCategory } from "../data/quotes";
import { STORAGE_KEYS } from "./brand";

/**
 * How often the header quote changes:
 * - daily: one quote per local day (the original behavior)
 * - every-6h / every-2h / hourly: a new quote per time window
 * - navigation: a new quote each time you open a different section
 */
export type QuoteRotation = "daily" | "every-6h" | "every-2h" | "hourly" | "navigation";

export const QUOTE_ROTATIONS: ReadonlyArray<{ id: QuoteRotation; label: string; detail: string }> = [
  { id: "daily", label: "Once a day", detail: "One quote carries the whole day" },
  { id: "every-6h", label: "Every 6 hours", detail: "Morning, afternoon, evening, night" },
  { id: "every-2h", label: "Every 2 hours", detail: "A fresh line for each study block" },
  { id: "hourly", label: "Every hour", detail: "Changes on the hour" },
  { id: "navigation", label: "Every section", detail: "Changes when you open another page" },
];

export const QUOTE_CATEGORIES: readonly QuoteCategory[] = [
  "axom-original",
  "discipline",
  "perspective",
  "success-ambition",
  "brutal-reality",
  "shame-guilt",
];

export interface QuotePreferences {
  version: 1;
  quoteVisible: boolean;
  includeGuilt: boolean;
  favoriteQuoteIds: string[];
  hiddenQuoteIds: string[];
  /** How often the quote changes. */
  rotation: QuoteRotation;
  /** Categories to draw from; empty means every category (guilt still gated). */
  categories: QuoteCategory[];
  /** Favor favorites: roughly every other rotation shows a favorite. */
  favoritesFirst: boolean;
}

export const DEFAULT_QUOTE_PREFERENCES: QuotePreferences = {
  version: 1,
  quoteVisible: true,
  includeGuilt: false,
  favoriteQuoteIds: [],
  hiddenQuoteIds: [],
  rotation: "daily",
  categories: [],
  favoritesFirst: false,
};

/** Upper bound on stored ids per list; keeps the device entry small. */
const MAX_STORED_IDS = 400;
const MAX_QUOTE_NUMBER = 999;
const ROTATION_IDS = new Set<QuoteRotation>(QUOTE_ROTATIONS.map((rotation) => rotation.id));
const CATEGORY_IDS = new Set<QuoteCategory>(QUOTE_CATEGORIES);
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export const QUOTE_PREFERENCES_EVENT = "axom:quote-preferences";

function browserStorage(): PreferenceStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

function quoteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => validQuoteId(item)))]
    .slice(-MAX_STORED_IDS);
}

function validQuoteId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (AXOM_ORIGINALS_V3.some((quote) => quote.id === value)) return true;
  const match = value.match(/^quote-(\d{3})$/);
  if (!match) return false;
  const number = Number(match[1]);
  return number >= 1 && number <= MAX_QUOTE_NUMBER;
}

export function normalizeQuotePreferences(value: unknown): QuotePreferences {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const categories = Array.isArray(record.categories)
    ? [...new Set(record.categories.filter((item): item is QuoteCategory => CATEGORY_IDS.has(item as QuoteCategory)))]
    : [];
  return {
    version: 1,
    quoteVisible: typeof record.quoteVisible === "boolean" ? record.quoteVisible : true,
    includeGuilt: record.includeGuilt === true,
    favoriteQuoteIds: quoteIds(record.favoriteQuoteIds),
    hiddenQuoteIds: quoteIds(record.hiddenQuoteIds),
    rotation: ROTATION_IDS.has(record.rotation as QuoteRotation) ? record.rotation as QuoteRotation : "daily",
    categories,
    favoritesFirst: record.favoritesFirst === true,
  };
}

export function readQuotePreferences(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): QuotePreferences {
  if (!storage) return { ...DEFAULT_QUOTE_PREFERENCES };
  try {
    return normalizeQuotePreferences(JSON.parse(storage.getItem(STORAGE_KEYS.quotePreferences) ?? "null"));
  } catch {
    return { ...DEFAULT_QUOTE_PREFERENCES };
  }
}

export function writeQuotePreferences(
  value: QuotePreferences,
  storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): QuotePreferences {
  const normalized = normalizeQuotePreferences(value);
  try { storage?.setItem(STORAGE_KEYS.quotePreferences, JSON.stringify(normalized)); } catch { /* device preference is best effort */ }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUOTE_PREFERENCES_EVENT));
  }
  return normalized;
}

export function eligibleQuotes(quotes: readonly AxomQuote[], preferences: QuotePreferences): AxomQuote[] {
  const hidden = new Set(preferences.hiddenQuoteIds);
  const categories = new Set(preferences.categories);
  return quotes.filter((quote) => (
    !hidden.has(quote.id)
    && (preferences.includeGuilt || !quote.guilt)
    && (categories.size === 0 || categories.has(quote.category))
  ));
}

export function selectQuoteForDay(
  quotes: readonly AxomQuote[],
  preferences: QuotePreferences,
  dayKey: string,
  offset = 0,
): AxomQuote | null {
  return selectQuoteForSlot(quotes, preferences, dayKey, offset);
}

/**
 * Deterministic selection for a rotation slot. The same slot always shows the
 * same quote (stable across reloads and tabs); `offset` walks forward for the
 * manual "next quote" control.
 */
export function selectQuoteForSlot(
  quotes: readonly AxomQuote[],
  preferences: QuotePreferences,
  slotKey: string,
  offset = 0,
): AxomQuote | null {
  const eligible = eligibleQuotes(quotes, preferences);
  if (!eligible.length) return null;
  const hash = fnv1a32(slotKey);
  if (preferences.favoritesFirst && offset === 0) {
    const favorites = new Set(preferences.favoriteQuoteIds);
    const pool = eligible.filter((quote) => favorites.has(quote.id));
    if (pool.length && hash % 2 === 0) return pool[(hash >>> 1) % pool.length];
  }
  const start = hash % eligible.length;
  const index = ((start + Math.trunc(offset)) % eligible.length + eligible.length) % eligible.length;
  return eligible[index];
}

/**
 * The rotation slot for a moment in time. `dayKey` is the device-local study
 * day; `navigationCount` is only used by the per-section rotation.
 */
export function quoteSlotKey(
  rotation: QuoteRotation,
  input: { dayKey: string; now: Date; navigationCount?: number },
): string {
  const hour = input.now.getHours();
  if (rotation === "every-6h") return `${input.dayKey}#6h-${Math.floor(hour / 6)}`;
  if (rotation === "every-2h") return `${input.dayKey}#2h-${Math.floor(hour / 2)}`;
  if (rotation === "hourly") return `${input.dayKey}#h-${hour}`;
  if (rotation === "navigation") return `${input.dayKey}#nav-${Math.max(0, Math.trunc(input.navigationCount ?? 0))}`;
  return input.dayKey;
}

/** Milliseconds until the current rotation window ends (never below 1s). */
export function msUntilNextSlot(rotation: QuoteRotation, now: Date): number | null {
  const size = rotation === "every-6h" ? 6 : rotation === "every-2h" ? 2 : rotation === "hourly" ? 1 : rotation === "daily" ? 24 : 0;
  if (!size) return null;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(Math.floor(now.getHours() / size) * size + size);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function toggleFavoriteQuote(preferences: QuotePreferences, quoteId: string): QuotePreferences {
  const current = new Set(preferences.favoriteQuoteIds);
  if (current.has(quoteId)) current.delete(quoteId);
  else current.add(quoteId);
  return normalizeQuotePreferences({ ...preferences, favoriteQuoteIds: [...current] });
}

export function hideQuote(preferences: QuotePreferences, quoteId: string): QuotePreferences {
  return normalizeQuotePreferences({
    ...preferences,
    hiddenQuoteIds: [...preferences.hiddenQuoteIds, quoteId],
    favoriteQuoteIds: preferences.favoriteQuoteIds.filter((id) => id !== quoteId),
  });
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
