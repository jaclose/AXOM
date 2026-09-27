// ===========================================================================
// Scoring + date logic, ported from MedicalSchoolHub.swift
// (todayGrade, noctyriumDateKey, Heatmap.color). Pure functions, no I/O —
// this replaces the macOS shell-out (dashboard_stats.sh).
// ===========================================================================
import type { StudyLog } from "./types";

export type Grade = "blue" | "green" | "orange" | "red";

/** A learner's own daily targets. A card target of 0 means "no card goal". */
export interface GradeTargets {
  minutes?: number;
  cards?: number;
}

/** The Swift source's thresholds, where 300 min / 150 cards meant "on target". */
export const DEFAULT_GRADE_TARGETS = { minutes: 300, cards: 150 } as const;

export function gradeTargetsFor(profile: { dailyMinuteTarget?: number; dailyCardTarget?: number } | undefined): GradeTargets {
  return { minutes: profile?.dailyMinuteTarget, cards: profile?.dailyCardTarget };
}

/**
 * Grade thresholds scale with the learner's own targets: on target (orange)
 * at 1×, strong (green) at 1.2× minutes / 1.67× cards, excellent (blue) at
 * 1.6× minutes / 2.33× cards. With the Swift defaults this reproduces the
 * original 300/360/480 minutes and 150/250/350 cards exactly.
 */
export function gradeThresholds(targets: GradeTargets = DEFAULT_GRADE_TARGETS) {
  const minutes = targets.minutes && targets.minutes > 0 ? targets.minutes : DEFAULT_GRADE_TARGETS.minutes;
  const cards = targets.cards === 0 ? Number.POSITIVE_INFINITY : targets.cards && targets.cards > 0 ? targets.cards : DEFAULT_GRADE_TARGETS.cards;
  return {
    blue: { minutes: minutes * 1.6, cards: (cards * 7) / 3 },
    green: { minutes: minutes * 1.2, cards: (cards * 5) / 3 },
    orange: { minutes, cards },
  };
}

/** todayGrade(minutes, cards) from the Swift source, relative to the learner's targets. */
export function todayGrade(minutes: number, cards: number, targets?: GradeTargets): Grade {
  const t = gradeThresholds(targets);
  if (minutes >= t.blue.minutes || cards >= t.blue.cards) return "blue";
  if (minutes >= t.green.minutes || cards >= t.green.cards) return "green";
  if (minutes >= t.orange.minutes || cards >= t.orange.cards) return "orange";
  return "red";
}

/** Legend rows with the learner's actual thresholds, weakest first. */
export function gradeLegend(targets?: GradeTargets): Array<{ grade: Grade; label: string }> {
  const t = gradeThresholds(targets);
  const min = (value: number) => (value >= 120 ? `${Math.round(value / 6) / 10}h` : `${Math.round(value)} min`);
  const cards = (value: number) => (Number.isFinite(value) ? ` or ${Math.round(value)} cards` : "");
  return [
    { grade: "red", label: `Below target (under ${min(t.orange.minutes)})` },
    { grade: "orange", label: `On target (${min(t.orange.minutes)}${cards(t.orange.cards)})` },
    { grade: "green", label: `Strong (${min(t.green.minutes)}${cards(t.green.cards)})` },
    { grade: "blue", label: `👑 Excellent (${min(t.blue.minutes)}${cards(t.blue.cards)})` },
  ];
}

export function gradeLabel(g: Grade): string {
  return { blue: "👑 Excellent", green: "Strong", orange: "On target", red: "Below target" }[g];
}

export function gradeColor(g: Grade): string {
  return {
    blue: "var(--grade-blue)",
    green: "var(--grade-green)",
    orange: "var(--grade-orange)",
    red: "var(--grade-red)",
  }[g];
}

/** Heatmap cell fill — mirrors Heatmap.color(minutes:cards:). Uses the
 * grade tokens (E2d) so heatmaps re-theme with light/dark like gradeColor. */
export function heatColor(minutes: number, cards: number, targets?: GradeTargets): string {
  if (minutes <= 0 && cards <= 0) return "rgba(255,255,255,0.055)";
  const grade = todayGrade(minutes, cards, targets);
  const mix = { blue: 88, green: 78, orange: 82, red: 80 }[grade];
  return `color-mix(in srgb, var(--grade-${grade}) ${mix}%, transparent)`;
}

/**
 * Legacy Axom study-day key: the calendar day shifted back 4 hours.
 * New dashboard rollover uses plain local calendar dates via isoDate().
 */
export function dayKey(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  return isoDate(shifted);
}

/** Plain calendar-day key (yyyy-MM-dd) in local time — used by the heatmap. */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return isoDate(dt);
}

/** Totals for a given study day from the log. */
export function dayTotals(logs: StudyLog[], key: string) {
  let minutes = 0;
  let cards = 0;
  for (const l of logs) {
    if (l.dayKey === key && l.academic !== false) {
      minutes += l.minutes;
      cards += l.cards;
    }
  }
  return { minutes: Math.max(0, minutes), cards: Math.max(0, cards) };
}

export function productiveTotals(logs: StudyLog[], key: string) {
  let minutes = 0;
  let cards = 0;
  for (const l of logs) {
    if (l.dayKey === key && l.productive !== false) {
      minutes += l.minutes;
      cards += l.cards;
    }
  }
  return { minutes: Math.max(0, minutes), cards: Math.max(0, cards) };
}

/** Last `n` calendar days (oldest first) for the heatmap grid. */
export function lastNDays(n: number): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

/**
 * Consecutive recent days with any logged activity, counting back from today.
 * A "don't break the chain" signal — but capped/sane, not a grind metric.
 */
export function studyStreak(logs: StudyLog[]): number {
  const active = new Set(logs.filter((l) => l.academic !== false && (l.minutes > 0 || l.cards > 0)).map((l) => l.dayKey));
  let streak = 0;
  const d = new Date();
  // allow today to be empty without breaking the streak (you may study later)
  if (!active.has(isoDate(d))) d.setDate(d.getDate() - 1);
  while (active.has(isoDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function prettyDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
