import { useCallback, useEffect, useMemo, useState } from "react";
import { AXOM_QUOTES, type AxomQuote } from "../data/quotes";
import {
  QUOTE_PREFERENCES_EVENT,
  msUntilNextSlot,
  quoteSlotKey,
  readQuotePreferences,
  selectQuoteForSlot,
  writeQuotePreferences,
  type QuotePreferences,
} from "./quotePreferences";
import { STORAGE_KEYS } from "./brand";

const NAV_COUNT_KEY = "axom.quote.navigation-count";

function readNavigationCount(): number {
  try {
    const value = Number(sessionStorage.getItem(NAV_COUNT_KEY));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * The header quote for the current rotation slot, plus the actions the quote
 * controls need. State is device-only (quote preferences + a session counter
 * for per-section rotation); no quote or workspace content is persisted.
 */
export function useQuoteRotation(dayKey: string, route: string) {
  const [preferences, setPreferences] = useState<QuotePreferences>(readQuotePreferences);
  const [now, setNow] = useState(() => new Date());
  const [navigationCount, setNavigationCount] = useState(readNavigationCount);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const sync = () => setPreferences(readQuotePreferences());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.quotePreferences) sync();
    };
    window.addEventListener(QUOTE_PREFERENCES_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(QUOTE_PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Per-section rotation: count distinct route changes for this browser session.
  const [lastRoute, setLastRoute] = useState(route);
  if (route !== lastRoute) {
    setLastRoute(route);
    const value = navigationCount + 1;
    setNavigationCount(value);
    try { sessionStorage.setItem(NAV_COUNT_KEY, String(value)); } catch { /* session-only */ }
  }

  // Time-window rotation: wake exactly when the current window ends.
  useEffect(() => {
    const wait = msUntilNextSlot(preferences.rotation, now);
    if (wait === null) return;
    const handle = window.setTimeout(() => setNow(new Date()), Math.min(wait + 250, 2_147_000_000));
    return () => window.clearTimeout(handle);
  }, [now, preferences.rotation]);

  const slotKey = quoteSlotKey(preferences.rotation, { dayKey, now, navigationCount });
  useEffect(() => { setOffset(0); }, [slotKey]);

  const quote: AxomQuote | null = useMemo(
    () => selectQuoteForSlot(AXOM_QUOTES, preferences, slotKey, offset),
    [offset, preferences, slotKey],
  );

  const save = useCallback((next: QuotePreferences) => {
    setPreferences(writeQuotePreferences(next));
  }, []);

  return {
    quote,
    preferences,
    save,
    next: () => setOffset((value) => value + 1),
    previous: () => setOffset((value) => value - 1),
    libraryCount: AXOM_QUOTES.length,
  };
}
