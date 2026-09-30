import { useEffect, useRef, useState } from "react";

export interface ExitingEntry<T> {
  item: T;
  leaving: boolean;
}

/**
 * Keeps items that disappear from `items` rendered, in place, for `exitMs`
 * so they can animate out. The source list stays authoritative: stores can
 * remove immediately (dedupe, tests, logic) while the view lets them go gently.
 * With `exitMs` 0 (reduced motion) removal is immediate.
 */
export function useExitingList<T>(items: T[], keyOf: (item: T) => string, exitMs: number): ExitingEntry<T>[] {
  const [entries, setEntries] = useState<ExitingEntry<T>[]>(() => items.map((item) => ({ item, leaving: false })));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setEntries((previous) => {
      const present = new Map(items.map((item) => [keyOf(item), item]));
      const kept: ExitingEntry<T>[] = [];
      for (const entry of previous) {
        const key = keyOf(entry.item);
        const current = present.get(key);
        if (current) kept.push({ item: current, leaving: false });
        else if (exitMs > 0) kept.push({ item: entry.item, leaving: true });
      }
      const known = new Set(kept.map((entry) => keyOf(entry.item)));
      for (const item of items) if (!known.has(keyOf(item))) kept.push({ item, leaving: false });
      return kept;
    });
  }, [items, keyOf, exitMs]);

  useEffect(() => {
    for (const entry of entries) {
      const key = keyOf(entry.item);
      if (!entry.leaving || timers.current.has(key)) continue;
      timers.current.set(key, setTimeout(() => {
        timers.current.delete(key);
        setEntries((current) => current.filter((candidate) => !(candidate.leaving && keyOf(candidate.item) === key)));
      }, exitMs));
    }
  }, [entries, keyOf, exitMs]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  return entries;
}
