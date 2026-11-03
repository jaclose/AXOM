import type { BlueprintMode } from "./types";

// Portable import and store hydration must validate these fields identically.
export function normalizeUnlocks(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z0-9-]{1,40}$/.test(item)))].slice(0, 50)
    : undefined;
}

export function normalizeBlueprintMode(value: unknown): BlueprintMode | undefined {
  return value === "usmle" || value === "prehealth" ? value : undefined;
}
