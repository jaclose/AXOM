/**
 * Every question in a prepared library, counted once: in a course of the plan
 * (ready, or awaiting review) or staying on this device for a stated reason.
 * A question row is one question of a package, or one row its source holds
 * that could not be read; both count, so nothing a source contains goes
 * missing from the totals. The totals must reconcile: `unaccounted` is zero
 * unless the plan placed a source twice or not at all.
 */
import type { PlannedCourse, PublicationInventory, PublicationPlan, PublicationSource } from "./publication";

export interface LedgerCount { sources: number; questions: number; ready: number; held: number }
export interface LedgerCourse extends LedgerCount {
  catalogId: string;
  term: PlannedCourse["term"];
  module: string;
  /** False while the course waits for its term to be confirmed. */
  publishable: boolean;
}
export interface QuestionLedger {
  /** Every source with a question package, and every question row they hold. */
  total: LedgerCount;
  courses: LedgerCourse[];
  inCourses: LedgerCount;
  /** Questions staying on this device, grouped by the plan's reason. */
  leftOut: Array<LedgerCount & { reason: string }>;
  /** Packages whose catalog ready/held counts disagree with their own rows. The uploader refuses them. */
  mismatched: Array<{ id: string; name: string; rows: number; ready: number; held: number }>;
  /** Rows placed nowhere or more than once. Zero when every question is accounted for. */
  unaccounted: number;
}

const empty = (): LedgerCount => ({ sources: 0, questions: 0, ready: 0, held: 0 });
/** A package that could not be read still holds the rows its catalog claims. */
const rowsOf = (source: PublicationSource) => source.rows ?? source.ready + source.review;
function add(count: LedgerCount, source: PublicationSource) {
  count.sources += 1;
  count.questions += rowsOf(source);
  count.ready += source.ready;
  count.held += source.review;
}

export function accountQuestions(inventory: PublicationInventory, plan: PublicationPlan): QuestionLedger {
  const withQuestions = inventory.sources.filter(source => source.hasBank);
  const byId = new Map(withQuestions.map(source => [source.id, source]));
  const placements = new Map<string, number>();
  const place = (id: string) => placements.set(id, (placements.get(id) ?? 0) + 1);

  const total = empty();
  for (const source of withQuestions) add(total, source);

  const inCourses = empty();
  const courses = plan.courses.map((course): LedgerCourse => {
    const count = empty();
    for (const id of course.sourceIds) {
      const source = byId.get(id);
      if (!source) continue;
      place(id);
      add(count, source);
      add(inCourses, source);
    }
    return { catalogId: course.catalogId, term: course.term, module: course.module, publishable: course.termBasis !== "proposed", ...count };
  });

  const groups = new Map<string, LedgerCount & { reason: string }>();
  for (const entry of plan.excluded) {
    const source = byId.get(entry.id);
    if (!source) continue;
    place(entry.id);
    const group = groups.get(entry.reason) ?? { reason: entry.reason, ...empty() };
    add(group, source);
    groups.set(entry.reason, group);
  }
  const leftOut = [...groups.values()].sort((left, right) => right.questions - left.questions || left.reason.localeCompare(right.reason));

  let unaccounted = 0;
  for (const source of withQuestions) {
    const times = placements.get(source.id) ?? 0;
    if (times !== 1) unaccounted += rowsOf(source) * Math.max(1, Math.abs(times - 1));
  }
  const mismatched = withQuestions.filter(source => source.rows !== undefined && source.ready + source.review !== source.rows)
    .map(source => ({ id: source.id, name: source.name, rows: source.rows!, ready: source.ready, held: source.review }));
  return { total, courses, inCourses, leftOut, mismatched, unaccounted };
}
