import { makeDailyRequirement } from "./dailySuccess";
import { localDateKey } from "./dailyRollover";
import type { DailySuccessConfig, DailySuccessRequirement, DailySuccessSchedule, Habit } from "./types";

/**
 * Keeps Habit Tracker and Productivity "Today's targets" in step: a habit can
 * count as a daily target through a requirement whose source is the habit.
 * Checking the habit then fills the target automatically — there is one
 * source of truth (the habit entries), never a second completion ledger.
 */
export function habitTargetId(habitId: string): string {
  return `daily-habit-${habitId}`;
}

export function linkedRequirement(config: DailySuccessConfig | undefined, habitId: string): DailySuccessRequirement | undefined {
  return config?.requirements.find((requirement) => requirement.source.kind === "habit" && requirement.source.habitId === habitId);
}

export function habitSchedule(habit: Habit): DailySuccessSchedule {
  if (habit.type === "weekly") return { kind: "times-per-week", times: Math.max(1, habit.weeklyTarget ?? 3) };
  if (habit.type === "scheduled" && habit.schedule?.length) return { kind: "weekdays", weekdays: [...habit.schedule] };
  return { kind: "daily" };
}

/** Add (or re-enable) the habit as a daily target. Idempotent. */
export function linkHabitToTargets(config: DailySuccessConfig | undefined, habit: Habit, today: string = localDateKey()): DailySuccessConfig {
  const base: DailySuccessConfig = config ?? { version: 1, configuredAt: today, requirements: [] };
  const existing = linkedRequirement(base, habit.id);
  if (existing) {
    return {
      ...base,
      requirements: base.requirements.map((requirement) => requirement === existing
        ? { ...requirement, enabled: true, label: habit.name, updatedAt: new Date().toISOString() }
        : requirement),
    };
  }
  const target = habit.type === "count" || habit.type === "duration" ? Math.max(1, habit.target ?? 1) : 1;
  const requirement = makeDailyRequirement({
    id: habitTargetId(habit.id),
    label: habit.name,
    source: { kind: "habit", habitId: habit.id },
    target,
    unit: habit.type === "count" || habit.type === "duration" ? habit.unit?.trim() || "times" : "check-in",
    schedule: habitSchedule(habit),
    trackingStartsAt: today,
  }, today);
  return { ...base, requirements: [...base.requirements, requirement] };
}

/** Stop counting the habit as a target. The habit and its history stay. */
export function unlinkHabitFromTargets(config: DailySuccessConfig | undefined, habitId: string): DailySuccessConfig | undefined {
  if (!config) return config;
  return {
    ...config,
    requirements: config.requirements.filter((requirement) => !(requirement.source.kind === "habit" && requirement.source.habitId === habitId)),
  };
}

/** Keep a linked target's label in step when the habit is renamed. */
export function syncHabitTargetLabel(config: DailySuccessConfig | undefined, habit: Habit): DailySuccessConfig | undefined {
  const existing = linkedRequirement(config, habit.id);
  if (!config || !existing || existing.label === habit.name) return config;
  return {
    ...config,
    requirements: config.requirements.map((requirement) => requirement === existing ? { ...requirement, label: habit.name } : requirement),
  };
}
