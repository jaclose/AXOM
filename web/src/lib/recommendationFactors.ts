import type { Course, TrackerItem } from "./types";
import { type EffectiveStudyPlan, type StudyMethodId, type StudyWorkflowPreferences } from "./studyPreferences";
import { trackerStudyProgress } from "./studyProgress";
import { isCompletionKind, isQuestionKind, passStage, PASS_COLOR, type Suggestion } from "./tracker";
import { PRIMARY_FOCUS_BOOST, pathInScopes } from "./trackerFocus";

export interface RecommendationFactor { id: string; label: string; value: number; }
export interface RankedTrackerItem { item: TrackerItem; score: number; factors: RecommendationFactor[]; reason: string; plan: EffectiveStudyPlan; target: number; }
export interface RankOptions {
  preferences?: StudyWorkflowPreferences;
  courses?: Course[];
  now?: Date;
  /** Course Tracker scopes the learner marked as primary (lib/trackerFocus). */
  primaryScopes?: readonly string[];
}

export function rankTrackerItems(items: TrackerItem[], options: RankOptions = {}): RankedTrackerItem[] {
  const now = options.now ?? new Date();
  return items.flatMap((item) => {
    if (item.recommendationSnoozedUntil && Date.parse(item.recommendationSnoozedUntil) > now.getTime()) return [];
    const { plan, target, complete } = trackerStudyProgress(item, options);
    if (complete) return [];
    const ageDays = Math.max(0, (now.getTime() - Date.parse(item.updated)) / 86400000);
    const factors: RecommendationFactor[] = [];
    add(factors, "completion", "Unfinished work", Math.min(24, (target - item.passes) * 6));
    add(factors, "first-exposure", "Not started yet", item.passes === 0 ? 30 : 0);
    add(factors, "yield", item.yield === "high" ? "High-yield" : item.yield === "review" ? "Marked for review" : "", item.yield === "high" ? 18 : item.yield === "review" ? 22 : item.yield === "low" ? -8 : 0);
    const reviewRamp = item.passes === 1 ? Math.max(0, Math.min(24, 6 + (ageDays - plan.reviewAfterDays) * 4)) : 0;
    add(factors, "review-urgency", ageDays >= plan.reviewAfterDays ? `Review overdue after ${plan.reviewAfterDays} days` : "Review window approaching", reviewRamp);
    const difficulty = item.difficulty === "very-hard" ? 14 : item.difficulty === "hard" ? 10 : item.difficulty === "moderate" ? 4 : item.difficulty === "easy" ? -3 : 0;
    add(factors, "difficulty", item.difficulty ? `Marked ${item.difficulty.replace("-", " ")}` : "", difficulty);
    const daysToAssessment = item.assessmentDate ? Math.ceil((Date.parse(`${item.assessmentDate}T12:00:00`) - now.getTime()) / 86400000) : null;
    const assessment = daysToAssessment !== null && daysToAssessment >= 0 ? Math.min(24, Math.max(0, 18 - daysToAssessment)) * (item.yield === "low" ? 0.4 : 1) : 0;
    add(factors, "assessment-urgency", daysToAssessment === 0 ? "Assessment today" : daysToAssessment === 1 ? "Assessment tomorrow" : daysToAssessment !== null && daysToAssessment >= 0 ? `Assessment in ${daysToAssessment} days` : "", assessment);
    add(factors, "weak-evidence", "Notes indicate difficulty", item.note && /miss|weak|again|wrong|confus|unclear|hard/i.test(item.note) ? 12 : 0);
    const questionsEnabled = plan.methods.some((method) => method.id === "practice-questions" && method.enabled);
    add(factors, "learner-plan", "Matches your study workflow", isQuestionKind(item.kind) && questionsEnabled ? 8 : 0);
    add(factors, "explicit-priority", "Learner-set priority", item.explicitPriority ? Math.min(16, item.explicitPriority * 3) : 0);
    add(factors, "primary-focus", "In your primary focus", options.primaryScopes?.length && pathInScopes(item.path, options.primaryScopes) ? PRIMARY_FOCUS_BOOST : 0);
    add(factors, "item-type", "Practice work", isQuestionKind(item.kind) ? 4 : 0);
    add(factors, "recency", "Recently updated", ageDays < 1 && item.passes > 0 ? -6 : 0);
    const score = factors.reduce((sum, factor) => sum + factor.value, 0);
    return [{ item, score, factors, plan, target, reason: factors.filter((factor) => factor.value > 0).sort((a, b) => b.value - a.value).slice(0, 3).map((factor) => factor.label).join(" · ") }];
  }).sort((a, b) => b.score - a.score || a.item.updated.localeCompare(b.item.updated) || a.item.id.localeCompare(b.item.id));
}
export function personalizedSuggestions(items: TrackerItem[], n = 3, options: RankOptions = {}): Suggestion[] {
  if (!items.length) return [{ title: "Import the first tracker items", reason: "Add course work so AXOM can recommend a useful first move.", color: PASS_COLOR.untouched }];
  const ranked = rankTrackerItems(items, options);
  if (!ranked.length) {
    const unfinished = rankTrackerItems(items.map((item) => ({ ...item, recommendationSnoozedUntil: undefined })), options);
    return unfinished.length
      ? [{ title: "Remaining work is snoozed", reason: "Your unfinished items will return when their snooze ends. They are not marked complete.", color: PASS_COLOR.untouched }]
      : [{ title: "This scope is complete", reason: "Every item has reached its current study-plan target.", color: PASS_COLOR.mastered }];
  }
  return ranked.slice(0, n).map(({ item, reason }) => ({ title: moveTitle(item), reason, color: PASS_COLOR[passStage(item.passes)], itemId: item.id }));
}

const METHOD_RESOURCE: Record<StudyMethodId, string> = {
  "lecture-passes": "Lecture notes / slides",
  "practice-questions": "Practice questions",
  anki: "Anki", quizlet: "Quizlet", noji: "Noji", remnote: "RemNote",
  notes: "Notes", "teach-aloud": "Teach aloud", recall: "Active recall",
  "external-resource": "External resource", custom: "Custom study method",
};
const METHOD_TIMING = {
  before: "before learning", "after-first-pass": "after the first pass",
  "after-learning": "after learning", "near-exam": "near the exam", ongoing: "ongoing",
};

/** Describe the resolved plan without enabling a tool or inventing a linked resource. */
export function trackerStudyAction({ item, plan, target }: RankedTrackerItem) {
  const completion = isCompletionKind(item.kind);
  const questions = isQuestionKind(item.kind);
  const methods = plan.methods.filter((method) => method.enabled);
  const resources = completion ? [] : methods
    .filter((method) => !questions || !["lecture-passes", "practice-questions"].includes(method.id))
    .map((method) => {
      const label = method.label?.trim() || METHOD_RESOURCE[method.id];
      return method.timing && METHOD_TIMING[method.timing] ? `${label} (${METHOD_TIMING[method.timing]})` : label;
    });
  if (questions) resources.unshift("Question material", "Error log");
  return {
    title: moveTitle(item),
    resources: [...new Set(resources)],
    expectedOutcome: completion ? "Complete this item and record its status."
      : questions ? `Complete practice round ${item.passes + 1} of ${target} and review the errors.`
        : `Complete pass ${item.passes + 1} of ${target} in your study plan.`,
    summary: completion ? "Completion-based item; lecture pass targets do not apply."
      : `${item.passes} of ${target} ${questions ? "practice rounds" : "passes"} complete · Review after ${plan.reviewAfterDays} day${plan.reviewAfterDays === 1 ? "" : "s"}.`,
    sources: plan.sources,
  };
}
function add(list: RecommendationFactor[], id: string, label: string, value: number) { if (value && label) list.push({ id, label, value }); }
function moveTitle(item: TrackerItem) { if (isCompletionKind(item.kind)) return `${item.passes ? "Verify" : "Complete"}: ${item.label}`; if (!item.passes) return `Start: ${item.label}`; if (isQuestionKind(item.kind)) return `${item.kind} #${Math.min(item.passes + 1, 3)}: ${item.label}`; return `Review: ${item.label}`; }
