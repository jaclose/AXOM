// ===========================================================================
// Energy & focus insights — measured, not assumed.
//
// Every number here comes from something the learner actually recorded:
// one-tap energy checks, journal energy, closeout energy, energy after a
// study session, study minutes, question attempts, rests and trackers.
// Nothing starts from an invented baseline. Comparisons carry their sample
// sizes and stay silent until there is enough data to mean anything.
// ===========================================================================
import type { DailyCloseout } from "./closeout";
import type { StudySession } from "./sessions";
import type { EnergyFactor, JournalEntry, ProductivityTracker, StudyLog } from "./types";

export interface EnergyCheck {
  at: string;
  /** 0–100 */
  score: number;
  /** An optional line from the check-in's writing prompt (Ideas 4). */
  note?: string;
}

export type EnergySampleSource = "check" | "journal" | "closeout" | "session";

export interface EnergySample {
  at: string;
  day: string;
  hour: number;
  score: number;
  source: EnergySampleSource;
}

export interface EnergyInputs {
  energyChecks?: EnergyCheck[];
  journal?: JournalEntry[];
  closeouts?: DailyCloseout[];
  sessions?: StudySession[];
  logs?: StudyLog[];
  attempts?: Array<{ at: string; status: string }>;
  energyFactors?: EnergyFactor[];
  productivityTrackers?: ProductivityTracker[];
  /** Device ledgers (optional): rests and soundscape listening. */
  rests?: Array<{ startedAt: string }>;
  listening?: Array<{ start: string }>;
}

/** One-tap levels, each mapped onto the shared 0–100 energy scale. */
export const ENERGY_LEVELS = [
  { score: 15, label: "Drained" },
  { score: 35, label: "Low" },
  { score: 55, label: "Okay" },
  { score: 75, label: "Good" },
  { score: 92, label: "Sharp" },
] as const;

const LABEL_SCORE: Record<string, number> = { Low: 30, Medium: 58, High: 85 };
/** Minimum days in each group before a driver comparison is shown. */
export const MIN_DRIVER_DAYS = 3;
/** Minimum samples in an hour band before its average is shown. */
export const MIN_HOUR_SAMPLES = 2;

export function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sample(at: string | undefined, score: number, source: EnergySampleSource): EnergySample | null {
  if (!at || !Number.isFinite(Date.parse(at)) || !Number.isFinite(score)) return null;
  return { at, day: localDay(at), hour: new Date(at).getHours(), score: Math.max(0, Math.min(100, score)), source };
}

/** Every self-reported energy observation, oldest first. */
export function collectEnergySamples(input: EnergyInputs): EnergySample[] {
  const samples: Array<EnergySample | null> = [];
  for (const check of input.energyChecks ?? []) samples.push(sample(check.at, check.score, "check"));
  for (const entry of input.journal ?? []) {
    if (!entry.energy || !(entry.energy in LABEL_SCORE)) continue;
    const at = (entry as { updatedAt?: string }).updatedAt ?? entry.date;
    samples.push(sample(at, LABEL_SCORE[entry.energy], "journal"));
  }
  for (const closeout of input.closeouts ?? []) {
    if (typeof closeout.energyNow === "number") samples.push(sample(closeout.updatedAt ?? closeout.createdAt, closeout.energyNow, "closeout"));
  }
  for (const session of input.sessions ?? []) {
    const label = session.capture?.energyAfter;
    if (label && session.endedAt) samples.push(sample(session.endedAt, LABEL_SCORE[label], "session"));
  }
  return samples.filter((item): item is EnergySample => Boolean(item)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function withinDays(iso: string, now: Date, days: number): boolean {
  const time = Date.parse(iso);
  return time <= now.getTime() && now.getTime() - time <= days * 86_400_000;
}

export interface HourBand {
  label: string;
  startHour: number;
  endHour: number;
  energy: number | null;
  energySamples: number;
  minutes: number;
  answered: number;
  accuracy: number | null;
}

// A student's day runs 5 AM to 5 AM: late-night work (00:00-04:59) is its own
// band at the end instead of being dropped (JD, Ideas 3: "some people stay up").
const BANDS: Array<[string, number, number]> = [
  ["Early morning", 5, 8], ["Morning", 8, 11], ["Midday", 11, 14], ["Afternoon", 14, 17], ["Evening", 17, 20], ["Night", 20, 24], ["Late night", 0, 5],
];

/** Energy, study minutes and question accuracy across the day (last N days). */
export function dayRhythm(input: EnergyInputs, now = new Date(), days = 30): HourBand[] {
  const samples = collectEnergySamples(input).filter((item) => withinDays(item.at, now, days));
  const logs = (input.logs ?? []).filter((log) => log.academic !== false && withinDays(log.ts, now, days));
  const attempts = (input.attempts ?? []).filter((attempt) => withinDays(attempt.at, now, days) && ["correct", "incorrect", "guessed"].includes(attempt.status));
  return BANDS.map(([label, startHour, endHour]) => {
    const inBand = (iso: string) => { const hour = new Date(iso).getHours(); return hour >= startHour && hour < endHour; };
    const bandSamples = samples.filter((item) => item.hour >= startHour && item.hour < endHour);
    const bandAttempts = attempts.filter((attempt) => inBand(attempt.at));
    const correct = bandAttempts.filter((attempt) => attempt.status === "correct").length;
    return {
      label, startHour, endHour,
      energy: bandSamples.length >= MIN_HOUR_SAMPLES ? Math.round(bandSamples.reduce((sum, item) => sum + item.score, 0) / bandSamples.length) : null,
      energySamples: bandSamples.length,
      minutes: Math.round(logs.filter((log) => inBand(log.ts)).reduce((sum, log) => sum + Math.max(0, log.minutes), 0)),
      answered: bandAttempts.length,
      accuracy: bandAttempts.length >= 10 ? Math.round((correct / bandAttempts.length) * 100) : null,
    };
  });
}

/** The band where the learner is sharpest, if the data supports naming one. */
export function peakWindow(rhythm: HourBand[]): { band: HourBand; basis: "accuracy" | "energy" } | null {
  const byAccuracy = rhythm.filter((band) => band.accuracy !== null);
  if (byAccuracy.length >= 2) {
    const best = [...byAccuracy].sort((a, b) => (b.accuracy! - a.accuracy!) || (b.answered - a.answered))[0];
    return { band: best, basis: "accuracy" };
  }
  const byEnergy = rhythm.filter((band) => band.energy !== null);
  if (byEnergy.length >= 2) return { band: [...byEnergy].sort((a, b) => b.energy! - a.energy!)[0], basis: "energy" };
  return null;
}

export interface EnergyDriver {
  id: string;
  label: string;
  withAverage: number;
  withoutAverage: number;
  withDays: number;
  withoutDays: number;
  /** withAverage − withoutAverage, in energy points (0–100 scale). */
  difference: number;
}

/** Average self-reported energy per day. */
export function dailyEnergy(samples: EnergySample[]): Map<string, number> {
  const byDay = new Map<string, number[]>();
  for (const item of samples) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item.score]);
  return new Map([...byDay].map(([day, scores]) => [day, scores.reduce((sum, score) => sum + score, 0) / scores.length]));
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return localDay(date.toISOString());
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Observational comparisons: energy on days with vs without a candidate
 * driver. Each needs MIN_DRIVER_DAYS days on both sides; strongest first.
 */
export function energyDrivers(input: EnergyInputs, now = new Date(), days = 60): EnergyDriver[] {
  const energy = dailyEnergy(collectEnergySamples(input).filter((item) => withinDays(item.at, now, days)));
  if (energy.size < MIN_DRIVER_DAYS * 2) return [];
  const minutesByDay = new Map<string, number>();
  for (const log of input.logs ?? []) {
    if (log.academic === false) continue;
    minutesByDay.set(log.dayKey, (minutesByDay.get(log.dayKey) ?? 0) + Math.max(0, log.minutes));
  }
  const typical = median([...minutesByDay.values()].filter((value) => value > 0));
  const trackers = (input.productivityTrackers ?? []).filter((tracker) => tracker.contributesToEnergy && !tracker.archived);
  const trackerDays = new Map<string, Set<string>>();
  for (const log of input.logs ?? []) {
    if (!log.trackerId) continue;
    const set = trackerDays.get(log.trackerId) ?? new Set<string>();
    set.add(log.dayKey);
    trackerDays.set(log.trackerId, set);
  }
  const daySet = (values: Iterable<string>) => new Set(values);
  const candidates: Array<{ id: string; label: string; has: (day: string) => boolean }> = [
    ...trackers.map((tracker) => ({ id: `tracker:${tracker.id}`, label: `Logged ${tracker.name}`, has: (day: string) => trackerDays.get(tracker.id)?.has(day) ?? false })),
    (() => { const set = daySet((input.rests ?? []).map((rest) => localDay(rest.startedAt))); return { id: "rest", label: "Took a rest", has: (day: string) => set.has(day) }; })(),
    (() => { const set = daySet((input.listening ?? []).map((item) => localDay(item.start))); return { id: "soundscape", label: "Used a soundscape", has: (day: string) => set.has(day) }; })(),
    { id: "heavy-yesterday", label: "Heavy study the day before", has: (day: string) => typical > 0 && (minutesByDay.get(previousDay(day)) ?? 0) > typical * 1.4 },
    (() => {
      const good = daySet((input.energyFactors ?? []).filter((factor) => factor.userConfirmed && factor.category === "sleep" && factor.delta > 0).map((factor) => factor.date));
      return { id: "sleep", label: "Logged good sleep", has: (day: string) => good.has(day) };
    })(),
  ];
  const drivers: EnergyDriver[] = [];
  for (const candidate of candidates) {
    const withScores: number[] = [];
    const withoutScores: number[] = [];
    for (const [day, score] of energy) (candidate.has(day) ? withScores : withoutScores).push(score);
    if (withScores.length < MIN_DRIVER_DAYS || withoutScores.length < MIN_DRIVER_DAYS) continue;
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const withAverage = Math.round(average(withScores));
    const withoutAverage = Math.round(average(withoutScores));
    drivers.push({ id: candidate.id, label: candidate.label, withAverage, withoutAverage, withDays: withScores.length, withoutDays: withoutScores.length, difference: withAverage - withoutAverage });
  }
  return drivers.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export type CapacityLevel = "lighter" | "typical" | "strong";

export interface Capacity {
  level: CapacityLevel;
  label: string;
  reasons: string[];
  /** Median academic minutes on active days (last 14 active days). */
  typicalMinutes: number;
  suggestedMinutes: number;
  latestEnergy?: EnergySample;
  hasEvidence: boolean;
}

/**
 * Today's capacity from three explainable signals: today's latest energy vs
 * the learner's own average, yesterday's load vs their typical day, and any
 * sleep logged for today. With none of them, it says so instead of guessing.
 */
export function todaysCapacity(input: EnergyInputs, today: string, now = new Date()): Capacity {
  const samples = collectEnergySamples(input);
  const recent = samples.filter((item) => withinDays(item.at, now, 30) && item.day !== today);
  const personal = recent.length >= 3 ? recent.reduce((sum, item) => sum + item.score, 0) / recent.length : null;
  const latestToday = [...samples].reverse().find((item) => item.day === today);
  const minutesByDay = new Map<string, number>();
  for (const log of input.logs ?? []) {
    if (log.academic === false) continue;
    minutesByDay.set(log.dayKey, (minutesByDay.get(log.dayKey) ?? 0) + Math.max(0, log.minutes));
  }
  const activeDays = [...minutesByDay.entries()].filter(([day, minutes]) => day < today && minutes > 0).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  const typicalMinutes = Math.round(median(activeDays.map(([, minutes]) => minutes)));
  const yesterday = minutesByDay.get(previousDay(today)) ?? 0;
  const sleepToday = (input.energyFactors ?? []).find((factor) => factor.userConfirmed && factor.category === "sleep" && factor.date === today);

  let score = 0;
  const reasons: string[] = [];
  if (latestToday && personal !== null) {
    const gap = latestToday.score - personal;
    score += gap / 15;
    reasons.push(gap >= 8 ? "Your energy check today is above your usual" : gap <= -8 ? "Your energy check today is below your usual" : "Your energy today is about your usual");
  } else if (latestToday) {
    // No personal history yet: only the clear ends of the scale count.
    score += latestToday.score >= 80 ? 1 : latestToday.score <= 35 ? -1 : 0;
    reasons.push(latestToday.score >= 80 ? "You feel sharp today" : latestToday.score <= 35 ? "You feel low today" : "Energy logged; a few more days of checks will show what is usual for you");
  }
  if (typicalMinutes > 0 && yesterday > typicalMinutes * 1.4) {
    score -= 1;
    reasons.push(`Yesterday ran long (${yesterday} min vs a typical ${typicalMinutes})`);
  } else if (typicalMinutes > 0 && yesterday > 0 && yesterday < typicalMinutes * 0.5) {
    score += 0.4;
    reasons.push("Yesterday was light, so you may have more in the tank");
  }
  if (sleepToday) {
    score += sleepToday.delta > 0 ? 0.6 : -1;
    reasons.push(sleepToday.delta > 0 ? "You logged good sleep" : "You logged poor sleep");
  }
  const hasEvidence = Boolean(latestToday || sleepToday || (typicalMinutes > 0 && yesterday > 0));
  const level: CapacityLevel = !hasEvidence ? "typical" : score <= -0.9 ? "lighter" : score >= 0.9 ? "strong" : "typical";
  const factor = level === "lighter" ? 0.75 : level === "strong" ? 1.1 : 1;
  return {
    level,
    label: !hasEvidence ? "No signal yet" : level === "lighter" ? "Go lighter" : level === "strong" ? "Room to push" : "A typical day",
    reasons: reasons.length ? reasons : ["Log a quick energy check to personalize this"],
    typicalMinutes,
    suggestedMinutes: typicalMinutes ? Math.round((typicalMinutes * factor) / 5) * 5 : 0,
    latestEnergy: latestToday,
    hasEvidence,
  };
}

export function normalizeEnergyChecks(value: unknown): EnergyCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is EnergyCheck => Boolean(item) && typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) && typeof item.score === "number")
    .map((item) => ({
      at: item.at,
      score: Math.max(0, Math.min(100, Math.round(item.score))),
      ...(typeof item.note === "string" && item.note.trim() ? { note: item.note.trim().slice(0, 280) } : {}),
    }))
    .slice(-400);
}
