import { useSyncExternalStore } from "react";
import { createDeviceStore } from "./deviceStore";
import type { AnkiCourseScope, PremadeScopeLink } from "./termLinks";

const KEY = "axom-anki-scope-links.v1";

export function ankiScopeKey(scope: AnkiCourseScope): string {
  return [scope.termId, scope.kind === "term" ? "" : scope.courseId, scope.kind === "term" ? "" : scope.moduleId,
    scope.kind === "week" ? String(scope.week) : ""].join("/");
}

function normalizeScope(raw: unknown): AnkiCourseScope | null {
  if (!raw || typeof raw !== "object") return null;
  const scope = raw as Record<string, unknown>;
  if (typeof scope.termId !== "string" || !scope.termId) return null;
  if (scope.kind === "term") return { kind: "term", termId: scope.termId };
  if ((scope.kind !== "module" && scope.kind !== "week") ||
      typeof scope.courseId !== "string" || !scope.courseId ||
      typeof scope.moduleId !== "string" || !scope.moduleId) return null;
  if (scope.kind === "module") return { kind: "module", termId: scope.termId, courseId: scope.courseId, moduleId: scope.moduleId };
  if (!Number.isSafeInteger(scope.week) || Number(scope.week) < 1) return null;
  return { kind: "week", termId: scope.termId, courseId: scope.courseId, moduleId: scope.moduleId, week: Number(scope.week) };
}

function normalize(raw: unknown): PremadeScopeLink[] {
  if (!Array.isArray(raw)) return [];
  const links = new Map<string, PremadeScopeLink>();
  for (const item of raw.slice(0, 250)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const scope = normalizeScope(record.scope);
    if (!scope || typeof record.deckName !== "string" || typeof record.tag !== "string") continue;
    const deckName = record.deckName.trim().slice(0, 200);
    const tag = record.tag.trim().slice(0, 200);
    if (!deckName || !tag || /\s/.test(tag)) continue;
    links.set(ankiScopeKey(scope), { scope, deckName, tag });
  }
  return [...links.values()];
}

export const termLinkStore = createDeviceStore(KEY, normalize, () => [] as PremadeScopeLink[]);

export function useTermLinks(): PremadeScopeLink[] {
  return useSyncExternalStore(termLinkStore.subscribe, termLinkStore.get, termLinkStore.get);
}

export function saveTermLink(link: PremadeScopeLink): void {
  termLinkStore.update((current) => normalize([...current.filter((item) => ankiScopeKey(item.scope) !== ankiScopeKey(link.scope)), link]));
}

export function removeTermLink(scope: AnkiCourseScope): void {
  termLinkStore.update((current) => current.filter((item) => ankiScopeKey(item.scope) !== ankiScopeKey(scope)));
}
