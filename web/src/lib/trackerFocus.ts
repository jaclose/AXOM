// ===========================================================================
// Primary focus for the Course Tracker: the subsections you are working on
// now ("Term 2/NB3/Renal", "Step 1/Cardio"). Primary scopes are pinned in the
// tree, become the default view, and lift their items in every recommendation
// (Course Tracker suggestions, Command Brief, Dashboard). An optional "until"
// date retires a focus automatically after the exam it serves.
// ===========================================================================
import type { TrackerItem } from "./types";

export interface PrimaryTrackerScope {
  path: string;
  since: string;
  /** Local date (yyyy-MM-dd). The focus stops counting after this day. */
  until?: string;
}

/** Score added to an item inside a primary scope (see recommendationFactors). */
export const PRIMARY_FOCUS_BOOST = 20;

export function normalizePrimaryScopes(value: unknown): PrimaryTrackerScope[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: PrimaryTrackerScope[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim().replace(/\/+$/, "") : "";
    if (!path || seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    out.push({
      path,
      since: typeof record.since === "string" ? record.since : new Date().toISOString(),
      until: typeof record.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.until) ? record.until : undefined,
    });
  }
  return out.slice(0, 12);
}

/** Scopes still in force on `today` (local yyyy-MM-dd). */
export function activePrimaryScopes(scopes: readonly PrimaryTrackerScope[] | undefined, today: string): PrimaryTrackerScope[] {
  return (scopes ?? []).filter((scope) => !scope.until || scope.until >= today);
}

export function activePrimaryPaths(scopes: readonly PrimaryTrackerScope[] | undefined, today: string): string[] {
  return activePrimaryScopes(scopes, today).map((scope) => scope.path);
}

export function pathInScopes(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

export function itemsInPrimary(items: readonly TrackerItem[], scopes: readonly string[]): TrackerItem[] {
  return scopes.length ? items.filter((item) => pathInScopes(item.path, scopes)) : [];
}

export function isPrimaryPath(scopes: readonly PrimaryTrackerScope[] | undefined, path: string): boolean {
  return (scopes ?? []).some((scope) => scope.path === path);
}

export function togglePrimaryScope(scopes: readonly PrimaryTrackerScope[] | undefined, path: string, now = new Date()): PrimaryTrackerScope[] {
  const list = scopes ?? [];
  if (isPrimaryPath(list, path)) return list.filter((scope) => scope.path !== path);
  // A new focus replaces any narrower or broader overlap so scopes never double-count.
  const kept = list.filter((scope) => !pathInScopes(scope.path, [path]) && !pathInScopes(path, [scope.path]));
  return [...kept, { path, since: now.toISOString() }].slice(-12);
}

export function setPrimaryUntil(scopes: readonly PrimaryTrackerScope[] | undefined, path: string, until: string | undefined): PrimaryTrackerScope[] {
  return (scopes ?? []).map((scope) => (scope.path === path ? { ...scope, until: until || undefined } : scope));
}

/** Rename-safe: follow a tracker scope rename. */
export function renamePrimaryScopes(scopes: readonly PrimaryTrackerScope[] | undefined, from: string, to: string): PrimaryTrackerScope[] | undefined {
  if (!scopes) return scopes;
  return scopes.map((scope) => (scope.path === from || scope.path.startsWith(`${from}/`) ? { ...scope, path: to + scope.path.slice(from.length) } : scope));
}
