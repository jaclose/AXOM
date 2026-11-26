import { isIcsCalendar, parseIcsEvents, type IcsParseOptions } from "./icsCalendar";
import type { TrackerItem, TrackerKind } from "./types";
import { trackerPathKey } from "./pathUtils";
import { COURSE_ACTIVITIES, COURSE_ACTIVITY_LABEL, TRACKER_KIND_FOR_ACTIVITY, isCourseActivity, type CourseActivity } from "./course-engine/activity";

interface ScheduleConflictClaim {
  origin: "tracker" | "batch";
  id: string;
  label: string;
  activity?: CourseActivity;
  kind?: TrackerKind;
  path?: string;
  date?: string;
  note?: string;
  templateKey?: string;
  sourceName?: string;
  sourceLine?: number;
}

export interface ScheduleCandidate {
  id: string;
  date?: string;
  label: string;
  kind: TrackerKind;
  /** Explicit source type or learner-reviewed category; never inferred from the default kind. */
  activity?: CourseActivity;
  /** Structured source identity and possible older coarse-parser alias. */
  legacyIdentity?: { original: string; previous: string };
  sourceLine: number;
  sourceName?: string;
  selected: boolean;
  duplicate: "exact" | "conflict" | "likely" | "none";
  /** Bound to the destination and material counterpart claims, not progress or selection. */
  conflictKey?: string;
  conflictClaims?: ScheduleConflictClaim[];
  confirmedConflictKey?: string;
  problem?: string;
  /** A malformed source row must be corrected and reparsed. */
  sourceProblem?: string;
  rawInput?: string;
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
  scopePath?: string,
): ScheduleCandidate[] {
  if (isIcsCalendar(text)) return parseIcsSchedule(text, existing, sourceName, options, scopePath);
  return parseDelimitedSchedule(text, existing, sourceName, scopePath);
}

/** An ambiguous category collision requires a separate, explicit confirmation. */
export function canImportScheduleCandidate(candidate: ScheduleCandidate): boolean {
  return !candidate.problem && !candidate.sourceProblem && Boolean(candidate.label.trim()) &&
    (candidate.date === undefined || isCalendarDate(candidate.date)) && candidate.duplicate !== "exact" &&
    (candidate.duplicate !== "conflict" || Boolean(candidate.conflictKey && candidate.confirmedConflictKey === candidate.conflictKey));
}

export function scheduleCandidatesToTracker(
  candidates: readonly ScheduleCandidate[],
  path: string,
): Array<Omit<TrackerItem, "id" | "updated">> {
  return candidates
    .filter((candidate) => candidate.selected && canImportScheduleCandidate(candidate))
    .map((candidate) => ({
      path,
      label: candidate.label.trim(),
      kind: candidate.kind,
      ...(isCourseActivity(candidate.activity) && TRACKER_KIND_FOR_ACTIVITY[candidate.activity] === candidate.kind
        ? { activity: candidate.activity } : {}),
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
  scopePath?: string,
): ScheduleCandidate[] {
  // An identical "IMCQ 1" in a different course is not a duplicate.
  const scoped = scopePath === undefined ? existing : existing.filter((item) => trackerPathKey(item.path) === trackerPathKey(scopePath));
  // Unclassified rows retain the conservative legacy duplicate behavior.
  // Explicit incompatible categories are not proof of the same event.
  const existingCategories = new Map<string, Set<string>>();
  const conflictClaimsByIdentity = new Map<string, ScheduleConflictClaim[]>();
  const seenCategories = new Map<string, Set<string>>();
  const existingByTitleDate = new Map<string, ScheduleConflictClaim[]>();
  const legacyAliasesByTitleDate = new Map<string, ScheduleConflictClaim[]>();
  function remember(map: Map<string, Set<string>>, key: string, activity?: CourseActivity) {
    const categories = map.get(key) ?? new Set<string>();
    categories.add(activity ?? "");
    map.set(key, categories);
  }
  function rememberClaim(key: string, claim: ScheduleConflictClaim) {
    const claims = conflictClaimsByIdentity.get(key) ?? [];
    claims.push(claim);
    conflictClaimsByIdentity.set(key, claims);
  }
  for (const item of scoped) {
    const date = dateFrom(item.assessmentDate, item.note);
    const key = identity(item.label, item.kind, date);
    remember(existingCategories, key, item.activity);
    const claim: ScheduleConflictClaim = {
      origin: "tracker", id: item.id, label: item.label, activity: item.activity,
      kind: item.kind, path: trackerPathKey(item.path), date, note: item.note, templateKey: item.templateKey,
    };
    if (isCourseActivity(item.activity)) rememberClaim(key, claim);
    const titleDate = titleDateIdentity(key);
    const byTitle = existingByTitleDate.get(titleDate) ?? [];
    byTitle.push(claim);
    existingByTitleDate.set(titleDate, byTitle);
    const alias = cleanLabel(item.label, item.kind);
    if (normalize(alias) && normalize(alias) !== normalize(item.label)) {
      const aliasKey = titleDateIdentity(identity(alias, item.kind, date));
      const aliases = legacyAliasesByTitleDate.get(aliasKey) ?? [];
      aliases.push(claim);
      legacyAliasesByTitleDate.set(aliasKey, aliases);
    }
  }
  for (const row of candidates) {
    if (normalize(row.label) && isCourseActivity(row.activity)) rememberClaim(identity(row.label, row.kind, row.date), {
      origin: "batch", id: row.id, label: row.label, activity: row.activity,
      date: row.date, sourceName: row.sourceName, sourceLine: row.sourceLine,
    });
  }
  const labels = new Set(scoped.map((item) => normalize(item.label)));
  const seenLabels = new Set<string>();
  return candidates.map((candidate) => {
    const key = identity(candidate.label, candidate.kind, candidate.date);
    const labelKey = normalize(candidate.label);
    const activity = candidate.activity ?? "";
    const prior = new Set([...(existingCategories.get(key) ?? []), ...(seenCategories.get(key) ?? [])]);
    const exact = prior.has(activity) || prior.has("") || (!activity && prior.size > 0);
    const incompatible = !exact && activity ? (conflictClaimsByIdentity.get(key) ?? [])
      .filter((claim) => claim.activity !== activity) : [];
    // A legacy import may have stripped title words, appended a type, or used
    // another coarse kind. Classification is mutable, not source identity.
    // Compare both directions across imports; fresh exact titles still win.
    const titleDate = titleDateIdentity(key);
    const legacy = candidate.legacyIdentity;
    const aliasClaims: ScheduleConflictClaim[] = [];
    if (!exact && legacy) {
      const [originalLabel] = legacy.original.split("|");
      const [previousLabel] = legacy.previous.split("|");
      const originalTitleDate = titleDateIdentity(legacy.original);
      const previousTitleDate = titleDateIdentity(legacy.previous);
      // Provenance is immutable, but an explicitly different reviewed title
      // has its own duplicate identity. Date-only edits retain the source alias.
      if (labelKey === originalLabel) {
        if (originalTitleDate !== titleDate) {
          aliasClaims.push(...(existingByTitleDate.get(originalTitleDate) ?? []));
        }
        if (previousLabel && previousTitleDate !== originalTitleDate) {
          aliasClaims.push(...(existingByTitleDate.get(previousTitleDate) ?? []),
            ...(existingByTitleDate.get(JSON.stringify([previousLabel, candidate.date ?? ""])) ?? []));
        }
        aliasClaims.push(...(legacyAliasesByTitleDate.get(originalTitleDate) ?? []));
      }
      // Reconcile the effective title in both directions, including renames.
      const effectiveAlias = normalize(cleanLabel(candidate.label, candidate.kind));
      if (effectiveAlias && effectiveAlias !== labelKey) {
        aliasClaims.push(...(existingByTitleDate.get(JSON.stringify([effectiveAlias, candidate.date ?? ""])) ?? []));
      }
      aliasClaims.push(...(legacyAliasesByTitleDate.get(titleDate) ?? []));
    }
    const counterparts = [...new Set([...incompatible, ...aliasClaims])];
    const duplicate: ScheduleCandidate["duplicate"] = exact ? "exact" : counterparts.length ? "conflict"
      : labels.has(labelKey) || seenLabels.has(labelKey) ? "likely" : "none";
    // Sorting serialized claims preserves multiplicity without binding to order.
    // Mutable progress, attendance, selection and update timestamps are excluded.
    const conflictClaims = duplicate === "conflict" ? counterparts
      .map((claim) => ({ claim, snapshot: JSON.stringify(claim) }))
      .sort((a, b) => a.snapshot < b.snapshot ? -1 : a.snapshot > b.snapshot ? 1 : 0)
      .map(({ claim }) => claim) : undefined;
    const conflictKey = conflictClaims
      ? JSON.stringify([scopePath === undefined ? null : trackerPathKey(scopePath), key, activity,
        candidate.id, candidate.label, candidate.sourceName, candidate.sourceLine, conflictClaims]) : undefined;
    const confirmedConflictKey = conflictKey && candidate.confirmedConflictKey === conflictKey ? conflictKey : undefined;
    const staleConfirmation = Boolean(candidate.confirmedConflictKey && !confirmedConflictKey);
    if (labelKey) { remember(seenCategories, key, candidate.activity); seenLabels.add(labelKey); }
    return { ...candidate, duplicate, conflictKey, conflictClaims, confirmedConflictKey,
      selected: duplicate === "exact" || staleConfirmation || (duplicate === "conflict" && !confirmedConflictKey) ? false : candidate.selected };
  });
}

function parseDelimitedSchedule(text: string, existing: readonly TrackerItem[], sourceName?: string, scopePath?: string): ScheduleCandidate[] {
  const lines = text.split("\n");
  const first = lines.find((line) => line.trim())?.trim() ?? "";
  // Explicit file format and a leading header take precedence. For other
  // pasted schedules, infer structured context even after a preface or an
  // invalid first date. Physical lines only provide format evidence here;
  // they cannot independently authorize an activity.
  const declaredSeparator = /\.tsv$/i.test(sourceName ?? "") ? "\t"
    : /\.csv$/i.test(sourceName ?? "") ? "," : scheduleHeaderSeparator(first);
  let detectedSeparator = declaredSeparator ?? lines.map(scheduleRecordSeparator).find(Boolean);
  // Frame structured records before admitting any physical line. Multiline
  // fields are not supported by splitRow; hold the whole affected record
  // instead of letting date-shaped continuation text become an activity.
  const records: Array<{ raw: string; index: number; endIndex: number; separator?: string }> = [];
  for (let index = 0; index < lines.length;) {
    const firstLine = lines[index].replace(/\r$/, "");
    // A recognized record may change the inferred delimiter in mixed paste,
    // but an ambiguous line must not fall back to free-form admission.
    const separator = declaredSeparator ?? scheduleRecordSeparator(firstLine) ?? detectedSeparator;
    detectedSeparator = separator;
    let endIndex = index;
    let open = Boolean(separator) && quoteContinues(firstLine);
    while (open && endIndex + 1 < lines.length) {
      endIndex += 1;
      open = quoteContinues(lines[endIndex], open);
    }
    records.push({ raw: lines.slice(index, endIndex + 1).join("\n").replace(/\r$/, ""), index, endIndex, separator });
    index = endIndex + 1;
  }
  const rows = records.flatMap(({ raw, index, endIndex, separator }) => {
    const line = raw.trim();
    if (index === endIndex && !line) return [];
    function held(reason: string) {
      const location = index === endIndex ? "Line " + (index + 1) : "Lines " + (index + 1) + "-" + (endIndex + 1);
      const problem = location + ": " + reason;
      return [{ ...candidate(String(index + 1), "", "Lecture", undefined, index + 1, sourceName, problem), sourceProblem: problem, rawInput: raw }];
    }
    if (index !== endIndex) return held("Multiline or unclosed quoted fields. Correct the entire source record and review again.");
    const cells = separator ? splitRow(raw, separator) : [line];
    if (!cells) return held("Malformed quoted fields. Correct the source row and review again.");
    if (separator && (cells.length < 2 || cells.length > 3)) return held("Expected date, title and optional type. Correct the source row and review again.");
    // Only a complete decoded header is metadata. Malformed header-like
    // records remain held by ordinary structured admission.
    if (separator && isScheduleHeader(cells)) return [];
    const date = parseDate(cells[0]);
    if (separator && !date) return held("Invalid calendar date. Correct the source row and review again.");
    if (separator && !cells[1]) return held("A title is required. Correct the source row and review again.");
    const body = date ? cells.slice(1).join(" ") : line;
    const lastIndex = cells.length - 1;
    const activity = date && cells.length >= 3 ? explicitScheduleActivity(cells[lastIndex]) : undefined;
    const legacyKindIndex = cells.length >= 3 && KIND_MAP.some(([pattern]) => pattern.test(cells[lastIndex])) ? lastIndex : -1;
    if (separator && cells.length === 3 && cells[2] && !activity && legacyKindIndex < 0) return held("Unrecognized type. Correct the source row and review again.");
    const explicitKindIndex = activity ? lastIndex : legacyKindIndex;
    const kind = activity ? TRACKER_KIND_FOR_ACTIVITY[activity] : detectKind(explicitKindIndex >= 0 ? cells[explicitKindIndex] : body);
    // The decoded title cell is authoritative, even when kind is inferred.
    const label = separator ? cells[1] : date && explicitKindIndex >= 0 ? cells.slice(1, explicitKindIndex).join(" ").trim() : cleanLabel(body, kind);
    const problem = label ? undefined : `Line ${index + 1} has no usable title.`;
    // The old parser sometimes stripped title words, retained the type suffix,
    // or used a different coarse kind. Preserve its same-destination duplicate hold
    // for an unchanged source row rather than creating a second activity.
    const previousKind = detectKind(legacyKindIndex >= 0 ? cells[legacyKindIndex] : body);
    const previousLabel = date && legacyKindIndex >= 0 ? cells.slice(1, legacyKindIndex).join(" ").trim() : cleanLabel(body, previousKind);
    const original = identity(label, kind, date);
    const previous = identity(previousLabel, previousKind, date);
    return [{
      ...candidate(`${index + 1}`, label, kind, date, index + 1, sourceName, problem),
      ...(activity ? { activity } : {}),
      ...(separator ? { legacyIdentity: { original, previous } } : {}),
    }];
  });
  return reconcileScheduleDuplicates(rows, existing, scopePath);
}

function parseIcsSchedule(text: string, existing: readonly TrackerItem[], sourceName: string | undefined, options: IcsParseOptions, scopePath?: string): ScheduleCandidate[] {
  const rows = parseIcsEvents(text, options).map((event) => {
    // A learning platform's feed ends every title with the course in brackets; the title alone is the label.
    const label = event.title;
    const problem = label ? undefined : `Calendar event ${event.index + 1} has no title.`;
    return candidate(`ics-${event.index + 1}`, label, detectKind(`${label} ${event.description ?? ""}`), event.start?.date, event.index + 1, sourceName, problem);
  });
  return reconcileScheduleDuplicates(rows, existing, scopePath);
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

function scheduleHeaderSeparator(line: string): string | undefined {
  return line.match(/^[ \uFEFF]*(?:"date"|date) *([,\t])/i)?.[1];
}

function scheduleRecordSeparator(line: string): string | undefined {
  return scheduleHeaderSeparator(line) ??
    line.match(/^\s*"?(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})"? *([,\t])/)?.[1];
}

function isScheduleHeader(cells: readonly string[]): boolean {
  return (cells.length === 2 || cells.length === 3) &&
    cells[0].toLowerCase() === "date" && /^(title|label)$/i.test(cells[1]) &&
    (cells.length === 2 || /^(type|kind)$/i.test(cells[2]));
}

// Conservative boundary scanner: even malformed quote placement cannot
// authorize a continuation as a separate record. Escaped quotes do not close
// an open field. Ordinary free-form rows never enter this scanner.
function quoteContinues(line: string, quoted = false): boolean {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '"') continue;
    if (quoted && line[index + 1] === '"') { index += 1; continue; }
    quoted = !quoted;
  }
  return quoted;
}

// Single-line CSV and TSV share positional, quoted-field semantics.
function splitRow(line: string, separator: string): string[] | undefined {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === separator) {
      cells.push(value.trim());
      value = "";
      closed = false;
    } else if (closed) {
      if (char !== " ") return undefined;
    } else if (char === '"') {
      if (value.trim()) return undefined;
      quoted = true;
    } else value += char;
  }
  if (quoted) return undefined;
  cells.push(value.trim());
  return cells;
}

// Only an exact, separately supplied type cell supplies a category. An ICS
// title or free-form label may describe personal study, a cancellation or
// a reminder. Those rows stay unclassified until the learner chooses.
function explicitScheduleActivity(value: string): CourseActivity | undefined {
  const type = normalize(value);
  return COURSE_ACTIVITIES.find((activity) => normalize(activity) === type || normalize(COURSE_ACTIVITY_LABEL[activity]) === type);
}

function detectKind(value: string): TrackerKind { return KIND_MAP.find(([pattern]) => pattern.test(value))?.[1] ?? "Lecture"; }
function cleanLabel(value: string, kind: TrackerKind) { return value.replace(/^\d{4}-\d{1,2}-\d{1,2}[,\t\s-]*/i, "").replace(new RegExp(`\\b${kind.replace(" ", "[ -]?")}\\b`, "ig"), "").replace(/^[,\s:-]+|[,\s:-]+$/g, "").trim(); }
function isCalendarDate(value: string): boolean {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : undefined;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function parseDate(value: string): string | undefined {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const date = iso ? iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0")
    : us ? (us[3].length === 2 ? "20" + us[3] : us[3]) + "-" + us[1].padStart(2, "0") + "-" + us[2].padStart(2, "0") : undefined;
  return date && isCalendarDate(date) ? date : undefined;
}
function provenanceNote(candidate: ScheduleCandidate): string | undefined {
  const parts = [candidate.date ? `Scheduled ${candidate.date}` : "", candidate.sourceName ? `Imported from ${candidate.sourceName}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
function identity(label: string, kind: TrackerKind, date?: string) { return `${normalize(label)}|${kind}|${date ?? ""}`; }
// Identity labels are normalized before the pipe-delimited key is built.
function titleDateIdentity(key: string): string {
  const [label, , date] = key.split("|");
  return JSON.stringify([label, date]);
}
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function dateFrom(value?: string, note?: string) { return value ?? note?.match(/Scheduled (\d{4}-\d{2}-\d{2})/)?.[1]; }
