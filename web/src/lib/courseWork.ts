import type { TrackerItem } from "./types";
import { normalizeTrackerPath, trackerPathKey } from "./pathUtils";

export type CourseStudyMethod = "study" | "anki" | "questions";

export function isReviewTask(item: TrackerItem): boolean {
  return Boolean(item.reviewTask) || (item.kind === "Review Loop" && item.note === "Created from missed Question Bank results.");
}
export function isArchivedCourseItem(item: TrackerItem): boolean {
  return Boolean(item.archivedAt) || (isReviewTask(item) && (item.passes > 0 || item.ankiPasses > 0));
}

export function withCourseProgress(item: TrackerItem, patch: Partial<TrackerItem>, at: string): TrackerItem {
  const next = { ...item, ...patch, updated: at };
  if (isReviewTask(next) && (next.passes > 0 || next.ankiPasses > 0)) next.archivedAt ??= at;
  return next;
}

/** A completed timer is a prompt, not evidence that a lecture pass happened. */
export function confirmCoursePass(item: TrackerItem, method: CourseStudyMethod, eventId: string, at: string): TrackerItem {
  if (isArchivedCourseItem(item) || item.passEvents?.some((event) => event.id === eventId)) return item;
  return withCourseProgress(item, {
    ...(method === "anki" ? { ankiPasses: item.ankiPasses + 1 } : { passes: item.passes + 1 }),
    passEvents: [...(item.passEvents ?? []), { id: eventId, method, at }],
  }, at);
}

export function reviewTaskInputs(titles: string[], path: string, source: NonNullable<TrackerItem["reviewTask"]>, existing: TrackerItem[]) {
  const active = new Set(existing.filter((item) => !isArchivedCourseItem(item)).map((item) => `${trackerPathKey(item.path)}|${item.label.toLowerCase()}`));
  return [...new Set(titles.map((title) => title.trim()).filter(Boolean))].flatMap((title): Array<Omit<TrackerItem, "id" | "updated">> => {
    const label = /^review\b/i.test(title) ? title : `Review ${title}`;
    const destination = normalizeTrackerPath(path || "Question Bank/Review");
    const key = `${trackerPathKey(destination)}|${label.toLowerCase()}`;
    if (active.has(key)) return [];
    active.add(key);
    return [{ path: destination, label, kind: "Review Loop", passes: 0, ankiPasses: 0, yield: "review", reviewTask: source,
      note: source.source === "digest" ? "From a question-set digest. Archives after one completed review." : "Created from missed Question Bank results." }];
  });
}
