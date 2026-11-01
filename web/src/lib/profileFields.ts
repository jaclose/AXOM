import type { BlueprintMode } from "./types";

// Profile fields validated the same way by the store and by portable import
// (backup.ts parseImport, which every restore and account pull goes through).

/** Easter-egg ids (see unlocks.ts): short lowercase slugs, de-duplicated. */
export function normalizeUnlocks(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z0-9-]{1,40}$/.test(item)))].slice(0, 50)
    : undefined;
}

export function normalizeBlueprintMode(value: unknown): BlueprintMode | undefined {
  return value === "usmle" || value === "prehealth" ? value : undefined;
}
