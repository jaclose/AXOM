import type {
  DayPlan,
  EnergyFactor,
  EnergyFactorCategory,
  EnergyFactorSource,
  JournalEntry,
  ProductivityTracker,
  StudyLog,
  Task,
} from "./types";
import { localDateKey, daysBetweenLocalDates } from "./dailyRollover";

export interface ReadinessInput {
  date: string;
  factors: EnergyFactor[];
  journal: JournalEntry[];
  logs: StudyLog[];
  tasks: Task[];
  dayPlans: DayPlan[];
  productivityTrackers?: ProductivityTracker[];
  /** One-tap energy checks (0–100). The latest one today wins over the journal label. */
  energyChecks?: Array<{ at: string; score: number }>;
}

export interface SelfReportedEnergy {
  score: number;
  label: "Low" | "Medium" | "High" | "Unlogged";
  source?: string;
}

export interface ReadinessContribution {
  id: string;
  factorId?: string;
  label: string;
  category: EnergyFactorCategory;
  source: EnergyFactorSource | "energy-rating";
  date: string;
  delta: number;
  appliedDelta: number;
  confidence: number;
  daysSince: number;
  explanation: string;
  userConfirmed: boolean;
  editable: boolean;
}

export interface ReadinessResult {
  date: string;
  selfReportedEnergy: SelfReportedEnergy;
  estimatedReadiness: number;
  readinessLabel: "Low" | "Recovering" | "Ready" | "High";
  baseline: number;
  totalImpact: number;
  carryoverImpact: number;
  contributions: ReadinessContribution[];
  possibleSignals: EnergyFactor[];
  primarySignal: string;
  recommendation: string;
}

interface JournalSignalRule {
  key: string;
  pattern: RegExp;
  label: string;
  category: EnergyFactorCategory;
  delta: number;
  confidence: number;
  carryoverDays: number;
  decayPerDay: number;
}

const BASELINE_READINESS = 62;
export const LOW_ENERGY_THRESHOLD = 40;

export interface LowEnergyExplanation {
  hasEvidence: boolean;
  triggered: boolean;
  currentValue: number | null;
  trigger: "Self-reported energy" | "Estimated readiness" | null;
  threshold: number;
  contributions: Array<{ label: string; value: number; explanation: string }>;
  adjustment: string;
  unchanged: string[];
  recommendation: string;
}

const JOURNAL_SIGNAL_RULES: JournalSignalRule[] = [
  {
    key: "all-nighter",
    pattern: /\b(all[-\s]?nighter|no sleep|zero sleep|pulled an all nighter)\b/i,
    label: "All-nighter possible",
    category: "sleep",
    delta: -22,
    confidence: 0.8,
    carryoverDays: 3,
    decayPerDay: 0.28,
  },
  {
    key: "poor-sleep",
    pattern: /\b(poor sleep|bad sleep|little sleep|insomnia|slept badly|tired|exhausted)\b/i,
    label: "Poor sleep possible",
    category: "sleep",
    delta: -10,
    confidence: 0.58,
    carryoverDays: 2,
    decayPerDay: 0.35,
  },
  {
    key: "adequate-sleep",
    pattern: /\b(good sleep|slept well|rested|8 hours|eight hours|full night)\b/i,
    label: "Adequate sleep possible",
    category: "sleep",
    delta: 8,
    confidence: 0.58,
    carryoverDays: 1,
    decayPerDay: 0.6,
  },
  {
    key: "movement",
    pattern: /\b(gym|workout|exercise|walked|run|ran|lifted|movement)\b/i,
    label: "Movement possible",
    category: "movement",
    delta: 7,
    confidence: 0.6,
    carryoverDays: 1,
    decayPerDay: 0.7,
  },
  {
    key: "doomscroll",
    pattern: /\b(doomscroll|doom scrolling|scrolling for hours|bedrotting|bed rotting)\b/i,
    label: "Doomscrolling or bedrotting possible",
    category: "focus",
    delta: -6,
    confidence: 0.62,
    carryoverDays: 1,
    decayPerDay: 0.55,
  },
  {
    key: "alcohol",
    pattern: /\b(alcohol|drank|hungover|hangover)\b/i,
    label: "Alcohol/recovery load possible",
    category: "substance",
    delta: -12,
    confidence: 0.62,
    carryoverDays: 2,
    decayPerDay: 0.4,
  },
  {
    key: "overload",
    pattern: /\b(overloaded|overwhelmed|burned out|burnt out|too much|behind|falling behind|late (?:on|with|for)|deadline pressure)\b/i,
    label: "Overload possible",
    category: "workload",
    delta: -8,
    confidence: 0.58,
    carryoverDays: 1,
    decayPerDay: 0.45,
  },
  {
    key: "positive-momentum",
    pattern: /\b(on track|caught up|focused well|good energy|felt calm|steady progress)\b/i,
    label: "Positive momentum possible",
    category: "recovery",
    delta: 4,
    confidence: 0.5,
    carryoverDays: 0,
    decayPerDay: 1,
  },
  {
    key: "reflection",
    pattern: /\b(journaled|reflected|standup|reviewed the day|planned tomorrow)\b/i,
    label: "Reflection possible",
    category: "recovery",
    delta: 4,
    confidence: 0.55,
    carryoverDays: 0,
    decayPerDay: 1,
  },
  {
    key: "spirit",
    pattern: /\b(prayed|prayer|church|devotional|spiritual)\b/i,
    label: "Spiritual practice possible",
    category: "spirit",
    delta: 5,
    confidence: 0.55,
    carryoverDays: 1,
    decayPerDay: 0.65,
  },
  {
    key: "social",
    pattern: /\b(friends|family|called home|social|connection)\b/i,
    label: "Social connection possible",
    category: "recovery",
    delta: 4,
    confidence: 0.52,
    carryoverDays: 0,
    decayPerDay: 1,
  },
];

export const QUICK_ENERGY_FACTORS: Array<Pick<EnergyFactor, "label" | "category" | "source" | "delta" | "confidence" | "carryoverDays" | "decayPerDay" | "notes">> = [
  { label: "Adequate sleep", category: "sleep", source: "manual", delta: 10, confidence: 1, carryoverDays: 1, decayPerDay: 0.55, notes: "Manually logged recovery signal." },
  { label: "Poor sleep", category: "sleep", source: "manual", delta: -12, confidence: 1, carryoverDays: 2, decayPerDay: 0.35, notes: "Manually logged sleep debt." },
  { label: "Movement", category: "movement", source: "manual", delta: 8, confidence: 1, carryoverDays: 1, decayPerDay: 0.7, notes: "Manually logged movement signal." },
  { label: "Healthy meal", category: "food", source: "manual", delta: 5, confidence: 0.9, carryoverDays: 0, decayPerDay: 1, notes: "Manually logged food support." },
  { label: "Overload", category: "workload", source: "manual", delta: -9, confidence: 0.9, carryoverDays: 1, decayPerDay: 0.45, notes: "Manually logged load signal." },
  { label: "Recovery time", category: "recovery", source: "manual", delta: 6, confidence: 0.9, carryoverDays: 0, decayPerDay: 1, notes: "Manually logged recovery block." },
  { label: "Alcohol/recovery load", category: "substance", source: "manual", delta: -12, confidence: 0.9, carryoverDays: 2, decayPerDay: 0.4, notes: "Manually logged next-day recovery load." },
];

export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const selfReportedEnergy = selfReportedEnergyForDay(input.journal, input.date, input.energyChecks);
  const possibleSignals = inferJournalSignals(input.journal, input.date)
    .filter((signal) => !input.factors.some((factor) => factor.id === signal.id));
  const contributions = [
    ...selfReportedContribution(selfReportedEnergy, input.date),
    ...ledgerContributions(input.factors, input.date),
    ...implicitContributions(input),
  ].sort((a, b) => Math.abs(b.appliedDelta) - Math.abs(a.appliedDelta));

  const totalImpact = round(contributions.reduce((sum, item) => sum + item.appliedDelta, 0));
  const carryoverImpact = round(contributions
    .filter((item) => item.daysSince > 0)
    .reduce((sum, item) => sum + item.appliedDelta, 0));
  const estimatedReadiness = clamp(Math.round(BASELINE_READINESS + totalImpact));
  const leading = contributions[0];
  return {
    date: input.date,
    selfReportedEnergy,
    estimatedReadiness,
    readinessLabel: readinessLabel(estimatedReadiness),
    baseline: BASELINE_READINESS,
    totalImpact,
    carryoverImpact,
    contributions,
    possibleSignals,
    primarySignal: leading
      ? `${leading.label} ${formatSigned(leading.appliedDelta)}`
      : possibleSignals.length
        ? "Possible signal detected; confirm before applying"
        : "No readiness factors logged yet",
    recommendation: recommendation(estimatedReadiness, contributions, possibleSignals),
  };
}

/**
 * Translate the canonical readiness result into an inspectable, optional
 * low-energy suggestion. This never mutates a task, deadline, or day plan.
 */
export function explainLowEnergy(
  readiness: ReadinessResult,
  threshold = LOW_ENERGY_THRESHOLD,
): LowEnergyExplanation {
  const validThreshold = Number.isFinite(threshold) ? Math.max(0, Math.min(100, threshold)) : LOW_ENERGY_THRESHOLD;
  const reported = readiness.selfReportedEnergy;
  const hasReportedValue = Boolean(reported.source) && reported.label !== "Unlogged";
  const hasConfirmedEvidence = readiness.contributions.some((item) => item.userConfirmed);
  const hasEvidence = hasReportedValue || hasConfirmedEvidence;
  const reportedLow = hasReportedValue && reported.score < validThreshold;
  const estimatedLow = hasConfirmedEvidence && readiness.estimatedReadiness < validThreshold;
  const trigger = reportedLow ? "Self-reported energy" : estimatedLow ? "Estimated readiness" : null;
  return {
    hasEvidence,
    triggered: hasEvidence && Boolean(trigger),
    currentValue: trigger === "Self-reported energy"
      ? reported.score
      : trigger === "Estimated readiness" ? readiness.estimatedReadiness : null,
    trigger,
    threshold: validThreshold,
    contributions: readiness.contributions
      .filter((item) => item.appliedDelta < 0)
      .map((item) => ({ label: item.label, value: item.appliedDelta, explanation: item.explanation })),
    adjustment: "Preview a smaller next block and one minimum viable win.",
    unchanged: ["Tasks and deadlines", "Today’s saved plan", "Course and review data"],
    recommendation: readiness.recommendation,
  };
}

export function inferJournalSignals(journal: JournalEntry[], date: string): EnergyFactor[] {
  const entries = journalForLocalDate(journal, date);
  const now = new Date().toISOString();
  const signals: EnergyFactor[] = [];
  for (const entry of entries) {
    const text = [entry.today, entry.tomorrow, entry.blockers, entry.rating].join(" ");
    for (const rule of JOURNAL_SIGNAL_RULES) {
      if (!rule.pattern.test(text)) continue;
      signals.push({
        id: `journal-signal:${entry.id}:${rule.key}`,
        date,
        source: "journal",
        label: rule.label,
        category: rule.category,
        delta: rule.delta,
        confidence: rule.confidence,
        carryoverDays: rule.carryoverDays,
        decayPerDay: rule.decayPerDay,
        userConfirmed: false,
        notes: "Possible signal detected from journal language. Confirm before it affects readiness.",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return dedupeSignals(signals);
}

export function applyCarryoverDecay(factor: EnergyFactor, targetDate: string): { daysSince: number; multiplier: number } | null {
  const daysSince = daysBetweenLocalDates(factor.date, targetDate);
  if (factor.date > targetDate || daysSince > factor.carryoverDays) return null;
  const multiplier = Math.max(0, 1 - (factor.decayPerDay * daysSince));
  if (multiplier <= 0) return null;
  return { daysSince, multiplier };
}

function selfReportedContribution(energy: SelfReportedEnergy, date: string): ReadinessContribution[] {
  if (!energy.source || energy.label === "Unlogged") return [];
  const appliedDelta = round((energy.score - 60) * 0.18);
  if (!appliedDelta) return [];
  return [{
    id: `self-reported-energy:${date}`,
    label: "Self-reported energy",
    category: "recovery",
    source: "energy-rating",
    date,
    delta: appliedDelta,
    appliedDelta,
    confidence: 1,
    daysSince: 0,
    explanation: energy.source.startsWith("energy-check:") ? "Your latest one-tap energy check today." : "User-selected energy from today's standup.",
    userConfirmed: true,
    editable: false,
  }];
}

function ledgerContributions(factors: EnergyFactor[], targetDate: string): ReadinessContribution[] {
  return factors.flatMap((factor) => {
    if (!factor.userConfirmed) return [];
    const decay = applyCarryoverDecay(factor, targetDate);
    if (!decay) return [];
    const appliedDelta = round(factor.delta * clampConfidence(factor.confidence) * decay.multiplier);
    if (!appliedDelta) return [];
    return [{
      id: `ledger:${factor.id}:${targetDate}`,
      factorId: factor.id,
      label: factor.label,
      category: factor.category,
      source: factor.source,
      date: factor.date,
      delta: factor.delta,
      appliedDelta,
      confidence: clampConfidence(factor.confidence),
      daysSince: decay.daysSince,
      explanation: factor.notes || explanationForFactor(factor, decay.daysSince),
      userConfirmed: factor.userConfirmed,
      editable: true,
    }];
  });
}

function implicitContributions(input: ReadinessInput): ReadinessContribution[] {
  const logs = input.logs.filter((log) => log.dayKey === input.date);
  const trackersById = new Map((input.productivityTrackers ?? []).map((tracker) => [tracker.id, tracker]));
  const productiveMinutes = logs.reduce((sum, log) => sum + (log.productive === false ? 0 : Math.max(0, log.minutes)), 0);
  const movementMinutes = logs.reduce((sum, log) => {
    const tracker = log.trackerId ? trackersById.get(log.trackerId) : undefined;
    const hay = `${log.type} ${tracker?.name ?? ""} ${tracker?.category ?? ""}`.toLowerCase();
    return /(gym|workout|exercise|walk|run|movement|health)/.test(hay) ? sum + Math.max(0, log.minutes || Number(log.quantity ?? 0)) : sum;
  }, 0);
  const factors: ReadinessContribution[] = [];

  if (productiveMinutes >= 60) {
    const capped = productiveMinutes >= 180 ? 9 : productiveMinutes >= 120 ? 7 : 4;
    factors.push(implicit("productive-work", "Completed meaningful work", "focus", "tracker", input.date, capped, `Logged ${productiveMinutes} productive minutes today.`));
  }
  if (movementMinutes >= 10) {
    factors.push(implicit("movement-log", "Movement logged", "movement", "tracker", input.date, movementMinutes >= 30 ? 8 : 4, `Logged ${movementMinutes} movement minutes today.`));
  }

  const plan = input.dayPlans.find((item) => item.dayKey === input.date);
  if (plan?.outcome === "won") factors.push(implicit("plan-won", "Planned priorities completed", "focus", "goal", input.date, 7, "Today's win-the-day plan was marked won."));
  if (plan?.outcome === "partial") factors.push(implicit("plan-partial", "Partial priority completion", "focus", "goal", input.date, 2, "Today's win-the-day plan was marked partial."));
  if (plan?.outcome === "missed") factors.push(implicit("plan-missed", "Missed planned priorities", "workload", "goal", input.date, -8, "Today's win-the-day plan was marked missed."));

  const carryoverOpen = input.tasks.filter((task) =>
    !task.done
    && !task.archived
    && task.due
    && task.due.slice(0, 10) <= input.date
    && (task.carryoverFrom?.length ?? 0) > 0,
  ).length;
  if (carryoverOpen) {
    factors.push(implicit("carryover-work", "Unfinished carryover work", "workload", "goal", input.date, -Math.min(12, carryoverOpen * 3), `${carryoverOpen} carried task${carryoverOpen === 1 ? "" : "s"} still open.`));
  }

  return factors;
}

function implicit(
  id: string,
  label: string,
  category: EnergyFactorCategory,
  source: "tracker" | "goal",
  date: string,
  delta: number,
  explanation: string,
): ReadinessContribution {
  return {
    id: `implicit:${id}:${date}`,
    label,
    category,
    source,
    date,
    delta,
    appliedDelta: delta,
    confidence: 1,
    daysSince: 0,
    explanation,
    userConfirmed: true,
    editable: false,
  };
}

function selfReportedEnergyForDay(journal: JournalEntry[], date: string, checks: ReadinessInput["energyChecks"] = []): SelfReportedEnergy {
  const check = checks
    .filter((item) => { const parsed = new Date(item.at); return !Number.isNaN(parsed.getTime()) && localDateKey(parsed) === date; })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (check) {
    const score = Math.max(0, Math.min(100, Math.round(check.score)));
    return { score, label: score < 45 ? "Low" : score < 70 ? "Medium" : "High", source: `energy-check:${check.at}` };
  }
  const entry = journalForLocalDate(journal, date)[0];
  if (!entry?.energy) return { score: 55, label: "Unlogged" };
  if (entry.energy === "High") return { score: 82, label: "High", source: entry.id };
  if (entry.energy === "Medium") return { score: 60, label: "Medium", source: entry.id };
  return { score: 35, label: "Low", source: entry.id };
}

function journalForLocalDate(journal: JournalEntry[], date: string) {
  return journal
    .filter((entry) => {
      const parsed = new Date(entry.date);
      return Number.isNaN(parsed.getTime()) ? entry.date.slice(0, 10) === date : localDateKey(parsed) === date;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function explanationForFactor(factor: EnergyFactor, daysSince: number) {
  const carry = daysSince > 0 ? ` Carryover day ${daysSince}; decay is applied.` : "";
  return `${factor.source} factor in ${factor.category}.${carry}`;
}

function recommendation(score: number, contributions: ReadinessContribution[], possibleSignals: EnergyFactor[]) {
  const negatives = contributions.filter((item) => item.appliedDelta < 0);
  if (possibleSignals.length) return "Possible journal signals are waiting for confirmation. Confirm, ignore, or add a manual factor.";
  if (score < 38) return "Run a lower-load day: one repair block, one closed loop, and a short standup. This is not medical advice.";
  if (score < 55 && negatives.some((item) => item.category === "sleep")) return "Sleep or recovery is dragging the estimate. Keep the academic floor small and make the next block easy to start.";
  if (score < 55) return "Reduce friction today: pick the smallest meaningful work block and clear one carryover task.";
  if (score >= 78) return "Good readiness signal. Use it for precise work, not uncontrolled volume.";
  return "Stable enough for normal execution. Keep logging factors so the estimate becomes more personal.";
}

function readinessLabel(score: number): ReadinessResult["readinessLabel"] {
  if (score >= 78) return "High";
  if (score >= 58) return "Ready";
  if (score >= 38) return "Recovering";
  return "Low";
}

function dedupeSignals(signals: EnergyFactor[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.id)) return false;
    seen.add(signal.id);
    return true;
  });
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}
