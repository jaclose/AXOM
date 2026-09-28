// ===========================================================================
// iCalendar (RFC 5545) reading for course calendar feeds, including Canvas's
// Calendar Feed export. Handles line unfolding, quoted parameters, TEXT
// escapes, and the three DTSTART forms that matter for deadlines:
//   all-day      DTSTART;VALUE=DATE:20260914
//   UTC          DTSTART:20260915T035900Z
//   zoned        DTSTART;TZID=America/New_York:20260914T235900
// Timed events are placed on the learner's own calendar day (their time zone),
// so an 11:59 pm deadline never shows up a day late. Pure and local.
// ===========================================================================

export interface IcsDateValue {
  /** yyyy-MM-dd on the learner's calendar (or as written for all-day and floating times). */
  date: string;
  /** Exact instant (ISO) when the value has a time and a known zone. */
  instant?: string;
  allDay: boolean;
  /** The property exactly as it appeared, for provenance. */
  raw: string;
}

export interface IcsEvent {
  index: number;
  uid?: string;
  summary: string;
  description?: string;
  url?: string;
  location?: string;
  start?: IcsDateValue;
  end?: IcsDateValue;
  /** The trailing "[BIOL 101]" Canvas adds to every SUMMARY, when present. */
  contextCode?: string;
  /** SUMMARY without the trailing context code. */
  title: string;
}

export interface IcsParseOptions {
  /** IANA zone for the learner's calendar day; defaults to the device zone. */
  timeZone?: string;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
  raw: string;
}

/** RFC 5545 §3.1: a line break followed by one space or tab continues the previous line. */
export function unfoldIcs(text: string): string {
  return text.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "");
}

/** RFC 5545 §3.3.11 TEXT escapes. */
export function decodeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

function parseContentLine(line: string): ContentLine | null {
  let quoted = false;
  let split = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) { split = index; break; }
  }
  if (split <= 0) return null;
  const head = line.slice(0, split);
  const value = line.slice(split + 1);
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const char of head) {
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ";" && !quoted) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  const params: Record<string, string> = {};
  for (const param of parts.slice(1)) {
    const eq = param.indexOf("=");
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1);
  }
  return { name: parts[0].toUpperCase(), params, value, raw: line };
}

export function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

function zonedParts(instantMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** yyyy-MM-dd of an instant in a zone; undefined when the zone is unknown. */
export function dayInZone(instantMs: number, timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    const parts = zonedParts(instantMs, timeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  } catch {
    return undefined;
  }
}

/** The instant a wall-clock time in an IANA zone refers to (two passes settle DST edges). */
export function zonedWallClockToInstant(
  fields: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): number | undefined {
  try {
    const guess = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
    const offsetAt = (instant: number) => {
      const parts = zonedParts(instant, timeZone);
      return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
    };
    const first = guess - offsetAt(guess);
    const second = guess - offsetAt(first);
    return Number.isFinite(second) ? second : undefined;
  } catch {
    return undefined;
  }
}

function parseDateValue(line: ContentLine, targetZone: string | undefined): IcsDateValue | undefined {
  const value = line.value.trim();
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly || line.params.VALUE?.toUpperCase() === "DATE") {
    const match = dateOnly ?? value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!match) return undefined;
    return { date: `${match[1]}-${match[2]}-${match[3]}`, allDay: true, raw: line.raw };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i);
  if (!match) return undefined;
  const fields = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]) };
  const writtenDay = `${match[1]}-${match[2]}-${match[3]}`;
  let instant: number | undefined;
  if (match[7]) instant = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  else if (line.params.TZID) instant = zonedWallClockToInstant(fields, line.params.TZID.replace(/^\//, ""));
  if (instant === undefined || !Number.isFinite(instant)) {
    // Floating time, or a zone name this device does not know: keep the written day.
    return { date: writtenDay, allDay: false, raw: line.raw };
  }
  return { date: dayInZone(instant, targetZone) ?? writtenDay, instant: new Date(instant).toISOString(), allDay: false, raw: line.raw };
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Canvas appends the course's short name in brackets: "Homework 3 [BIOL 101]". */
export function splitContextCode(summary: string): { title: string; contextCode?: string } {
  const match = summary.match(/^(.*?)\s*\[([^\][]{1,80})\]\s*$/);
  return match && match[1].trim() ? { title: match[1].trim(), contextCode: match[2].trim() } : { title: summary.trim() };
}

export function isIcsCalendar(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text) || /BEGIN:VEVENT/i.test(text);
}

/** Every VEVENT in order. Events keep their index so a malformed one can still be shown for review. */
export function parseIcsEvents(text: string, options: IcsParseOptions = {}): IcsEvent[] {
  const targetZone = options.timeZone ?? deviceTimeZone();
  const lines = unfoldIcs(text).split(/\r\n|\n|\r/);
  const events: IcsEvent[] = [];
  let current: ContentLine[] | null = null;
  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^BEGIN:VEVENT$/i.test(line)) { current = []; depth = 0; continue; }
    if (!current) continue;
    // Nested components (VALARM) belong to the event but not to its properties.
    if (/^BEGIN:/i.test(line)) { depth += 1; continue; }
    if (/^END:/i.test(line)) {
      if (depth > 0) { depth -= 1; continue; }
      if (/^END:VEVENT$/i.test(line)) {
        events.push(toEvent(current, events.length, targetZone));
        current = null;
      }
      continue;
    }
    if (depth > 0) continue;
    const parsed = parseContentLine(line);
    if (parsed) current.push(parsed);
  }
  return events;
}

function toEvent(lines: ContentLine[], index: number, targetZone: string | undefined): IcsEvent {
  const first = (name: string) => lines.find((line) => line.name === name);
  const summary = decodeIcsText(first("SUMMARY")?.value ?? "").replace(/\s+/g, " ").trim();
  const { title, contextCode } = splitContextCode(summary);
  const description = decodeIcsText(first("DESCRIPTION")?.value ?? "").trim();
  const location = decodeIcsText(first("LOCATION")?.value ?? "").trim();
  const start = first("DTSTART");
  const end = first("DTEND");
  return {
    index,
    uid: first("UID")?.value.trim() || undefined,
    summary,
    title,
    contextCode,
    description: description || undefined,
    location: location || undefined,
    url: httpUrl(first("URL")?.value),
    start: start ? parseDateValue(start, targetZone) : undefined,
    end: end ? parseDateValue(end, targetZone) : undefined,
  };
}

/**
 * Canvas UIDs name the record behind each event ("event-assignment-123",
 * "event-calendar-event-456"), which is the same id the Canvas exporter
 * reports, so both intake paths refresh one tracker item instead of two.
 */
export function canvasRefFromUid(uid: string | undefined): string | undefined {
  const match = uid?.match(/^event-(assignment-override|assignment|calendar-event)-(\d+)$/i);
  return match ? `canvas:${match[1].toLowerCase()}:${match[2]}` : undefined;
}
