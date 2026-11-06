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
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
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

function compactDay(day: string) {
  return day.replace(/-/g, "");
}

function nextDay(day: string) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
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
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@axom.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDay(event.day)}`,
      `DTEND;VALUE=DATE:${nextDay(event.day)}`,
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
