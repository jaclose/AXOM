import { resolveStudyPlan, studyPlanCourse, type StudyWorkflowPreferences } from "./studyPreferences";
import { isCompletionKind, isQuestionKind, targetPassesForItem } from "./tracker";
import type { Course, TrackerItem } from "./types";

interface StudyProgressOptions {
  preferences?: StudyWorkflowPreferences;
  courses?: Course[];
}

/** A plan target measures recorded work, not demonstrated mastery. Never rewrite history. */
export function trackerStudyProgress(item: TrackerItem, options: StudyProgressOptions = {}) {
  const course = studyPlanCourse(options.courses ?? [], item);
  const plan = resolveStudyPlan(options.preferences, course, item);
  const target = isQuestionKind(item.kind) || isCompletionKind(item.kind)
    ? targetPassesForItem(item)
    : plan.lecturePasses;
  return { plan, target, fraction: Math.min(item.passes, target) / target, complete: item.passes >= target };
}

/** Each item contributes equally; extra passes cannot finish another item's work. */
export function scopeStudyProgress(items: TrackerItem[], options: StudyProgressOptions = {}) {
  let total = 0;
  let complete = 0;
  let inProgress = 0;
  for (const item of items) {
    const progress = trackerStudyProgress(item, options);
    total += progress.fraction;
    if (progress.complete) complete++;
    else if (item.passes > 0) inProgress++;
  }
  return {
    percent: items.length ? Math.round(total / items.length * 100) : 0,
    complete,
    inProgress,
    notStarted: items.length - complete - inProgress,
  };
}
