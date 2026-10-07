// ===========================================================================
// The week as the unit of work. Reads tracker rows filed as
// "Term/Module/Week N" (the shape a course template writes) and joins each
// week to the questions filed under the same module and week. Question
// progress comes from recorded attempts, and absences from what was marked on
// the row, so nothing here is a second copy of anyone's progress.
// ===========================================================================
import type { ID, Term, TrackerItem } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { ATTENDED_ACTIVITIES, attendanceCategory, type CourseActivity } from "./activity";
import { scopeProgress, trackerPathScope, type ScopeProgress } from "./scope";
import { moduleKey } from "./vocabulary";

export interface WeekSummary {
  /** Tracker scope: "Term 1/FTM 1/Week 3". */
  path: string;
  week: number;
  items: TrackerItem[];
  /** Rows studied or completed at least once. */
  done: number;
  byActivity: Array<{ activity: CourseActivity | "other"; total: number; done: number }>;
  /** What was answered of the questions filed under this module and week. */
  questions: ScopeProgress;
  missed: number;
}

export interface ModuleWeeks {
  key: string;
  module: string;
  /** First path segment, when the module sits under one. */
  term?: string;
  weeks: WeekSummary[];
  done: number;
  total: number;
  /** The first week with something left to do. */
  currentWeek?: number;
}

/** A row counts as done once it has a pass: studied, attended or completed. */
const isDone = (item: TrackerItem) => item.passes >= 1;

export function buildModuleWeeks(
  tracker: readonly TrackerItem[],
  questions: readonly QuestionRecord[],
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): ModuleWeeks[] {
  const modules = new Map<string, ModuleWeeks & { byWeek: Map<number, TrackerItem[]>; paths: Map<number, string> }>();
  for (const item of tracker) {
    const scope = trackerPathScope(item.path);
    if (!scope.module || !scope.week) continue;
    const key = moduleKey(scope.module);
    const segments = item.path.split("/");
    const entry = modules.get(key) ?? {
      key, module: scope.module, term: segments.length >= 3 ? segments[0] : undefined,
      weeks: [], done: 0, total: 0, byWeek: new Map(), paths: new Map(),
    };
    entry.byWeek.set(scope.week, [...(entry.byWeek.get(scope.week) ?? []), item]);
    entry.paths.set(scope.week, item.path);
    modules.set(key, entry);
  }

  return [...modules.values()].map(({ byWeek, paths, ...module }) => {
    const weeks = [...byWeek.entries()].sort(([left], [right]) => left - right).map(([week, items]): WeekSummary => {
      const groups = new Map<CourseActivity | "other", { total: number; done: number }>();
      for (const item of items) {
        const activity = item.activity ?? "other";
        const group = groups.get(activity) ?? { total: 0, done: 0 };
        group.total += 1;
        if (isDone(item)) group.done += 1;
        groups.set(activity, group);
      }
      return {
        path: paths.get(week)!,
        week,
        items,
        done: items.filter(isDone).length,
        byActivity: [...groups.entries()].map(([activity, counts]) => ({ activity, ...counts })),
        questions: scopeProgress(questions, { module: module.module, week }, setsById),
        missed: items.filter((item) => item.attendance === "missed").length,
      };
    });
    return {
      ...module,
      weeks,
      done: weeks.reduce((total, week) => total + week.done, 0),
      total: weeks.reduce((total, week) => total + week.items.length, 0),
      currentWeek: weeks.find((week) => week.done < week.items.length)?.week,
    };
  }).sort((left, right) => (
    (left.term ?? "").localeCompare(right.term ?? "", undefined, { numeric: true })
    || left.module.localeCompare(right.module, undefined, { numeric: true, sensitivity: "base" })
  ));
}

export interface AbsenceStanding {
  category: CourseActivity;
  missed: number;
  /** From the term's template; undefined when the learner has not set one. */
  allowed?: number;
  /** Negative once the allowance is exceeded. */
  remaining?: number;
}

/**
 * Absences in one term against what the term allows. A flipped lecture counts
 * as a lecture. Only categories with a miss or an allowance are listed.
 */
export function absenceStanding(
  tracker: readonly TrackerItem[],
  term: Pick<Term, "name" | "absenceAllowances">,
): AbsenceStanding[] {
  const missed = new Map<CourseActivity, number>();
  for (const item of tracker) {
    if (item.attendance !== "missed" || !item.activity) continue;
    if (item.path.split("/")[0] !== term.name) continue;
    const category = attendanceCategory(item.activity);
    missed.set(category, (missed.get(category) ?? 0) + 1);
  }
  const categories = ATTENDED_ACTIVITIES.map(attendanceCategory).filter((category, index, all) => all.indexOf(category) === index);
  return categories.flatMap((category) => {
    const allowed = term.absenceAllowances?.[category];
    const count = missed.get(category) ?? 0;
    if (!count && allowed === undefined) return [];
    return [{ category, missed: count, allowed, remaining: allowed === undefined ? undefined : allowed - count }];
  });
}

export function isAttended(activity: CourseActivity | undefined): boolean {
  return Boolean(activity && ATTENDED_ACTIVITIES.includes(activity));
}
