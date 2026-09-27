import type { PomodoroPreferences, PomodoroSavedPreset } from "./types";

export const DEFAULT_POMODORO_PREFERENCES: PomodoroPreferences = {
  autoStartBreak: true,
  autoStartFocus: false,
  savedPresets: [],
};

export function normalizePomodoroPreferences(value: unknown): PomodoroPreferences | undefined {
  if (value === undefined) return undefined;
  const record = isRecord(value) ? value : {};
  const savedPresets: PomodoroSavedPreset[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record.savedPresets)) {
    for (const item of record.savedPresets) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id.trim().slice(0, 120) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const createdAt = timestamp(item.createdAt);
      savedPresets.push({
        id,
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 60) : "Custom focus",
        focus: minutes(item.focus, 1, 180, 50),
        break: minutes(item.break, 1, 90, 10),
        longBreak: minutes(item.longBreak, 1, 120, 25),
        cyclesBeforeLongBreak: minutes(item.cyclesBeforeLongBreak, 1, 12, 4),
        intention: typeof item.intention === "string" && item.intention.trim() ? item.intention.trim().slice(0, 240) : undefined,
        createdAt,
        updatedAt: timestamp(item.updatedAt, createdAt),
        useCount: Math.max(0, Math.floor(finite(item.useCount))),
        lastUsedAt: validTimestamp(item.lastUsedAt),
      });
    }
  }
  return {
    autoStartBreak: record.autoStartBreak !== false,
    autoStartFocus: record.autoStartFocus === true,
    savedPresets,
    // Only an explicit choice is stored; unset keeps the default (on).
    ...(typeof record.showInMenuBar === "boolean" ? { showInMenuBar: record.showInMenuBar } : {}),
  };
}

export function effectivePomodoroPreferences(value: unknown): PomodoroPreferences {
  return normalizePomodoroPreferences(value) ?? { ...DEFAULT_POMODORO_PREFERENCES, savedPresets: [] };
}

function minutes(value: unknown, min: number, max: number, fallback: number) {
  const number = finite(value) || fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function timestamp(value: unknown, fallback = new Date().toISOString()): string {
  return validTimestamp(value) ?? fallback;
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
