import { parseCourseTemplate, planCourseTemplate, type PlannedCourseItem } from "../course-engine/templateParse";
import { splitAcademicPlanSections } from "./coursePlan";

export interface PublicPlanWeek {
  week: number;
  items: PlannedCourseItem[];
  /** Activities in this week that AXOM placed by ordering; the plan does not state their week. */
  tentative: number;
}
export interface PublicPlanPreview {
  weeks: PublicPlanWeek[];
  /** Activities the plan does not place in a week. They are never assigned one here. */
  unscheduled: PlannedCourseItem[];
  activities: number;
  /** At least one activity sits in a week the plan does not state for it. */
  tentative: boolean;
  /** The plan text could not be read by this version of AXOM. */
  unreadable: boolean;
}

/** The plan itself names this activity's week; anything else is AXOM's ordering. */
export const weekIsStated = (item: PlannedCourseItem): boolean => item.weekBasis === "stated";

/**
 * A read-only weekly outline of an offered course plan. Nothing is saved and
 * no week is invented: an activity without an evidenced week stays unscheduled,
 * and an activity AXOM placed by ordering is counted as tentative. A course
 * without a plan (a question collection) yields an empty, readable outline.
 */
export function publicPlanPreview(templateText: string, term: string): PublicPlanPreview {
  const texts = templateText.trim() ? splitAcademicPlanSections(templateText) : [];
  if (!texts.length) return { weeks: [], unscheduled: [], activities: 0, tentative: false, unreadable: false };
  const sections = texts.map((text, index) => parseCourseTemplate(text, `Section ${index + 1}`));
  const plan = planCourseTemplate(sections, { term });
  const byWeek = new Map<number, PlannedCourseItem[]>();
  const unscheduled: PlannedCourseItem[] = [];
  for (const item of plan.items) {
    if (item.week === undefined) unscheduled.push(item);
    else byWeek.set(item.week, [...(byWeek.get(item.week) ?? []), item]);
  }
  const weeks = [...byWeek].sort(([left], [right]) => left - right)
    .map(([week, items]) => ({ week, items, tentative: items.filter(item => !weekIsStated(item)).length }));
  return {
    weeks, unscheduled, activities: plan.items.length,
    tentative: weeks.some(week => week.tentative > 0),
    unreadable: sections.some(section => section.problems.length > 0) || plan.items.length === 0,
  };
}
