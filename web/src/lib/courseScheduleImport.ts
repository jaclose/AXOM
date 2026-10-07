import { isIcsCalendar, parseIcsEvents, type IcsParseOptions } from "./icsCalendar";
import type { TrackerItem, TrackerKind } from "./types";

export interface ScheduleCandidate {
  id: string;
  date?: string;
  label: string;
  kind: TrackerKind;
  sourceLine: number;
  sourceName?: string;
  selected: boolean;
  duplicate: "exact" | "likely" | "none";
  problem?: string;
}

const KIND_MAP: Array<[RegExp, TrackerKind]> = [
  [/\b(exam|quiz|assessment|imcq|midterm|final)\b/i, "Assessment"],
  [/\b(dla|daily learning)\b/i, "DLA"],
  [/\b(lab|practical)\b/i, "Lab"],
  [/\b(question|pq|qbank|practice)\b/i, "PQ"],
  [/\b(review)\b/i, "Review Loop"],
  [/\b(reading|chapter)\b/i, "Reading"],
  [/\b(assignment|deadline|requirement)\b/i, "Requirement"],
];

/**
 * A pasted schedule or a calendar (.ics) file as candidates for review. A
 * calendar is read by lib/icsCalendar, which puts every timed event on the
 * learner's own calendar day: an 11:59 pm deadline written in another time
 * zone or in UTC does not land a day late. `options.timeZone` names the
 * learner's zone and defaults to the device's.
 */
export function parseCourseSchedule(
  text: string,
  existing: readonly TrackerItem[] = [],
  sourceName?: string,
  options: IcsParseOptions = {},
): ScheduleCandidate[] {
  if (isIcsCalendar(text)) return parseIcsSchedule(text, existing, sourceName, options);
  return parseDelimitedSchedule(text, existing, sourceName);
}

export function scheduleCandidatesToTracker(
  candidates: readonly ScheduleCandidate[],
  path: string,
): Array<Omit<TrackerItem, "id" | "updated">> {
  return candidates
    .filter((candidate) => candidate.selected && candidate.duplicate !== "exact" && !candidate.problem && candidate.label.trim())
    .map((candidate) => ({
      path,
      label: candidate.label.trim(),
      kind: candidate.kind,
      passes: 0,
      ankiPasses: 0,
      yield: "none",
      assessmentDate: candidate.kind === "Assessment" ? candidate.date : undefined,
      note: provenanceNote(candidate),
    }));
}

export function reconcileScheduleDuplicates(
  candidates: readonly ScheduleCandidate[],
  existing: readonly TrackerItem[],
): ScheduleCandidate[] {
  const exact = new Set(existing.map((item) => identity(item.label, item.kind, dateFrom(item.assessmentDate, item.note))));
  const labels = new Set(existing.map((item) => normalize(item.label)));
  const seenExact = new Set<string>();
  const seenLabels = new Set<string>();
  return candidates.map((candidate) => {
    const key = identity(candidate.label, candidate.kind, candidate.date);
    const labelKey = normalize(candidate.label);
    const duplicate = exact.has(key) || seenExact.has(key)
      ? "exact"
      : labels.has(labelKey) || seenLabels.has(labelKey) ? "likely" : "none";
    if (labelKey) { seenExact.add(key); seenLabels.add(labelKey); }
    return { ...candidate, duplicate, selected: duplicate === "exact" ? false : candidate.selected };
  });
}

function parseDelimitedSchedule(text: string, existing: readonly TrackerItem[], sourceName?: string): ScheduleCandidate[] {
  const rows = text.split(/\r?\n/).flatMap((raw, index) => {
    const line = raw.trim();
    if (!line || /^date[,\t]/i.test(line)) return [];
    const cells = splitRow(line);
    const date = parseDate(cells[0]);
    const body = date ? cells.slice(1).join(" ") : line;
    const lastIndex = cells.length - 1;
    const explicitKindIndex = cells.length >= 3 && KIND_MAP.some(([pattern]) => pattern.test(cells[lastIndex])) ? lastIndex : -1;
    const kind = detectKind(explicitKindIndex >= 0 ? cells[explicitKindIndex] : body);
    const label = date && explicitKindIndex >= 0 ? cells.slice(1, explicitKindIndex).join(" ").trim() : cleanLabel(body, kind);
    const problem = label ? undefined : `Line ${index + 1} has no usable title.`;
    return [candidate(`${index + 1}`, label, kind, date, index + 1, sourceName, problem)];
  });
  return reconcileScheduleDuplicates(rows, existing);
}

function parseIcsSchedule(text: string, existing: readonly TrackerItem[], sourceName: string | undefined, options: IcsParseOptions): ScheduleCandidate[] {
  const rows = parseIcsEvents(text, options).map((event) => {
    // A learning platform's feed ends every title with the course in brackets; the title alone is the label.
    const label = event.title;
    const problem = label ? undefined : `Calendar event ${event.index + 1} has no title.`;
    return candidate(`ics-${event.index + 1}`, label, detectKind(`${label} ${event.description ?? ""}`), event.start?.date, event.index + 1, sourceName, problem);
  });
  return reconcileScheduleDuplicates(rows, existing);
}

function candidate(id: string, label: string, kind: TrackerKind, date: string | undefined, sourceLine: number, sourceName?: string, problem?: string): ScheduleCandidate {
  return {
    id: `schedule-${normalize(sourceName ?? "paste")}-${id}-${normalize(label).slice(0, 20)}`,
    date,
    label,
    kind,
    sourceLine,
    sourceName,
    selected: !problem,
    duplicate: "none",
    problem,
  };
}

function splitRow(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : ",";
  if (separator === "\t") return line.split(/\t+/).map((cell) => cell.trim());
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

function detectKind(value: string): TrackerKind { return KIND_MAP.find(([pattern]) => pattern.test(value))?.[1] ?? "Lecture"; }
function cleanLabel(value: string, kind: TrackerKind) { return value.replace(/^\d{4}-\d{1,2}-\d{1,2}[,\t\s-]*/i, "").replace(new RegExp(`\\b${kind.replace(" ", "[ -]?")}\\b`, "ig"), "").replace(/^[,\s:-]+|[,\s:-]+$/g, "").trim(); }
function parseDate(value: string): string | undefined {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) return `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return undefined;
}
function provenanceNote(candidate: ScheduleCandidate): string | undefined {
  const parts = [candidate.date ? `Scheduled ${candidate.date}` : "", candidate.sourceName ? `Imported from ${candidate.sourceName}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
function identity(label: string, kind: TrackerKind, date?: string) { return `${normalize(label)}|${kind}|${date ?? ""}`; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function dateFrom(value?: string, note?: string) { return value ?? note?.match(/Scheduled (\d{4}-\d{2}-\d{2})/)?.[1]; }
