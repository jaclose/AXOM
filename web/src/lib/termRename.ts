import type { Term, TrackerItem } from "./types";
import type { PrimaryTrackerScope } from "./trackerFocus";
import { normalizeTrackerPath, trackerPathKey } from "./pathUtils";

export type TermRenamePlan =
  | { ok: true; terms: Term[]; tracker: TrackerItem[]; primaryTrackerScopes: PrimaryTrackerScope[] | undefined }
  | { ok: false; reason: string };

/**
 * Plan a user-initiated term rename without changing any learner activity.
 *
 * Legacy tracker paths have no term ID, so moving rows by label is safe only
 * when that label uniquely identifies one term. Reject ambiguous or occupied
 * destination roots rather than orphaning attendance or merging two terms.
 * The caller commits the three returned collections in ONE state update.
 */
export function planTermRename(
  terms: readonly Term[],
  tracker: readonly TrackerItem[],
  primaryTrackerScopes: readonly PrimaryTrackerScope[] | undefined,
  termId: string,
  requestedName: string,
): TermRenamePlan {
  const current = terms.find((term) => term.id === termId);
  if (!current) return { ok: false, reason: "This term no longer exists." };
  if (typeof requestedName !== "string" || requestedName.includes("/")) {
    return { ok: false, reason: "Use a term name without path separators." };
  }
  const next = requestedName.trim().replace(/\s+/g, " ");
  const old = normalizeTrackerPath(current.name);
  if (!next || !old || old.includes("/")) {
    return { ok: false, reason: "This term name cannot be safely mapped to tracker paths." };
  }

  const fromKey = trackerPathKey(old);
  const toKey = trackerPathKey(next);
  if (terms.some((term) => term.id !== termId && trackerPathKey(term.name) === fromKey)) {
    return { ok: false, reason: "Two terms share the old name. Resolve the ownership of their tracker rows first." };
  }
  if (terms.some((term) => term.id !== termId && trackerPathKey(term.name) === toKey)) {
    return { ok: false, reason: "Another term already has that name." };
  }

  const belongsTo = (path: string, prefix: string): boolean => {
    const key = trackerPathKey(path);
    return key === prefix || key.startsWith(`${prefix}/`);
  };
  // Never combine two distinct path roots, including otherwise orphaned rows
  // or pinned primary-focus paths. No silent overwrite or guessing ownership.
  if (fromKey !== toKey && (
    tracker.some((item) => belongsTo(item.path, toKey))
    || (primaryTrackerScopes ?? []).some((scope) => belongsTo(scope.path, toKey))
  )) {
    return { ok: false, reason: "The requested name already owns tracker rows or a pinned focus. No changes were made." };
  }

  const relabel = (path: string): string => {
    const clean = normalizeTrackerPath(path);
    if (!belongsTo(clean, fromKey)) return path;
    const first = clean.split("/")[0];
    return `${next}${clean.slice(first.length)}`;
  };

  return {
    ok: true,
    terms: terms.map((term) => term.id === termId ? { ...term, name: next } : term),
    tracker: tracker.map((item) => belongsTo(item.path, fromKey)
      ? { ...item, path: relabel(item.path) } : item),
    primaryTrackerScopes: primaryTrackerScopes?.map((scope) => belongsTo(scope.path, fromKey)
      ? { ...scope, path: relabel(scope.path) } : scope),
  };
}
