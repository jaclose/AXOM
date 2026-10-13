import type { NoctyriumState } from "../types";
import { buildCanonicalReportSummary } from "../reports";
import { attemptEvents, tally } from "../learning-intelligence/attempts";
import { MIN_GROUP_ANSWERS } from "../learning-intelligence/patterns";
import { localClock, safeAccent, type PulseData } from "./model";

/** A presentation snapshot of canonical records, never a second activity store. */
export function buildPulse(state: NoctyriumState, options: { start: string; end: string; scope: PulseData["scope"]; timezone: string; accent: string; source?: PulseData["source"]; sourceUpdatedAt?: string; now?: Date }): PulseData {
  const { start, end, timezone } = options;
  const range = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  if (!Number.isFinite(range) || range < 1 || range > 370) throw new Error("Choose a reporting period of 1 to 370 days.");
  const inRange = (day: string) => day >= start && day <= end;
  const dayOf = (at: string) => Number.isFinite(Date.parse(at)) ? localClock(new Date(at), timezone).day : "";
  const summary = buildCanonicalReportSummary({ ...state, activeDayKey: end }, range);
  const events = attemptEvents(state.questions).filter(event => inRange(dayOf(event.at)));
  const scored = tally(events);
  const previousStart = new Date(Date.parse(`${start}T00:00:00Z`) - range * 86400000).toISOString().slice(0, 10);
  const previous = tally(attemptEvents(state.questions).filter(event => dayOf(event.at) >= previousStart && dayOf(event.at) < start));
  const comparison = { currentScored: scored.attempts, previousScored: previous.attempts, ...(scored.attempts >= MIN_GROUP_ANSWERS && previous.attempts >= MIN_GROUP_ANSWERS && scored.accuracy !== null && previous.accuracy !== null ? { accuracyDelta: scored.accuracy - previous.accuracy } : {}) };

  const first = tally(events.filter(event => event.exposure === 1 && event.mode !== "tutor"));
  const logs = state.logs.filter(log => inRange(log.dayKey));
  const metrics: PulseData["metrics"] = [];
  if (logs.length) metrics.push({ id: "minutes", label: "Recorded study", value: summary.metrics.study.numerator, unit: "min", note: summary.metrics.study.calculation });
  if (events.length) metrics.push({ id: "questions", label: "Questions answered", value: events.length, unit: "", note: "Recorded answer attempts, including repeats and Tutor answers. Flag-only events are excluded." });
  if (scored.accuracy !== null) metrics.push({ id: "accuracy", label: "Recorded accuracy", value: scored.accuracy, unit: "%", note: `${scored.correct} correct of ${scored.attempts} scored attempts. Includes repeated and Tutor answers.` });
  if (first.accuracy !== null) metrics.push({ id: "firstAccuracy", label: "First-answer accuracy", value: first.accuracy, unit: "%", note: `${first.attempts} first exposures excluding Tutor mode. Source provenance remains on the original questions.` });
  const activeDays = new Set([...summary.activeDates, ...events.map(e => dayOf(e.at))]);
  if (activeDays.size) metrics.push({ id: "days", label: "Active days", value: activeDays.size, unit: "", note: "Distinct recorded study dates or answer dates in this period. Study logs retain AXOM's study-day boundary." });
  if (summary.metrics.streak.state !== "neutral") metrics.push({ id: "streak", label: "Current eligible streak", value: summary.metrics.streak.numerator, unit: "days", note: summary.metrics.streak.calculation });
  if (summary.metrics.consistency.state === "ready") metrics.push({ id: "consistency", label: "Scheduled consistency", value: Math.round(summary.metrics.consistency.numerator / summary.metrics.consistency.denominator * 100), unit: "%", note: summary.metrics.consistency.calculation });
  const reviews = state.cardReviews.filter(r => inRange(dayOf(r.at)));
  if (reviews.length) metrics.push({ id: "reviews", label: "Anki Lab reviews", value: reviews.length, unit: "", note: "Reviews recorded in AXOM Anki Lab. This does not measure external Anki retention." });
  const byQuestion = new Map(state.questions.map(q => [q.id, q]));
  const midpoint = new Date(Date.parse(`${start}T00:00:00Z`) + Math.floor(range / 2) * 86400000).toISOString().slice(0, 10);
  const names = [...new Set(events.map(e => byQuestion.get(e.questionId)?.system).filter((name): name is string => !!name))];
  const systems = names.flatMap(name => {
    const items = events.filter(e => byQuestion.get(e.questionId)?.system === name && e.exposure === 1 && e.mode !== "tutor");
    const all = tally(items); if (all.attempts < MIN_GROUP_ANSWERS || all.accuracy === null) return [];
    const before = tally(items.filter(e => dayOf(e.at) < midpoint)); const after = tally(items.filter(e => dayOf(e.at) >= midpoint));
    return [{ name, attempts: all.attempts, accuracy: all.accuracy, ...(before.attempts >= MIN_GROUP_ANSWERS && after.attempts >= MIN_GROUP_ANSWERS && before.accuracy !== null && after.accuracy !== null ? { delta: after.accuracy - before.accuracy } : {}) }];
  }).sort((a, b) => b.accuracy - a.accuracy);
  const buckets = [...new Set(events.map(e => dayOf(e.at).slice(0, options.scope === "year" ? 7 : 10)))].sort();
  const trend = buckets.map(label => ({ label, ...tally(events.filter(e => dayOf(e.at).startsWith(label))) }));
  const courseIds = new Set(events.map(e => byQuestion.get(e.questionId)?.courseId).filter(Boolean));
  const courses = state.courses.filter(c => courseIds.has(c.id)).map(c => c.name);
  const games = state.dailyWordPuzzles.filter(p => p.completed && inRange(p.puzzleDate));
  const coverage = ["Only recorded activity is included. Missing metrics are omitted.", "External Anki retention, cards matured and external game performance are not available in this snapshot.", "System comparisons require at least 8 first answers outside Tutor mode; gains require 8 in each half."];
  if (options.source === "protected-copy") coverage.push(`Based on the protected workspace copy from ${options.sourceUpdatedAt ?? "an unknown date"}. Device-only changes are not included.`);
  return { version: 1, scope: options.scope, periodStart: start, periodEnd: end, generatedAt: (options.now ?? new Date()).toISOString(), source: options.source ?? "device", sourceUpdatedAt: options.sourceUpdatedAt, displayName: state.profile.name.trim() || "Learner", accent: safeAccent(options.accent), metrics, systems, trend, comparison, milestones: [100, 500, 1000, 5000, 10000].filter(n => events.length >= n).map(n => `${n.toLocaleString("en")} recorded answers this period`), coverage, courses, games: games.length ? [{ name: "DailyWord", count: games.length }] : [] };
}
