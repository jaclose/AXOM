import type { Course, Term, TrackerItem } from "../types";
import { normalizeTrackerPath, trackerPathKey } from "../pathUtils";
import { canonicalModuleKey } from "./vocabulary";

/** Non-destructive proposals to file old Term/Module rows under Term/Course/Module. */
export interface CourseFilingProposal {
  from: string;
  to: string;
  module: string;
  courseCode: string;
  itemCount: number;
  blocked?: "destination-has-items" | "ambiguous-course";
}
const normTerm = (value: string) => {
  const match = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : value.trim().toLowerCase();
};
const childOf = (path: string, prefix: string) => {
  const candidate = trackerPathKey(path);
  const base = trackerPathKey(prefix);
  return candidate === base || candidate.startsWith(base + "/");
};

/** A proposal never assumes that a blank-line week has been verified. */
export function legacyCourseFilingProposals(
  tracker: readonly TrackerItem[], terms: readonly Term[], courses: readonly Course[],
): CourseFilingProposal[] {
  const termById = new Map(terms.map((term) => [term.id, term.name]));
  const seen = new Set<string>();
  const proposals: CourseFilingProposal[] = [];
  for (const item of tracker) {
    const segments = item.path.split("/").filter(Boolean);
    if (segments.length !== 2 && !(segments.length === 3 && /^(?:week\s*\d+|unscheduled)$/i.test(segments[2]))) continue;
    const [term, module] = segments;
    if (!terms.some((entry) => normTerm(entry.name) === normTerm(term))) continue;
    const from = `${term}/${module}`;
    const key = trackerPathKey(from);
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = courses.flatMap((course) => {
      if (normTerm(termById.get(course.termId) ?? "") !== normTerm(term)) return [];
      return course.modules.filter((entry) => canonicalModuleKey(entry.name) === canonicalModuleKey(module))
        .map((entry) => ({ course, moduleName: entry.name }));
    });
    if (matches.length === 0) continue;
    const itemCount = tracker.filter((row) => childOf(row.path, from)).length;
    if (matches.length > 1) {
      proposals.push({ from, to: "", module, courseCode: "", itemCount, blocked: "ambiguous-course" });
      continue;
    }
    const chosen = matches[0];
    const destinationTerm = termById.get(chosen.course.termId)!;
    const to = normalizeTrackerPath(`${destinationTerm}/${chosen.course.code}/${chosen.moduleName}`);
    const occupied = tracker.some((row) => childOf(row.path, to));
    proposals.push({
      from, to, module, courseCode: chosen.course.code, itemCount,
      ...(occupied ? { blocked: "destination-has-items" as const } : {}),
    });
  }
  return proposals.sort((a, b) => a.from.localeCompare(b.from, undefined, { numeric: true }));
}

/** An explicit move is purely structural; not a study pass or a new activity. */
export function moveTrackerCourseFiling(
  tracker: readonly TrackerItem[], proposal: CourseFilingProposal,
): TrackerItem[] {
  if (proposal.blocked || !proposal.to || !proposal.from) throw new Error("Resolve course filing conflicts before moving activities.");
  if (tracker.some((row) => childOf(row.path, proposal.to))) {
    throw new Error("The destination now has activities. Review duplicates before moving.");
  }
  const from = normalizeTrackerPath(proposal.from);
  const to = normalizeTrackerPath(proposal.to);
  const changed = tracker.map((row) => {
    if (!childOf(row.path, from)) return row;
    const relative = normalizeTrackerPath(row.path).split("/").slice(2).join("/");
    // Preserve every other learner-owned property, including id, progress,
    // source relationships, last-study updated time and attendance.
    return { ...row, path: `${to}${relative ? `/${relative}` : ""}` };
  });
  if (changed.filter((row, i) => row.path !== tracker[i].path).length !== proposal.itemCount) {
    throw new Error("Tracker changed since the filing proposal. Refresh and review again.");
  }
  return changed;
}
