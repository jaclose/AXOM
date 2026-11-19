import type { Term, TrackerItem } from "./types";
import { normalizePrimaryScopes, type PrimaryTrackerScope } from "./trackerFocus";
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
  // Restored replacement backups may contain duplicate immutable term IDs.
  // Never rename every matching record while relocating only the first label's
  // tracker root; refuse the operation without modifying the imported data.
  const selected = terms.filter((term) => term.id === termId);
  if (selected.length === 0) return { ok: false, reason: "This term no longer exists." };
  if (selected.length !== 1) {
    return { ok: false, reason: "Duplicate term identity. Resolve the imported term IDs before renaming." };
  }
  const current = selected[0];
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

  // Historical term labels could contain "/" even though new rename inputs
  // cannot. Exact-name checks alone would let the source root swallow a nested
  // term's rows/focus, or create a target root overlapping a still-empty term.
  // Without immutable term IDs on tracker paths, keep both roots disjoint.
  const overlapsRoot = (otherKey: string, rootKey: string): boolean =>
    otherKey.startsWith(`${rootKey}/`) || rootKey.startsWith(`${otherKey}/`);
  if (terms.some((term) => term.id !== termId && (
    overlapsRoot(trackerPathKey(term.name), fromKey)
    || overlapsRoot(trackerPathKey(term.name), toKey)
  ))) {
    return { ok: false, reason: "Another term has an overlapping tracker root. Resolve term ownership before renaming." };
  }

  const belongsTo = (path: string, prefix: string): boolean => {
    const key = trackerPathKey(path);
    return key === prefix || key.startsWith(`${prefix}/`);
  };
  // The normalized membership test can match malformed historical paths
  // such as "/Term 1/Week 3", whose raw first segment is empty. Refuse these
  // rather than slicing at the wrong slash and rewriting a descendant.
  const invalidRawRoot = (path: string): boolean =>
    belongsTo(path, fromKey) && trackerPathKey(path.split("/")[0] ?? "") !== fromKey;
  if (tracker.some((item) => invalidRawRoot(item.path))
    || (primaryTrackerScopes ?? []).some((scope) => invalidRawRoot(scope.path))) {
    return { ok: false, reason: "A tracker path has an ambiguous term root. Resolve its original filing before renaming." };
  }

  // Never combine two distinct path roots, including otherwise orphaned rows
  // or pinned primary-focus paths. No silent overwrite or guessing ownership.
  if (fromKey !== toKey && (
    tracker.some((item) => belongsTo(item.path, toKey))
    || (primaryTrackerScopes ?? []).some((scope) => belongsTo(scope.path, toKey))
  )) {
    return { ok: false, reason: "The requested name already owns tracker rows or a pinned focus. No changes were made." };
  }

  const relabel = (path: string): string => {
    if (!belongsTo(path, fromKey)) return path;
    // Replace only the first raw segment. Normalizing the entire descendant
    // would silently rewrite historical module/week spelling and whitespace,
    // potentially collapsing two distinct raw paths into one.
    const slash = path.indexOf("/");
    return slash === -1 ? next : `${next}${path.slice(slash)}`;
  };

  const renamedScopes = primaryTrackerScopes?.map((scope) => belongsTo(scope.path, fromKey)
    ? { ...scope, path: relabel(scope.path) } : scope);

  // Focus is serialized and normalized during workspace hydration/import.
  // Unlike tracker rows, normalizePrimaryScopes trims the end of the path.
  // A raw historic focus ending in spaces or a slash could match its moved
  // descendants *now* but stop matching after reload, changing study ranking.
  // Preserve the original tracker path identities: reject such a rename
  // rather than canonicalizing rows or silently widening the pinned scope.
  if (renamedScopes?.some((scope, index) =>
    belongsTo(primaryTrackerScopes![index].path, fromKey)
    && normalizePrimaryScopes([scope])?.[0]?.path !== scope.path
  )) {
    return { ok: false, reason: "A pinned study focus would change after reload. Resolve its historical path before renaming." };
  }

  return {
    ok: true,
    terms: terms.map((term) => term.id === termId ? { ...term, name: next } : term),
    tracker: tracker.map((item) => belongsTo(item.path, fromKey)
      ? { ...item, path: relabel(item.path) } : item),
    primaryTrackerScopes: renamedScopes,
  };
}
