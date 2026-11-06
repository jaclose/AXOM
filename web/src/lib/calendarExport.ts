import type { NoctyriumState } from "./types";

/**
 * Calendar export (.ics, RFC 5545). Works with Google Calendar, Apple
 * Calendar, and Outlook via "Import". It includes only what the learner
 * chooses, as all-day events, and never contains journal text or notes.
 */
export interface CalendarExportOptions {
  tasks: boolean;
  exams: boolean;
  dayPlans: boolean;
  /** yyyy-MM-dd; items before this date are skipped. */
  fromDay: string;
}

export interface CalendarEventInput {
  uid: string;
  day: string; // yyyy-MM-dd
  title: string;
  description?: string;
  category: string;
}

const BOARD_LABELS: Record<string, string> = {
  step1: "USMLE Step 1", step2: "USMLE Step 2 CK", step3: "USMLE Step 3", shelf: "Shelf exam", mcat: "MCAT", premed: "Pre-med milestone",
};

export function calendarEvents(state: Pick<NoctyriumState, "tasks" | "boardPrep" | "dayPlans">, options: CalendarExportOptions): CalendarEventInput[] {
  const events: CalendarEventInput[] = [];
  if (options.tasks) {
    for (const task of state.tasks) {
      const day = task.due?.slice(0, 10);
      if (!day || task.archived || task.done || day < options.fromDay) continue;
      events.push({ uid: `task-${task.id}`, day, title: `Due: ${task.title}`, description: task.scope ? `Scope: ${task.scope}` : undefined, category: "AXOM task" });
    }
  }
  if (options.exams) {
    for (const [id, profile] of Object.entries(state.boardPrep ?? {})) {
      const day = profile?.examDate;
      if (!day || day < options.fromDay) continue;
      events.push({ uid: `exam-${id}`, day, title: `${BOARD_LABELS[id] ?? id} exam day`, description: "Exam date from AXOM Boards.", category: "AXOM exam" });
    }
  }
  if (options.dayPlans) {
    for (const plan of state.dayPlans ?? []) {
      if (plan.dayKey < options.fromDay || !plan.intention.trim()) continue;
      events.push({
        uid: `plan-${plan.dayKey}`,
        day: plan.dayKey,
        title: `Intention: ${plan.intention.trim()}`,
        description: plan.wins.length ? `Win conditions: ${plan.wins.join("; ")}` : undefined,
        category: "AXOM daily check-in",
      });
    }
  }
  return events.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}

/** RFC 5545 TEXT escaping. Calendar values can contain CR, LF or CRLF. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ");
}

/** Fold at 75 UTF-8 octets, reserving one octet for continuation whitespace. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  // for...of iterates Unicode code points, so no UTF-8 sequence is split.
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (octets + width > 75) {
      lines.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += width;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** Fail closed on malformed all-day values; UTC keeps the next day timezone-independent. */
function allDayDates(day: string): [string, string] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000"))
    throw new RangeError("AXOM calendar event has an invalid day");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw new RangeError("AXOM calendar event has an invalid day");
  const next = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next))
    throw new RangeError("AXOM calendar event day exceeds supported range");
  return [day.replace(/-/g, ""), next.replace(/-/g, "")];
}

export function buildIcs(events: readonly CalendarEventInput[], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AXOM//Study Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:AXOM study plan",
  ];
  const seenUids = new Set<string>();
  for (const event of events) {
    // UID is an RFC 5545 TEXT value, not an arbitrary unescaped content line.
    // Reject ambiguous IDs rather than allowing collisions or additional events.
    if (!event.uid || seenUids.has(event.uid)
      || /[\u0000-\u0008\u000B-\u001F\u007F]/.test(event.uid)
      || [...event.uid].some((character) => character.length === 1
        && character.charCodeAt(0) >= 0xD800 && character.charCodeAt(0) <= 0xDFFF))
      throw new RangeError("AXOM calendar event UID is missing, duplicated, or invalid");
    seenUids.add(event.uid);
    const [start, end] = allDayDates(event.day);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.uid)}@axom.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      `CATEGORIES:${escapeIcsText(event.category)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function downloadIcs(content: string, filename = "axom-study-plan.ics"): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
