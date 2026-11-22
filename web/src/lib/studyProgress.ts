import { resolveStudyPlan, studyPlanCourse, type StudyWorkflowPreferences } from "./studyPreferences";
import { isCompletionKind, isQuestionKind, targetPassesForItem } from "./tracker";
import type { Course, TrackerItem } from "./types";
import { isReviewTask, isArchivedCourseItem } from "./courseWork";

interface StudyProgressOptions {
  preferences?: StudyWorkflowPreferences;
  courses?: Course[];
}

/** A plan target measures recorded work, not demonstrated mastery. Never rewrite history. */
export function trackerStudyProgress(item: TrackerItem, options: StudyProgressOptions = {}) {
  const course = studyPlanCourse(options.courses ?? [], item);
  const plan = resolveStudyPlan(options.preferences, course, item);
  const review = isReviewTask(item);
  const target = review ? 1 : isQuestionKind(item.kind) || isCompletionKind(item.kind)
    ? targetPassesForItem(item)
    : plan.lecturePasses;
  // A generated QBank review is one completed activity whether confirmed by
  // a study pass or an Anki pass. Do not credit Anki against unrelated lecture
  // or practice targets, and never rewrite either recorded pass counter.
  const completedPasses = review && item.ankiPasses > 0 ? Math.max(item.passes, 1) : item.passes;
  return { plan, target, fraction: Math.min(completedPasses, target) / target, complete: completedPasses >= target };
}

/** Each item contributes equally; extra passes cannot finish another item's work. */
export function scopeStudyProgress(items: TrackerItem[], options: StudyProgressOptions = {}) {
  items = items.filter((item) => !isArchivedCourseItem(item));
  let total = 0;
  let complete = 0;
  let inProgress = 0;
  for (const item of items) {
    const progress = trackerStudyProgress(item, options);
    total += progress.fraction;
    if (progress.complete) complete++;
    else if (item.passes > 0) inProgress++;
  }
  const roundedPercent = items.length ? Math.round(total / items.length * 100) : 0;
  // With many items, 99.5% rounds to 100% despite unfinished work.
  // Keep a truthful 100% exclusively for scopes where every item is complete.
  const percent = complete === items.length ? roundedPercent : Math.min(roundedPercent, 99);
  return {
    percent,
    complete,
    inProgress,
    notStarted: items.length - complete - inProgress,
  };
}
