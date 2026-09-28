// ===========================================================================
// Review-first course intake that needs no provider: dated schedule rows,
// calendar (.ics) files, and text copied from a Canvas Modules page. Every
// parser here proposes candidates only; the learner reviews them before any
// tracker item is created. Dates come from the source. The one interpretation
// made — the year of a "Sep 12" style date — is flagged for review.
// ===========================================================================
import type { TrackerItem, TrackerKind } from "./types";
import { canvasRefFromUid, isIcsCalendar, parseIcsEvents, type IcsParseOptions } from "./icsCalendar";

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
  /** Stable source identity (e.g. a Canvas calendar UID) so a later import can refresh the same item. */
  sourceRef?: string;
  sourceUrl?: string;
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

export function parseCourseSchedule(
  text: string,
  existing: readonly TrackerItem[] = [],
  sourceName?: string,
  options: IcsParseOptions = {},
): ScheduleCandidate[] {
  if (isIcsCalendar(text)) return parseIcsSchedule(text, existing, sourceName, options);
  return parseDelimitedSchedule(text, existing, sourceName);
}

/** Where a schedule row's date belongs on the tracker item. */
export function scheduleDateField(kind: TrackerKind): "assessmentDate" | "dueDate" | "scheduledDate" {
  if (kind === "Assessment") return "assessmentDate";
  if (kind === "Requirement" || kind === "Milestone" || kind === "Evidence") return "dueDate";
  return "scheduledDate";
}

export function scheduleDatePatch(kind: TrackerKind, date: string | undefined): Pick<TrackerItem, "assessmentDate" | "dueDate" | "scheduledDate"> {
  if (!date) return {};
  const field = scheduleDateField(kind);
  return field === "assessmentDate" ? { assessmentDate: date } : field === "dueDate" ? { dueDate: date } : { scheduledDate: date };
}

export function scheduleCandidatesToTracker(
  candidates: readonly ScheduleCandidate[],
  path: string,
  importedAt: string = new Date().toISOString(),
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
      ...scheduleDatePatch(candidate.kind, candidate.date),
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      source: {
        kind: candidate.sourceRef || /\.ics$/i.test(candidate.sourceName ?? "") ? "calendar" : "text",
        importedAt,
        ...(candidate.sourceRef ? { ref: candidate.sourceRef } : {}),
      },
      note: provenanceNote(candidate),
    }));
}

export function reconcileScheduleDuplicates(
  candidates: readonly ScheduleCandidate[],
  existing: readonly TrackerItem[],
): ScheduleCandidate[] {
  const exact = new Set(existing.map((item) => identity(item.label, item.kind, itemDate(item))));
  const labels = new Set(existing.map((item) => normalize(item.label)));
  const refs = new Set(existing.flatMap((item) => (item.source?.ref ? [item.source.ref] : [])));
  const seenExact = new Set<string>();
  const seenLabels = new Set<string>();
  return candidates.map((candidate) => {
    const key = identity(candidate.label, candidate.kind, candidate.date);
    const labelKey = normalize(candidate.label);
    const duplicate = exact.has(key) || seenExact.has(key) || Boolean(candidate.sourceRef && refs.has(candidate.sourceRef))
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
    const label = event.title;
    const problem = label ? undefined : `Calendar event ${event.index + 1} has no title.`;
    const row = candidate(`ics-${event.index + 1}`, label, detectKind(`${label} ${event.description ?? ""}`), event.start?.date, event.index + 1, sourceName, problem);
    const sourceRef = canvasRefFromUid(event.uid);
    return { ...row, ...(sourceRef ? { sourceRef } : {}), ...(event.url ? { sourceUrl: event.url } : {}) };
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
/** The date an existing item was scheduled for: structured fields first, then the legacy provenance note. */
function itemDate(item: TrackerItem) {
  return item.assessmentDate ?? item.dueDate ?? item.scheduledDate ?? item.note?.match(/Scheduled (\d{4}-\d{2}-\d{2})/)?.[1];
}

// --- Canvas item kinds ------------------------------------------------------------------

/** Title keywords first (the learner's course names its work), in priority order. */
const CANVAS_TITLE_KINDS: Array<[RegExp, TrackerKind]> = [
  [/\b(practice|pq|qbank|question bank|self[- ]assessment|formative|review questions)\b/i, "PQ"],
  [/\b(exam|quiz|assessment|imcq|midterm|mid-term|final|osce|nbme|shelf|test)\b/i, "Assessment"],
  [/\b(dla|daily learning)\b/i, "DLA"],
  [/\b(lab|laboratory)\b/i, "Lab"],
  [/\b(lecture|lec|slides|recording|panopto|video)\b/i, "Lecture"],
  [/\b(review)\b/i, "Review Loop"],
  [/\b(reading|chapter|textbook|article)\b/i, "Reading"],
  [/\b(assignment|homework|essay|reflection|submission|deadline|requirement|survey|form)\b/i, "Requirement"],
];

/**
 * Tracker kind for a Canvas module item or assignment: its title first, then
 * the Canvas content type. Unlabeled pages and files are readings, not
 * lectures, so the pass counter is not assumed for them.
 */
export function canvasItemKind(title: string, canvasType?: string, quizType?: string): TrackerKind {
  const byTitle = CANVAS_TITLE_KINDS.find(([pattern]) => pattern.test(title))?.[1];
  if (byTitle) return byTitle;
  const type = (canvasType ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (type === "quiz" || type === "newquiz" || type === "quizzesnext") {
    if (quizType === "practice_quiz") return "PQ";
    if (quizType === "survey" || quizType === "graded_survey") return "Requirement";
    return "Assessment";
  }
  if (type === "assignment" || type === "discussion" || type === "discussiontopic") return "Requirement";
  if (type === "page" || type === "wikipage" || type === "file" || type === "attachment" || type === "externalurl" || type === "externallink" || type === "externaltool") return "Reading";
  return "Lecture";
}

// --- text copied from a Canvas Modules page ------------------------------------------

export interface PastedCourseItem {
  label: string;
  kind: TrackerKind;
  canvasType?: string;
  dateText?: string;
  date?: string;
  /** True when the source showed no year and AXOM chose the nearest one. */
  yearInferred?: boolean;
  points?: number;
  line: number;
}

export interface PastedCourseModule {
  name: string;
  line: number;
  items: PastedCourseItem[];
}

export interface PastedCourseStructure {
  modules: PastedCourseModule[];
  ignoredLines: number;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_PATTERN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TIME_PATTERN = "(?:\\s*(?:at|@)?\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))?";
const MONTH_DATE = new RegExp(`^(?:(?:due|available|until|closes?)\\s*:?\\s*)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${TIME_PATTERN}$`, "i");
const NUMERIC_DATE = new RegExp(`^(?:(?:due|available|until)\\s*:?\\s*)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?${TIME_PATTERN}$`, "i");
const ISO_DATE = /^(?:(?:due)\s*:?\s*)?(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{1,2}:\d{2}.*)?$/i;
const POINTS = /^(\d+(?:\.\d+)?)\s*(?:pts?|points?)$/i;
const MODULE_HEADER = /^(?:week|wk|module|unit|block|topic|session|part|chapter|section|lesson|day)\s*[#:.-]?\s*\d+\b/i;
const MODULE_CHROME = /^(complete all items|complete one item|prerequisites?:.*|will unlock.*|locked until.*|module locked.*)$/i;
const TYPE_WORDS: Record<string, string> = {
  assignment: "Assignment", quiz: "Quiz", "new quiz": "Quiz", page: "Page", "wiki page": "Page", file: "File",
  attachment: "File", discussion: "Discussion", "discussion topic": "Discussion", "external url": "ExternalUrl",
  "external link": "ExternalUrl", "external tool": "ExternalTool", "text header": "SubHeader",
};
const CHROME = new Set([
  "modules", "collapse all", "expand all", "view progress", "mark as done", "mark done", "done", "must view", "must submit",
  "must contribute", "must mark as done", "must score at least", "viewed", "submitted", "home", "announcements", "assignments",
  "discussions", "grades", "people", "pages", "files", "syllabus", "outcomes", "rubrics", "quizzes", "collaborations", "conferences",
  "settings", "account", "dashboard", "courses", "calendar", "inbox", "history", "help", "skip to content", "student view",
  "published", "unpublished", "publish", "unpublish", "not graded", "locked", "completed", "immersive reader", "view course stream",
  "course modules", "import existing content", "recent activity", "coming up", "to do", "view calendar", "search", "more",
]);

/** Nearest year for a month/day with no year, within about six months of today. */
export function inferYear(month: number, day: number, today: string): number {
  const year = Number(today.slice(0, 4));
  const todayMs = Date.parse(`${today}T12:00:00Z`);
  const distance = (candidateYear: number) => Math.abs(Date.UTC(candidateYear, month - 1, day, 12) - todayMs);
  return [year - 1, year, year + 1].sort((a, b) => distance(a) - distance(b))[0];
}

function validDay(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : undefined;
}

/** A date written in course material; the year is flagged when AXOM had to choose it. */
export function parseLooseDate(value: string, today: string): { date: string; yearInferred: boolean } | undefined {
  const text = value.trim().replace(/\s+/g, " ");
  const iso = text.match(ISO_DATE);
  if (iso) {
    const date = validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? { date, yearInferred: false } : undefined;
  }
  const named = text.match(MONTH_DATE);
  if (named) {
    const month = MONTHS[named[1].toLowerCase().replace(/\.$/, "")] ?? MONTHS[named[1].toLowerCase().slice(0, 3)];
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : inferYear(month, day, today);
    const date = month ? validDay(year, month, day) : undefined;
    return date ? { date, yearInferred: !named[3] } : undefined;
  }
  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const rawYear = numeric[3];
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : inferYear(month, day, today);
    const date = validDay(year, month, day);
    return date ? { date, yearInferred: !rawYear } : undefined;
  }
  return undefined;
}

/** "Sep 12 | 10 pts", "Due Sep 12 at 11:59pm", "10 pts": every segment must be a date, a time or points. */
function parseDetailLine(line: string, today: string): { dateText?: string; date?: string; yearInferred?: boolean; points?: number } | undefined {
  const segments = line.split(/\s*\|\s*/).filter(Boolean);
  if (!segments.length) return undefined;
  const detail: { dateText?: string; date?: string; yearInferred?: boolean; points?: number } = {};
  for (const segment of segments) {
    const points = segment.match(POINTS);
    if (points) { detail.points = Number(points[1]); continue; }
    const parsed = parseLooseDate(segment, today);
    if (parsed && !detail.date) { detail.date = parsed.date; detail.yearInferred = parsed.yearInferred; detail.dateText = segment; continue; }
    return undefined;
  }
  return detail;
}

/**
 * Reads text copied from a Canvas Modules page (Ctrl+A, Ctrl+C). Canvas copy
 * mixes module headings, item titles, screen-reader type labels ("Quiz"),
 * detail lines ("Sep 12 | 10 pts") and interface text; this keeps the first
 * three and drops the rest. The AI extractor handles layouts this cannot.
 */
export function parseCanvasPastedText(text: string, options: { today: string }): PastedCourseStructure {
  const lines = text.split(/\r\n|\n|\r/).map((line) => line.replace(/\s+/g, " ").trim());
  const modules: PastedCourseModule[] = [];
  let current: PastedCourseModule | null = null;
  let pendingType: string | undefined;
  let ignored = 0;
  const ensureModule = (line: number) => {
    if (!current) { current = { name: "", line, items: [] }; modules.push(current); }
    return current;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const lower = line.toLowerCase();
    if (CHROME.has(lower) || /^(?:\d+\s+)?(?:items?|unread|new)$/i.test(line)) { ignored += 1; continue; }
    if (MODULE_CHROME.test(line)) { ignored += 1; continue; }
    const typeWord = TYPE_WORDS[lower];
    if (typeWord) { pendingType = typeWord; continue; }
    const detail = parseDetailLine(line, options.today);
    if (detail) {
      const item = current ? (current as PastedCourseModule).items.at(-1) : undefined;
      if (item && !item.date && !item.points) Object.assign(item, detail);
      else ignored += 1;
      continue;
    }
    const next = lines.slice(index + 1).find(Boolean) ?? "";
    const headerByChrome = MODULE_CHROME.test(next) && !pendingType;
    const headerByColon = /:$/.test(line) && !pendingType && line.length <= 120;
    if (MODULE_HEADER.test(line) || headerByChrome || headerByColon) {
      current = { name: line.replace(/:$/, "").trim(), line: index + 1, items: [] };
      modules.push(current);
      pendingType = undefined;
      continue;
    }
    if (pendingType === "SubHeader") { pendingType = undefined; ignored += 1; continue; }
    ensureModule(index + 1).items.push({
      label: line.slice(0, 300),
      kind: canvasItemKind(line, pendingType),
      ...(pendingType ? { canvasType: pendingType } : {}),
      line: index + 1,
    });
    pendingType = undefined;
  }
  const kept = modules.filter((module) => module.items.length || module.name);
  const warnings: string[] = [];
  const inferred = kept.reduce((sum, module) => sum + module.items.filter((item) => item.yearInferred).length, 0);
  if (inferred) warnings.push(`${inferred} date${inferred === 1 ? "" : "s"} had no year; AXOM chose the nearest year. Check them before importing.`);
  if (!kept.some((module) => module.items.length)) warnings.push("No module items were found. Try Extract with AI, or copy the Modules page again.");
  return { modules: kept, ignoredLines: ignored, warnings };
}
